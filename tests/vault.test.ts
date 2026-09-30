import { beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_ITERATIONS, GENERIC_FAILURE, buildVault, editDistance, normalizeCode, unlockVault,
  type Fetcher, type Outcome, type VaultFiles,
} from '../src/core/vault';
import { failureDelayMs } from '../src/core/vaultClient';
import { sample } from './fixtures';

const data = sample();
const CODE = 'FOREVER';
let files: VaultFiles;
const fetcherFor = (f: VaultFiles): Fetcher => async (p) => f[p] ?? null;
const go = (name: string, code = CODE, f = files) => unlockVault(fetcherFor(f), name, code);
const ok = async (name: string, code = CODE) => {
  const r = await go(name, code);
  if (r.kind !== 'ok') throw new Error(`expected ok for ${name}, got ${r.kind}`);
  return r.payload;
};
const kind = async (name: string, code = CODE) => (await go(name, code)).kind;
const ids = (p: { events: { id: string }[] }) => p.events.map((e) => e.id);

beforeAll(async () => {
  files = await buildVault(data, CODE, { iterations: 1000 });
});

describe('unlocking', () => {
  it('opens a household with the exact name and code', async () => {
    const p = await ok('Alex Rivera');
    expect(p.guestName).toBe('Alex Rivera');
    expect(ids(p)).toEqual(['welcome', 'ceremony', 'reception', 'brunch']);
  });
  it.each(['alex rivera', 'ALEX RIVERA', '  Alex   Rivera ', 'Rivera, Alex', 'Dr. Alex Rivera', 'Alexander Rivera'])('accepts %j', async (n) =>
    expect((await ok(n)).guestName).toBe('Alex Rivera'));
  it('ignores accents both ways', async () => {
    expect((await ok('Maria Jose Garcia')).guestName).toBe('María José García');
    expect((await ok('María José García')).guestName).toBe('María José García');
  });
  it('accepts aliases and nicknames, and drops middle names', async () => {
    expect((await ok("Tay O'Brien")).guestName).toBe("Taylor O'Brien");
    expect((await ok('Maria Garcia')).guestName).toBe('María José García');
    expect((await ok('Taylor OBrien')).guestName).toBe("Taylor O'Brien");
  });
  it('code is case- and space-insensitive', async () => {
    expect(await kind('Alex Rivera', ' for ever ')).toBe('ok');
    expect(await kind('Alex Rivera', 'forever')).toBe('ok');
  });
  it('shares a household itinerary and lists the party', async () => {
    const p = await ok('Jordan Rivera');
    expect(ids(p)).toEqual(['welcome', 'ceremony', 'reception', 'brunch']);
    expect(p.householdNames).toEqual(['Alex Rivera', 'Jordan Rivera']);
  });
  it('only includes invited events', async () => {
    const p = await ok('Sam Chen');
    expect(ids(p)).toEqual(['ceremony']);
    expect(JSON.stringify(p)).not.toMatch(/Welcome Drinks|Farewell Brunch|Grand Ballroom/);
  });
  it('returns shared content and events in time order', async () => {
    const p = await ok('Taylor OBrien');
    expect(p.content.welcome).toContain('guide');
    expect(p.content.faq.length).toBeGreaterThan(0);
    const starts = p.events.map((e) => +new Date(e.start));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
  it('never leaks other households, the code, or internal fields', async () => {
    const json = JSON.stringify(await ok('Taylor OBrien'));
    for (const leak of ['Alex Rivera', 'Sam Chen', 'Maria', 'FOREVER', 'householdId', 'aliases', 'invited']) expect(json).not.toContain(leak);
  });
});

describe('failures look identical (no probing)', () => {
  it('wrong code, unknown name, empty and first-name-only all give the same result', async () => {
    const results = await Promise.all([go('Alex Rivera', 'WRONG'), go('Zed Nobody'), go(''), go('Alex Rivera', ''), go('Alex')]);
    for (const r of results) expect(r).toEqual({ kind: 'fail', error: GENERIC_FAILURE });
  });
  it('a wrong code never reveals a picker', async () => expect(await kind('Pat Kim', 'nope')).toBe('fail'));
  it('fuzzy near-misses that hit two households fail plainly', async () => {
    expect(await kind('Sam Chn')).toBe('fail'); // Sam Chen and Sam Chan are both one edit away
    expect(await kind('Pat Kimm')).toBe('fail'); // both Pat Kim parties are one edit away
  });
});

describe('typo tolerance (one edit)', () => {
  it.each([
    ['substitution', 'Alex Rivara'],
    ['insertion', 'Alex Riveraa'],
    ['deletion', 'Alex Rivra'],
    ['swap', 'Alex Rivear'],
    ['first-name typo', 'Alez Rivera'],
  ])('%s', async (_l, typo) => expect((await ok(typo)).guestName).toBe('Alex Rivera'));
  it('two edits do not match', async () => {
    expect(await kind('Alx Rivrra')).toBe('fail');
    expect(await kind('Alex Riverxxa')).toBe('fail');
  });
  it('unrelated names do not match', async () => expect(await kind('Alexandra Riverton')).toBe('fail'));
});

describe('select your party', () => {
  it('asks which party when an exact name is shared', async () => {
    const r = await go('Pat Kim');
    if (r.kind !== 'choose') throw new Error('expected choose');
    expect(r.choices).toEqual([{ index: 0, label: 'Pat Kim & Lee Kim' }, { index: 1, label: 'Pat Kim' }]);
  });
  it('titles and case still reach the picker', async () => expect(await kind('dr. PAT kim')).toBe('choose'));
  it('returns the chosen party', async () => {
    const r = (await go('Pat Kim')) as Extract<Outcome, { kind: 'choose' }>;
    const a = await r.select(0);
    const b = await r.select(1);
    if (a.kind !== 'ok' || b.kind !== 'ok') throw new Error('expected ok');
    expect(a.payload.householdNames).toEqual(['Pat Kim', 'Lee Kim']);
    expect(ids(a.payload)).toEqual(['ceremony']);
    expect(ids(b.payload)).toEqual(['ceremony', 'reception']);
  });
  it.each([-1, 2, 99, 0.5, NaN])('rejects an invalid pick %j', async (bad) => {
    const r = (await go('Pat Kim')) as Extract<Outcome, { kind: 'choose' }>;
    expect((await r.select(bad)).kind).toBe('fail');
  });
});

describe('what is published is ciphertext', () => {
  const strings = (v: unknown, out: string[] = []): string[] => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
    else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
    return out;
  };
  it('has the expected layout', () => {
    const paths = Object.keys(files);
    expect(paths).toContain('manifest.json');
    expect(paths).toContain('content.json');
    expect(paths.filter((p) => p.startsWith('hh/'))).toHaveLength(7); // one per household
    for (const p of paths.filter((x) => x.startsWith('idx/'))) expect(p).toMatch(/^idx\/[0-9a-f]{2}\.json$/);
  });
  it('contains no readable guest, event, or code text anywhere', () => {
    const all = Object.values(files).join('\n');
    // Only strings that cannot occur by chance in random base64 (long, or containing spaces/punctuation).
    for (const secret of ['Rivera', 'Rosewood', 'Garden Terrace', 'Grand Ballroom', 'FOREVER', 'Lee Kim', 'Sam Chen', 'Ceremony', 'Sampleville', 'Farewell Brunch', "O'Brien"])
      expect(all, secret).not.toContain(secret);
  });
  it('every data string is long base64 (no short plaintext)', () => {
    for (const [path, text] of Object.entries(files)) {
      if (path === 'manifest.json') continue;
      for (const s of strings(JSON.parse(text))) {
        expect(s.length, `${path}: ${s}`).toBeGreaterThanOrEqual(40);
        expect(s).toMatch(/^[A-Za-z0-9+/=]+$/);
      }
    }
  });
  it('is randomized: two builds share no ciphertext, salt or file ids', async () => {
    const other = await buildVault(data, CODE, { iterations: 1000 });
    expect(JSON.parse(other['manifest.json']).salt).not.toBe(JSON.parse(files['manifest.json']).salt);
    const hh = (f: VaultFiles) => Object.keys(f).filter((p) => p.startsWith('hh/'));
    expect(hh(other).some((p) => hh(files).includes(p))).toBe(false);
    expect((await go('Alex Rivera', CODE, other)).kind).toBe('ok');
  });
  it('a different code builds a vault the old code cannot open', async () => {
    const other = await buildVault(data, 'someothercode', { iterations: 1000 });
    expect((await go('Alex Rivera', CODE, other)).kind).toBe('fail');
    expect((await go('Alex Rivera', 'someothercode', other)).kind).toBe('ok');
  });
  it('has a strong default work factor', async () => {
    expect(DEFAULT_ITERATIONS).toBeGreaterThanOrEqual(200_000);
    const strong = await buildVault({ ...data, guests: data.guests.slice(0, 2) }, CODE);
    expect(JSON.parse(strong['manifest.json']).iter).toBe(DEFAULT_ITERATIONS);
    const t = performance.now();
    expect((await go('Alex Rivera', CODE, strong)).kind).toBe('ok');
    expect(performance.now() - t).toBeLessThan(3000);
  });
});

describe('robustness', () => {
  it('a corrupted household file fails cleanly', async () => {
    const bad = { ...files };
    for (const p of Object.keys(bad)) if (p.startsWith('hh/')) bad[p] = JSON.stringify({ d: 'AAAA' + 'A'.repeat(80) });
    expect((await go('Alex Rivera', CODE, bad)).kind).toBe('fail');
  });
  it('a tampered index entry is ignored, not trusted', async () => {
    const bad = { ...files };
    for (const p of Object.keys(bad)) if (p.startsWith('idx/')) bad[p] = bad[p].replace(/"([A-Za-z0-9+/]{12})/g, '"X$1');
    expect((await go('Alex Rivera', CODE, bad)).kind).toBe('fail');
  });
  it('missing or garbled content fails cleanly', async () => {
    const noContent = { ...files };
    delete noContent['content.json'];
    expect((await go('Alex Rivera', CODE, noContent)).kind).toBe('fail');
    expect((await go('Alex Rivera', CODE, { ...files, 'content.json': '{not json' })).kind).toBe('fail');
  });
  it('a missing or unsupported manifest throws a friendly error', async () => {
    await expect(go('Alex Rivera', CODE, {})).rejects.toThrow(/unavailable/);
    await expect(go('Alex Rivera', CODE, { ...files, 'manifest.json': '{"v":99}' })).rejects.toThrow(/unavailable/);
  });
  it('network errors propagate so the UI can say "check your connection"', async () => {
    const boom: Fetcher = async () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(unlockVault(boom, 'Alex Rivera', CODE)).rejects.toThrow('Failed to fetch');
  });
  it('a guest list with no aliases or middle names still builds and unlocks', async () => {
    const small = await buildVault({ ...data, guests: [{ id: 'g', name: 'Ann Lee', aliases: [], householdId: 'h', invited: ['ceremony'] }] }, 'abcd', { iterations: 1000 });
    expect((await go('Ann Lee', 'abcd', small)).kind).toBe('ok');
  });
});

describe('helpers', () => {
  it.each([['abc', 'abc', 0], ['abc', 'abd', 1], ['abc', 'ab', 1], ['abc', 'abcd', 1], ['abcd', 'abdc', 1], ['abc', 'xyz', 3], ['', 'ab', 2]])(
    'editDistance(%s,%s)=%i', (a, b, d) => expect(editDistance(a as string, b as string)).toBe(d));
  it('normalizeCode', () => {
    expect(normalizeCode('  Lu Ke ')).toBe('luke');
    expect(normalizeCode('FOREVER')).toBe('forever');
  });
  it('failureDelayMs starts after a few misses and caps', () => {
    expect([0, 1, 2].map(failureDelayMs)).toEqual([0, 0, 0]);
    expect(failureDelayMs(3)).toBe(1000);
    expect(failureDelayMs(4)).toBe(2000);
    expect(failureDelayMs(50)).toBe(8000);
  });
});

describe('encrypted images (the invitation cover)', () => {
  const COVER = `data:image/jpeg;base64,${Buffer.from('fake-jpeg-bytes').toString('base64')}`;
  const withCover = async () => buildVault({ ...data, content: { ...data.content, coverImage: 'cover' } }, CODE, { iterations: 1000, images: { cover: COVER } });
  it('is sealed, and comes back with the guest\'s guide after unlocking', async () => {
    const f = await withCover();
    expect(f['img/cover.json']).toBeDefined();
    expect(f['img/cover.json']).not.toContain(COVER.split(',')[1]);
    const r = await go('Alex Rivera', CODE, f);
    expect(r.kind === 'ok' && r.payload.cover).toBe(COVER);
  });
  it('a wrong code gets nothing, and a missing image never blocks unlocking', async () => {
    const f = await withCover();
    expect((await go('Alex Rivera', 'WRONG', f)).kind).toBe('fail');
    delete f['img/cover.json'];
    const r = await go('Alex Rivera', CODE, f);
    expect(r.kind).toBe('ok');
    expect(r.kind === 'ok' && r.payload.cover).toBeUndefined();
  });
  it('rejects unsafe image names', async () => {
    await expect(buildVault(data, CODE, { iterations: 1000, images: { '../x': COVER } })).rejects.toThrow('Bad image name');
  });
});
