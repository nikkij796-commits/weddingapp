import { describe, expect, it } from 'vitest';
import { GENERIC_FAILURE, RateLimiter, handleUnlock } from '../src/server/unlock';
import { sample } from './fixtures';

const data = sample();
const go = (name: unknown, code: unknown, lim = new RateLimiter(), key = 'ip') =>
  handleUnlock(data, { name, code }, lim, key);

describe('handleUnlock', () => {
  it('unlocks with correct name and code', () => {
    const r = go('Alex Rivera', 'FOREVER');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
  it('code is case-insensitive and trimmed', () => expect(go('Alex Rivera', '  forever ').status).toBe(200));
  it('rejects wrong code', () => expect(go('Alex Rivera', 'nope').status).toBe(401));
  it('rejects unknown name', () => expect(go('Zed Nobody', 'FOREVER').status).toBe(401));
  it('gives an identical message for wrong code and wrong name (no enumeration)', () => {
    const a = go('Alex Rivera', 'bad').body;
    const b = go('Zed Nobody', 'FOREVER').body;
    expect(a).toEqual(b);
    expect(a).toEqual({ ok: false, error: GENERIC_FAILURE });
  });
  it('rejects non-string and missing input', () => {
    expect(go(undefined, undefined).status).toBe(401);
    expect(go(123, {}).status).toBe(401);
    expect(go('', 'FOREVER').status).toBe(401);
  });
  it('rejects ambiguous names', () => expect(go('Sam Chn', 'FOREVER').status).toBe(401));

  it('only returns events the guest is invited to', () => {
    const r = go('Sam Chen', 'FOREVER');
    if (!r.body.ok) throw new Error('expected ok');
    expect(r.body.payload.events.map((e) => e.id)).toEqual(['ceremony']);
  });
  it('hides non-invited events entirely from the payload', () => {
    const r = go('Maria Garcia', 'FOREVER');
    const json = JSON.stringify(r.body);
    expect(json).not.toContain('Welcome Drinks');
    expect(json).not.toContain('Farewell Brunch');
  });
  it('shares a household itinerary (union) and lists household members', () => {
    const r = go('Jordan Rivera', 'FOREVER');
    if (!r.body.ok) throw new Error('expected ok');
    expect(r.body.payload.events.map((e) => e.id)).toEqual(['welcome', 'ceremony', 'reception', 'brunch']);
    expect(r.body.payload.householdNames).toEqual(['Alex Rivera', 'Jordan Rivera']);
  });
  it('never leaks other households or the code', () => {
    const json = JSON.stringify(go('Taylor OBrien', 'FOREVER').body);
    for (const leak of ['Alex Rivera', 'Sam Chen', 'Maria', 'FOREVER', 'householdId', 'aliases'])
      expect(json).not.toContain(leak);
  });
  it('returns events in chronological order', () => {
    const r = go('Taylor OBrien', 'FOREVER');
    if (!r.body.ok) throw new Error('expected ok');
    const starts = r.body.payload.events.map((e) => +new Date(e.start));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});

describe('rate limiting', () => {
  it('blocks after max failures and returns 429', () => {
    const lim = new RateLimiter(3);
    for (let i = 0; i < 3; i++) expect(go('x y', 'bad', lim).status).toBe(401);
    expect(go('Alex Rivera', 'FOREVER', lim).status).toBe(429);
  });
  it('is per client', () => {
    const lim = new RateLimiter(1);
    go('x y', 'bad', lim, 'a');
    expect(go('Alex Rivera', 'FOREVER', lim, 'b').status).toBe(200);
  });
  it('expires old failures', () => {
    let t = 0;
    const lim = new RateLimiter(2, 1000, () => t);
    go('x y', 'bad', lim);
    go('x y', 'bad', lim);
    expect(lim.blocked('ip')).toBe(true);
    t = 1001;
    expect(lim.blocked('ip')).toBe(false);
  });
  it('a success resets the counter', () => {
    const lim = new RateLimiter(3);
    go('x y', 'bad', lim);
    go('x y', 'bad', lim);
    go('Alex Rivera', 'FOREVER', lim);
    expect(lim.blocked('ip')).toBe(false);
  });
});

describe('select your party (shared names)', () => {
  const ask = (name: string, pick?: unknown, code: unknown = 'FOREVER', lim = new RateLimiter()) =>
    handleUnlock(data, { name, code, pick }, lim, 'ip');

  it('asks which party when the exact same name appears in two households', () => {
    const r = ask('Pat Kim');
    expect(r.status).toBe(409);
    expect(r.body).toEqual({
      ok: false,
      choose: [
        { index: 0, label: 'Pat Kim & Lee Kim' },
        { index: 1, label: 'Pat Kim' },
      ],
    });
  });
  it('a title or case difference still reaches the picker', () => expect(ask('dr. PAT kim').status).toBe(409));
  it('returns the chosen party itinerary', () => {
    const a = ask('Pat Kim', 0);
    const b = ask('Pat Kim', 1);
    if (!a.body.ok || !b.body.ok) throw new Error('expected ok');
    expect(a.body.payload.events.map((e) => e.id)).toEqual(['ceremony']);
    expect(a.body.payload.householdNames).toEqual(['Pat Kim', 'Lee Kim']);
    expect(b.body.payload.events.map((e) => e.id)).toEqual(['ceremony', 'reception']);
  });
  it('never shows the picker without the correct code', () => {
    const r = ask('Pat Kim', undefined, 'WRONG');
    expect(r.status).toBe(401);
    expect(JSON.stringify(r.body)).not.toMatch(/Lee Kim|choose/);
  });
  it('does not treat the picker as a failed attempt', () => {
    const lim = new RateLimiter(2);
    for (let i = 0; i < 5; i++) expect(ask('Pat Kim', undefined, 'FOREVER', lim).status).toBe(409);
    expect(lim.blocked('ip')).toBe(false);
  });
  it.each([-1, 2, 99, 0.5, '0', null, NaN])('rejects an invalid pick %j', (bad) => {
    const r = ask('Pat Kim', bad);
    expect([401, 409]).toContain(r.status);
    expect(r.body.ok).toBe(false);
    expect('payload' in r.body).toBe(false);
  });
  it('an out-of-range pick counts as a failure', () => {
    const lim = new RateLimiter(2);
    ask('Pat Kim', 7, 'FOREVER', lim);
    ask('Pat Kim', 7, 'FOREVER', lim);
    expect(lim.blocked('ip')).toBe(true);
  });
  it('fuzzy near-misses never reveal a picker (no name probing)', () => {
    const r = ask('Pat Kimm'); // equally close to two parties: must fail plainly, not list them
    expect(r.status).toBe(401);
    expect(JSON.stringify(r.body)).not.toMatch(/choose|Lee Kim/);
  });
  it('code ignores spaces and case', () => expect(ask('Alex Rivera', undefined, ' for ever ').status).toBe(200));
});
