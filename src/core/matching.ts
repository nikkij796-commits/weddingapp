import type { Guest } from './types';

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof', 'late', 'shri', 'smt']);

export function normalizeName(raw: string): string {
  let s = raw.trim();
  // "Last, First" -> "First Last"
  if (s.includes(',')) {
    const [last, ...rest] = s.split(',');
    s = `${rest.join(' ')} ${last}`;
  }
  const out = s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripTitles(out);
}

/** "Dr. Neel Jain" and "Neel Jain" are the same person to a guest typing their name. */
function stripTitles(name: string): string {
  const tokens = name.split(' ');
  while (tokens.length > 1 && TITLES.has(tokens[0])) tokens.shift();
  return tokens.join(' ');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

export type MatchResult =
  | { kind: 'match'; guest: Guest }
  | { kind: 'ambiguous'; exact: boolean; guests: Guest[] }
  | { kind: 'none' };

interface Candidate {
  guest: Guest;
  name: string;
}

function candidatesFor(guest: Guest): Candidate[] {
  const out: Candidate[] = [];
  const full = normalizeName(guest.name);
  out.push({ guest, name: full });
  const tokens = full.split(' ');
  // Drop middle names: "Mary Jane Smith" also answers to "Mary Smith"
  if (tokens.length > 2) out.push({ guest, name: `${tokens[0]} ${tokens[tokens.length - 1]}` });
  for (const alias of guest.aliases) {
    const a = normalizeName(alias);
    if (a) out.push({ guest, name: a });
  }
  return out;
}

function allowedDistance(len: number): number {
  return len <= 8 ? 1 : 2;
}

function resolve(hits: Guest[], exact: boolean): MatchResult {
  const ids = new Set(hits.map((g) => g.id));
  if (ids.size === 1) return { kind: 'match', guest: hits[0] };
  const households = new Set(hits.map((g) => g.householdId));
  if (households.size === 1) return { kind: 'match', guest: hits[0] };
  return { kind: 'ambiguous', exact, guests: hits };
}

export function matchGuest(guests: Guest[], input: string): MatchResult {
  const n = normalizeName(input);
  if (!n) return { kind: 'none' };
  const cands = guests.flatMap(candidatesFor);

  const exact = cands.filter((c) => c.name === n).map((c) => c.guest);
  if (exact.length) return resolve(exact, true);

  // Fuzzy matching needs at least two words so a first name alone can't probe the list.
  if (n.split(' ').length < 2) return { kind: 'none' };

  let best = Infinity;
  let hits: Guest[] = [];
  for (const c of cands) {
    const d = levenshtein(n, c.name);
    if (d > allowedDistance(c.name.length)) continue;
    if (d < best) {
      best = d;
      hits = [c.guest];
    } else if (d === best) hits.push(c.guest);
  }
  return hits.length ? resolve(hits, false) : { kind: 'none' };
}
