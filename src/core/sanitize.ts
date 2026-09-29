import { parseCsv } from './csv';
import { normalizeName } from './matching';
import type { Content, EventInfo, Guest, PublishedData } from './types';

/** Terms that must never appear in guest-facing copy. A hit fails the publish. */
export const FORBIDDEN = [
  'budget',
  'contract',
  'vendor',
  'invoice',
  'deposit',
  'retainer',
  'balance due',
  'payment',
  'quote',
  'per head',
  'cost per',
  'planner fee',
  'commission',
  'internal',
  'confidential',
  'do not share',
];

const FORBIDDEN_RE = new RegExp(`\\b(${FORBIDDEN.map((t) => t.replace(/ /g, '\\s+')).join('|')})\\b`, 'i');
const DOLLAR_RE = /\$\s?\d[\d,]{2,}/; // large dollar amounts look like pricing

export function findForbidden(text: string): string | null {
  const m = FORBIDDEN_RE.exec(text);
  if (m) return m[1];
  const d = DOLLAR_RE.exec(text);
  return d ? d[0] : null;
}

function strings(value: unknown, path: string, out: { path: string; text: string }[] = []) {
  if (typeof value === 'string') out.push({ path, text: value });
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) strings(v, `${path}.${k}`, out);
  return out;
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v.trim() : fallback);

export function pickEvents(raw: unknown): EventInfo[] {
  if (!Array.isArray(raw)) return [];
  // Allowlist: only these keys survive, whatever else the source file contains.
  return raw.map((e) => {
    const out: EventInfo = {
    id: str(e?.id),
    name: str(e?.name),
    start: str(e?.start),
    end: str(e?.end),
    venue: str(e?.venue),
    address: str(e?.address),
    dressCode: str(e?.dressCode),
    dressNotes: str(e?.dressNotes),
    description: str(e?.description),
    };
    if (Array.isArray(e?.moments)) {
      const m = e.moments
        .map((x: any) => ({ time: str(x?.time), label: str(x?.label) }))
        .filter((x: { time: string; label: string }) => x.time && x.label);
      if (m.length) out.moments = m;
    }
    if (e?.timeTbd === true) out.timeTbd = true;
    if (e?.everyone === true) out.everyone = true;
    return out;
  });
}

export function pickContent(raw: any): Content {
  return {
    coupleNames: str(raw?.coupleNames),
    tagline: str(raw?.tagline),
    timezone: str(raw?.timezone),
    welcome: str(raw?.welcome),
    faq: Array.isArray(raw?.faq) ? raw.faq.map((f: any) => ({ q: str(f?.q), a: str(f?.a) })) : [],
    contact: { label: str(raw?.contact?.label), detail: str(raw?.contact?.detail) },
    updates: Array.isArray(raw?.updates)
      ? raw.updates.map((u: any) => ({ id: str(u?.id), at: str(u?.at), message: str(u?.message) }))
      : [],
  };
}

const truthy = (v: string) => /^(y|yes|true|1|x|✓|☑)$/i.test(v.trim());

/** Entries that aren't a real, typeable name (plus-one placeholders, unknown relatives). */
export function isPlaceholderName(name: string): boolean {
  const n = name.trim();
  return (
    !n ||
    /\?/.test(n) ||
    /^(kid|kids|child|children|guest|spouse|spouses|wife|husband|partner|baba|jiju)$/i.test(n) ||
    /['’]s\s+(husband|wife|kid|kids|spouse|partner|family)\b/i.test(n) ||
    /\b(wife|husband)$/i.test(n)
  );
}

/**
 * Guest sheet, either layout:
 *  - one guest per row: Name, Aliases (semicolon separated), Household, or
 *  - one household per row: "Guest 1 name" ... "Guest N name" (everyone on a row shares an itinerary).
 * Then one Yes/No (or TRUE/FALSE checkbox) column per event, matched by event id or event name
 * (case-insensitive). Every other column (email, phone, hotel, RSVP odds, notes, host...) is
 * ignored and never published.
 */
export function guestsFromCsv(csv: string, events: EventInfo[], onSkip?: (name: string) => void): Guest[] {
  const rows = parseCsv(csv);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const nameCol = col('name');
  const guestCols = header.flatMap((h, i) => (/^guest\s*\d+(\s*name)?$/.test(h) ? [i] : []));
  if (nameCol < 0 && !guestCols.length) throw new Error('Guest list needs a "Name" column or "Guest 1 name" columns');
  const aliasCol = col('aliases');
  const hhCol = col('household');
  const eventCols = events.map((e) => {
    let idx = header.indexOf(e.id.toLowerCase());
    if (idx < 0) idx = header.indexOf(e.name.toLowerCase());
    return { id: e.id, idx };
  });
  const everyoneIds = events.filter((e) => e.everyone).map((e) => e.id);
  const invitedFor = (r: string[]) => [
    ...eventCols.filter((c) => c.idx >= 0 && truthy(r[c.idx] ?? '')).map((c) => c.id),
    ...everyoneIds.filter((id) => !eventCols.some((c) => c.id === id && c.idx >= 0 && truthy(r[c.idx] ?? ''))),
  ];

  const out: Guest[] = [];
  rows.slice(1).forEach((r, i) => {
    const invited = invitedFor(r);
    const names =
      nameCol >= 0 ? [(r[nameCol] ?? '').trim()] : guestCols.map((c) => (r[c] ?? '').trim());
    const household = hhCol >= 0 ? (r[hhCol] ?? '').trim() : '';
    const householdId = household || `row-${i + 2}`;
    const seen = new Set<string>();
    for (const name of names) {
      if (!name) continue;
      if (isPlaceholderName(name)) {
        onSkip?.(name);
        continue;
      }
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({
        id: `g${out.length + 1}`,
        name,
        aliases: aliasCol >= 0 ? (r[aliasCol] ?? '').split(';').map((a) => a.trim()).filter(Boolean) : [],
        householdId,
        invited,
      });
    }
  });
  return out;
}

export function validate(data: PublishedData): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  if (!data.code || data.code.length < 4) errors.push('Wedding code must be at least 4 characters');
  if (!data.content.timezone) errors.push('content.timezone is required');
  else {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: data.content.timezone });
    } catch {
      errors.push(`Invalid timezone "${data.content.timezone}"`);
    }
  }
  for (const e of data.events) {
    if (!e.id) errors.push('Event is missing an id');
    if (ids.has(e.id)) errors.push(`Duplicate event id "${e.id}"`);
    ids.add(e.id);
    const s = new Date(e.start).getTime();
    const en = new Date(e.end).getTime();
    if (Number.isNaN(s) || Number.isNaN(en)) errors.push(`Event "${e.id}" has an invalid start/end`);
    else if (en <= s) errors.push(`Event "${e.id}" ends before it starts`);
    if (!/[+-]\d{2}:\d{2}$|Z$/.test(e.start) || !/[+-]\d{2}:\d{2}$|Z$/.test(e.end))
      errors.push(`Event "${e.id}" times need a UTC offset (e.g. -04:00)`);
    if (!e.name || !e.venue || !e.address) errors.push(`Event "${e.id}" needs name, venue and address`);
  }
  for (const g of data.guests) {
    if (!g.name) errors.push('A guest row has no name');
    for (const id of g.invited) if (!ids.has(id)) errors.push(`Guest "${g.name}" invited to unknown event "${id}"`);
  }
  return errors;
}

/**
 * Extra names a guest may type, keyed by the name exactly as written in the guest sheet
 * (e.g. { "Ms. Nikita Jain": ["Nikki Jain"] }). Returns keys that matched nobody.
 */
export function applyAliases(guests: Guest[], aliases: Record<string, string[]>): string[] {
  const unmatched: string[] = [];
  for (const [key, list] of Object.entries(aliases)) {
    const hits = guests.filter((g) => g.name.trim().toLowerCase() === key.trim().toLowerCase());
    if (!hits.length) unmatched.push(key);
    for (const g of hits) g.aliases = [...new Set([...g.aliases, ...list.map((a) => a.trim()).filter(Boolean)])];
  }
  return unmatched;
}

/** Names (after title stripping) that belong to more than one household: those guests can't unlock by name alone. */
export function duplicateNames(guests: Guest[]): string[] {
  const byName = new Map<string, Set<string>>();
  for (const g of guests) {
    const k = normalizeName(g.name);
    if (!byName.has(k)) byName.set(k, new Set());
    byName.get(k)!.add(g.householdId);
  }
  return [...byName].filter(([, hh]) => hh.size > 1).map(([n]) => n);
}

export class PublishError extends Error {
  constructor(public problems: string[]) {
    super(`Publish blocked:\n - ${problems.join('\n - ')}`);
  }
}

/** Build guest-safe published data or throw with every problem found. */
export function buildPublished(input: {
  code: string;
  events: unknown;
  content: unknown;
  guestsCsv: string;
  aliases?: Record<string, string[]>;
  onWarn?: (message: string) => void;
}): PublishedData {
  const events = pickEvents(input.events);
  const content = pickContent(input.content);
  const skipped: string[] = [];
  const guests = guestsFromCsv(input.guestsCsv, events, (n) => skipped.push(n));
  if (skipped.length) input.onWarn?.(`Skipped ${skipped.length} placeholder name(s) that guests can't type: ${skipped.join('; ')}`);
  const unmatchedAliases = applyAliases(guests, input.aliases ?? {});
  if (unmatchedAliases.length) input.onWarn?.(`Alias entries that match no guest (check spelling): ${unmatchedAliases.join('; ')}`);
  const dups = duplicateNames(guests);
  if (dups.length) input.onWarn?.(`${dups.length} name(s) appear in more than one household; guests will be asked to select their party: ${dups.join('; ')}`);
  const data: PublishedData = { code: input.code.trim(), events, guests, content };

  const problems = validate(data);
  // Scan guest-visible copy (not names/codes) for private-sounding language.
  for (const { path, text } of [...strings(events, 'events'), ...strings(content, 'content')]) {
    const hit = findForbidden(text);
    if (hit) problems.push(`Forbidden term "${hit}" in ${path}`);
  }
  if (problems.length) throw new PublishError(problems);
  return data;
}
