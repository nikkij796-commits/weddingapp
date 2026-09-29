import { parseCsv } from './csv';
import type { Content, EventInfo, Guest, InfoItem, PublishedData } from './types';

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

function pickItems(v: unknown): InfoItem[] {
  if (!Array.isArray(v)) return [];
  return v.map((i) => {
    const item: InfoItem = { title: str(i?.title), body: str(i?.body) };
    const url = str(i?.url);
    if (url) item.url = url;
    return item;
  });
}

export function pickEvents(raw: unknown): EventInfo[] {
  if (!Array.isArray(raw)) return [];
  // Allowlist: only these keys survive, whatever else the source file contains.
  return raw.map((e) => ({
    id: str(e?.id),
    name: str(e?.name),
    start: str(e?.start),
    end: str(e?.end),
    venue: str(e?.venue),
    address: str(e?.address),
    dressCode: str(e?.dressCode),
    dressNotes: str(e?.dressNotes),
    description: str(e?.description),
  }));
}

export function pickContent(raw: any): Content {
  return {
    coupleNames: str(raw?.coupleNames),
    tagline: str(raw?.tagline),
    timezone: str(raw?.timezone),
    welcome: str(raw?.welcome),
    travel: pickItems(raw?.travel),
    lodging: pickItems(raw?.lodging),
    faq: Array.isArray(raw?.faq) ? raw.faq.map((f: any) => ({ q: str(f?.q), a: str(f?.a) })) : [],
    contact: { label: str(raw?.contact?.label), detail: str(raw?.contact?.detail) },
    updates: Array.isArray(raw?.updates)
      ? raw.updates.map((u: any) => ({ id: str(u?.id), at: str(u?.at), message: str(u?.message) }))
      : [],
  };
}

const truthy = (v: string) => /^(y|yes|true|1|x|✓)$/i.test(v.trim());

/**
 * Guest sheet: Name, Aliases (semicolon separated), Household, then one Yes/No column per event.
 * Event columns are matched by event id or event name (case-insensitive). Any other column
 * (dietary notes, table numbers, addresses, ...) is ignored and never published.
 */
export function guestsFromCsv(csv: string, events: EventInfo[]): Guest[] {
  const rows = parseCsv(csv);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const nameCol = col('name');
  if (nameCol < 0) throw new Error('Guest list is missing a "Name" column');
  const aliasCol = col('aliases');
  const hhCol = col('household');
  const eventCols = events.map((e) => {
    let idx = header.indexOf(e.id.toLowerCase());
    if (idx < 0) idx = header.indexOf(e.name.toLowerCase());
    return { id: e.id, idx };
  });
  return rows.slice(1).map((r, i) => {
    const name = (r[nameCol] ?? '').trim();
    const household = hhCol >= 0 ? (r[hhCol] ?? '').trim() : '';
    return {
      id: `g${i + 1}`,
      name,
      aliases: aliasCol >= 0 ? (r[aliasCol] ?? '').split(';').map((a) => a.trim()).filter(Boolean) : [],
      householdId: household || `solo-${i + 1}`,
      invited: eventCols.filter((c) => c.idx >= 0 && truthy(r[c.idx] ?? '')).map((c) => c.id),
    };
  });
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
  const seen = new Set<string>();
  for (const g of data.guests) {
    if (!g.name) errors.push('A guest row has no name');
    if (seen.has(g.name.toLowerCase())) errors.push(`Duplicate guest name "${g.name}"`);
    seen.add(g.name.toLowerCase());
    for (const id of g.invited) if (!ids.has(id)) errors.push(`Guest "${g.name}" invited to unknown event "${id}"`);
  }
  return errors;
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
}): PublishedData {
  const events = pickEvents(input.events);
  const content = pickContent(input.content);
  const guests = guestsFromCsv(input.guestsCsv, events);
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
