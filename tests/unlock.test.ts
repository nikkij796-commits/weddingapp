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
