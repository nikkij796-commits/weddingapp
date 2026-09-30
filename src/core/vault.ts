/**
 * Encrypted guest vault: lets a purely static host (GitHub Pages) keep the guest list private.
 *
 * Everything a guest can see is published as ciphertext. The wedding code is the only secret:
 *   K = PBKDF2(code, public salt)              stretched root key
 *   token(v)   = HMAC(K, "tok|v")              where to look a name variant up
 *   wrapKey(v) = HMAC(K, "wrap|v")             opens the index entry for exactly that variant
 * A typed name is matched by looking up itself plus every one-character deletion of it, which finds
 * names that differ by one substitution, insertion, deletion or swap. Each index entry unlocks only
 * that guest's own household file, so one household can never read another's.
 *
 * Runs unchanged in Node (publish, tests) and the browser (WebCrypto).
 */
import { normalizeName } from './matching';
import type { Content, EventInfo, Guest, GuestPayload, PublishedData } from './types';

export const VAULT_VERSION = 1;
export const DEFAULT_ITERATIONS = 200_000;

export const GENERIC_FAILURE =
  "We couldn't find that name and code. Please use the name on your invitation and the code printed on it.";

const te = new TextEncoder();
const td = new TextDecoder();
const subtle = globalThis.crypto.subtle;

const bytes = (u: Uint8Array) => u as unknown as BufferSource;
const rand = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

function b64(u: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
const hex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Case and spaces don't matter when typing the code. */
export function normalizeCode(code: string): string {
  return code.trim().toLowerCase().replace(/\s+/g, '');
}

async function deriveRoot(code: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await subtle.importKey('raw', bytes(te.encode(normalizeCode(code))), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', salt: bytes(salt), iterations, hash: 'SHA-256' }, base, 256);
  return subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function mac(root: CryptoKey, label: string): Promise<Uint8Array> {
  return new Uint8Array(await subtle.sign('HMAC', root, bytes(te.encode(label))));
}
const aes = (raw: Uint8Array) => subtle.importKey('raw', bytes(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
const tokenOf = async (root: CryptoKey, variant: string) => hex((await mac(root, `tok|${variant}`)).subarray(0, 8));
const wrapKeyOf = async (root: CryptoKey, variant: string) => aes(await mac(root, `wrap|${variant}`));
const contentKeyOf = async (root: CryptoKey) => aes(await mac(root, 'content'));

async function seal(key: CryptoKey, plain: string): Promise<string> {
  const iv = rand(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: bytes(iv) }, key, bytes(te.encode(plain))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64(out);
}

async function open(key: CryptoKey, sealed: string): Promise<string | null> {
  try {
    const u = unb64(sealed);
    return td.decode(await subtle.decrypt({ name: 'AES-GCM', iv: bytes(u.subarray(0, 12)) }, key, bytes(u.subarray(12))));
  } catch {
    return null;
  }
}

function deletions(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length; i++) out.add(s.slice(0, i) + s.slice(i + 1));
  return out;
}

/** Optimal-string-alignment distance: one insert, delete, substitute or adjacent swap = 1. */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

function partyLabel(members: Guest[]): string {
  const names = members.map((m) => m.name);
  return names.length <= 3 ? names.join(' & ') : `${names.slice(0, 2).join(' & ')} + ${names.length - 2} more`;
}

/** Names a guest may type: full name, first + last (middle names dropped), and any aliases. */
function nameKeys(g: Guest): Set<string> {
  const out = new Set<string>();
  const full = normalizeName(g.name);
  if (full) out.add(full);
  const tokens = full.split(' ');
  if (tokens.length > 2) out.add(`${tokens[0]} ${tokens[tokens.length - 1]}`);
  for (const a of g.aliases) {
    const n = normalizeName(a);
    if (n) out.add(n);
  }
  return out;
}

export interface VaultFiles {
  [path: string]: string;
}

interface Entry {
  b: string; // household file id
  k: string; // household key (base64)
  g: string; // guest name as written on the list
  p: string; // party label for the picker
  n: string; // the indexed (normalized) name
  x: 0 | 1; // 1 = this variant is the name itself, 0 = a one-character deletion
}

export async function buildVault(
  data: PublishedData,
  code: string,
  opts: { iterations?: number } = {},
): Promise<VaultFiles> {
  const iterations = opts.iterations ?? DEFAULT_ITERATIONS;
  const salt = rand(16);
  const root = await deriveRoot(code, salt, iterations);
  const files: VaultFiles = {};
  files['manifest.json'] = JSON.stringify({ v: VAULT_VERSION, salt: b64(salt), iter: iterations });
  files['content.json'] = JSON.stringify({ d: await seal(await contentKeyOf(root), JSON.stringify(data.content)) });

  const households = new Map<string, Guest[]>();
  for (const g of data.guests) households.set(g.householdId, [...(households.get(g.householdId) ?? []), g]);

  const shards = new Map<string, Map<string, string[]>>();
  const seen = new Set<string>();
  const start = (e: EventInfo) => new Date(e.start).getTime();

  for (const members of households.values()) {
    const blobId = hex(rand(16));
    const keyRaw = rand(32);
    const invited = new Set(members.flatMap((m) => m.invited));
    const events = data.events.filter((e) => invited.has(e.id)).sort((a, b) => start(a) - start(b));
    const plain = JSON.stringify({ names: members.map((m) => m.name), events });
    files[`hh/${blobId}.json`] = JSON.stringify({ d: await seal(await aes(keyRaw), plain) });

    const label = partyLabel(members);
    for (const g of members) {
      for (const n of nameKeys(g)) {
        const variants: { v: string; x: 0 | 1 }[] = [{ v: n, x: 1 }];
        // Typo tolerance needs two words, so a first name alone can't be used to probe the list.
        if (n.split(' ').length >= 2) for (const d of deletions(n)) variants.push({ v: d, x: 0 });
        for (const { v, x } of variants) {
          const dedupe = `${v}|${blobId}|${x}|${g.name}`;
          if (seen.has(dedupe)) continue;
          seen.add(dedupe);
          const entry: Entry = { b: blobId, k: b64(keyRaw), g: g.name, p: label, n, x };
          const token = await tokenOf(root, v);
          const shard = token.slice(0, 2);
          if (!shards.has(shard)) shards.set(shard, new Map());
          const sm = shards.get(shard)!;
          sm.set(token, [...(sm.get(token) ?? []), await seal(await wrapKeyOf(root, v), JSON.stringify(entry))]);
        }
      }
    }
  }
  for (const [shard, tokens] of shards) files[`idx/${shard}.json`] = JSON.stringify(Object.fromEntries(tokens));
  return files;
}

/** Returns file text, or null when the file doesn't exist. Throws on network errors. */
export type Fetcher = (path: string) => Promise<string | null>;

export interface PartyChoice {
  index: number;
  label: string;
}

export type Outcome =
  | { kind: 'ok'; payload: GuestPayload }
  | { kind: 'choose'; choices: PartyChoice[]; select: (index: number) => Promise<Outcome> }
  | { kind: 'fail'; error: string };

const FAIL: Outcome = { kind: 'fail', error: GENERIC_FAILURE };

function parse<T>(text: string | null): T | null {
  if (text == null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function unlockVault(fetcher: Fetcher, name: string, code: string): Promise<Outcome> {
  const typed = normalizeName(name);
  if (!typed || !normalizeCode(code)) return FAIL;

  const manifest = parse<{ v: number; salt: string; iter: number }>(await fetcher('manifest.json'));
  if (!manifest || manifest.v !== VAULT_VERSION) throw new Error('Guest data is unavailable right now.');
  const root = await deriveRoot(code, unb64(manifest.salt), manifest.iter);

  const multiWord = typed.split(' ').length >= 2;
  const variants = [typed, ...(multiWord ? deletions(typed) : [])];
  const tokens = await Promise.all(variants.map((v) => tokenOf(root, v)));

  const shardIds = [...new Set(tokens.map((t) => t.slice(0, 2)))];
  const shardData = new Map<string, Record<string, string[]> | null>();
  await Promise.all(
    shardIds.map(async (id) => shardData.set(id, parse<Record<string, string[]>>(await fetcher(`idx/${id}.json`)))),
  );

  const hits: { entry: Entry; variant: string }[] = [];
  for (let i = 0; i < variants.length; i++) {
    const list = shardData.get(tokens[i].slice(0, 2))?.[tokens[i]];
    if (!list?.length) continue;
    const key = await wrapKeyOf(root, variants[i]);
    for (const wrapped of list) {
      const plain = await open(key, wrapped);
      const entry = parse<Entry>(plain);
      if (entry) hits.push({ entry, variant: variants[i] });
    }
  }

  const exact = hits.filter((h) => h.variant === typed && h.entry.x === 1 && h.entry.n === typed);
  const pool = exact.length ? exact : multiWord ? hits.filter((h) => editDistance(typed, h.entry.n) <= 1) : [];
  const parties = new Map<string, Entry>();
  for (const h of pool) if (!parties.has(h.entry.b)) parties.set(h.entry.b, h.entry);

  const finish = async (entry: Entry): Promise<Outcome> => {
    const hh = parse<{ d: string }>(await fetcher(`hh/${entry.b}.json`));
    const cc = parse<{ d: string }>(await fetcher('content.json'));
    if (!hh || !cc) return FAIL;
    const household = parse<{ names: string[]; events: EventInfo[] }>(await open(await aes(unb64(entry.k)), hh.d));
    const content = parse<Content>(await open(await contentKeyOf(root), cc.d));
    if (!household || !content) return FAIL;
    return { kind: 'ok', payload: { guestName: entry.g, householdNames: household.names, events: household.events, content } };
  };

  if (parties.size === 0) return FAIL;
  const list = [...parties.values()];
  if (list.length === 1) return finish(list[0]);
  // The same exact name in several households: ask which one. A near-miss that lands on several
  // households fails plainly instead, so typing guesses can't be used to list other guests.
  if (!exact.length) return FAIL;
  return {
    kind: 'choose',
    choices: list.map((e, index) => ({ index, label: e.p })),
    select: async (index) => (Number.isInteger(index) && list[index] ? finish(list[index]) : FAIL),
  };
}
