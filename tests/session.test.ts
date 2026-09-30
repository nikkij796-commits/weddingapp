import { beforeAll, describe, expect, it } from 'vitest';
import {
  LEGACY_SESSION_KEY, SESSION_KEY, SESSION_MAX_AGE_MS, SESSION_VERSION, clearSession, loadSession, refreshSession, saveSession, type Session, type Store,
} from '../src/core/session';
import { normalizePayload } from '../src/core/payload';
import { buildVault, unlockVault, type Fetcher, type VaultFiles } from '../src/core/vault';
import { payloadFor, sample } from './fixtures';

function memory(initial: Record<string, string> = {}): Store & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}
const T0 = 1_800_000_000_000;
const base = () => ({ name: 'Alex Rivera', code: 'FOREVER', payload: payloadFor('Alex Rivera') });

describe('saving and loading', () => {
  it('round-trips a session, including the picked party', () => {
    const s = memory();
    saveSession(s, { ...base(), pick: 'Pat Kim & Lee Kim' }, T0);
    const r = loadSession(s, T0 + 1000);
    if (r.kind !== 'session') throw new Error('expected session');
    expect(r.session).toMatchObject({ v: SESSION_VERSION, at: T0, name: 'Alex Rivera', code: 'FOREVER', pick: 'Pat Kim & Lee Kim' });
    expect(r.session.payload.events).toHaveLength(4);
  });
  it('omits pick when there is none', () => {
    const s = memory();
    saveSession(s, base(), T0);
    const r = loadSession(s, T0);
    if (r.kind !== 'session') throw new Error('expected session');
    expect('pick' in r.session).toBe(false);
  });
  it('expires after the retention window', () => {
    const s = memory();
    saveSession(s, base(), T0);
    expect(loadSession(s, T0 + SESSION_MAX_AGE_MS - 1).kind).toBe('session');
    expect(loadSession(s, T0 + SESSION_MAX_AGE_MS + 1).kind).toBe('none');
    expect(s.map.has(SESSION_KEY)).toBe(false); // and is cleaned up
  });
  it('the window covers the whole wedding (at least 45 days)', () => expect(SESSION_MAX_AGE_MS).toBeGreaterThanOrEqual(45 * 86_400_000));
  it('rejects a session saved in the future (clock changes)', () => {
    const s = memory();
    saveSession(s, base(), T0 + 10_000_000);
    expect(loadSession(s, T0).kind).toBe('none');
  });
  it.each(['{not json', '"text"', 'null', '{}', '{"v":1}', '{"v":2,"at":1}', '[]'])('ignores and clears corrupt data %j', (bad) => {
    const s = memory({ [SESSION_KEY]: bad });
    expect(loadSession(s, T0).kind).toBe('none');
    expect(s.map.has(SESSION_KEY)).toBe(false);
  });
  it('rejects a session with no name or code, or an unusable payload', () => {
    for (const bad of [{ name: '', code: 'x' }, { name: 'a', code: '' }, { payload: { content: {} } }]) {
      const s = memory();
      saveSession(s, { ...base(), ...bad } as any, T0);
      expect(loadSession(s, T0).kind, JSON.stringify(bad)).toBe('none');
    }
  });
  it('an old-shaped saved payload is normalized on load, not rejected', () => {
    const p: any = payloadFor('Alex Rivera');
    delete p.content.rides;
    delete p.content.weather;
    const s = memory();
    saveSession(s, { ...base(), payload: p }, T0);
    const r = loadSession(s, T0);
    if (r.kind !== 'session') throw new Error('expected session');
    expect(r.session.payload.content.rides.voucher.code).toBe('');
    expect(r.session.payload.content.weather).toBeNull();
  });
  it('works with no storage at all', () => {
    expect(loadSession(null).kind).toBe('none');
    expect(() => saveSession(null, base())).not.toThrow();
    expect(() => clearSession(null)).not.toThrow();
  });
  it('survives storage that throws', () => {
    const bad: Store = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(loadSession(bad).kind).toBe('none');
    expect(() => saveSession(bad, base())).not.toThrow();
    expect(() => clearSession(bad)).not.toThrow();
  });
  it('clearSession removes both versions', () => {
    const s = memory({ [SESSION_KEY]: 'x', [LEGACY_SESSION_KEY]: 'y' });
    clearSession(s);
    expect(s.map.size).toBe(0);
  });
});

describe('the old version-1 session', () => {
  it('is dropped and reported so the guest sees the "guide was updated" notice once', () => {
    const s = memory({ [LEGACY_SESSION_KEY]: JSON.stringify({ at: T0, payload: payloadFor('Alex Rivera') }) });
    expect(loadSession(s, T0).kind).toBe('legacy');
    expect(s.map.has(LEGACY_SESSION_KEY)).toBe(false);
    expect(loadSession(s, T0).kind).toBe('none'); // the notice shows only once
  });
  it('a current session wins and the legacy copy is left alone', () => {
    const s = memory({ [LEGACY_SESSION_KEY]: 'old' });
    saveSession(s, base(), T0);
    expect(loadSession(s, T0).kind).toBe('session');
  });
});

describe('refreshSession (quietly re-downloading the guide)', () => {
  let files: VaultFiles;
  const fetcher = (): Fetcher => async (p) => files[p] ?? null;
  const session = (over: Partial<Session> = {}): Session => ({ v: 2, at: T0, name: 'Alex Rivera', code: 'FOREVER', payload: payloadFor('Alex Rivera'), ...over });
  beforeAll(async () => {
    files = await buildVault(sample(), 'FOREVER', { iterations: 1000 });
  });

  it('reports "unchanged" when nothing new was published', async () => {
    const fresh = await unlockVault(fetcher(), 'Alex Rivera', 'FOREVER');
    if (fresh.kind !== 'ok') throw new Error('expected ok');
    const r = await refreshSession(fetcher(), session({ payload: normalizePayload(fresh.payload)! }));
    expect(r).toEqual({ kind: 'unchanged' });
  });
  it('replaces an old-shaped saved copy with the new data', async () => {
    const old: any = payloadFor('Alex Rivera');
    delete old.content.rides;
    delete old.content.weather;
    delete old.content.meals;
    const r = await refreshSession(fetcher(), session({ payload: old }));
    if (r.kind !== 'updated') throw new Error(`expected updated, got ${r.kind}`);
    expect(r.payload.content.rides.voucher.code).toBe('SAMPLE-RIDE-50');
    expect(r.payload.content.weather?.latitude).toBe(40.71);
    expect(r.payload.content.meals.items.length).toBeGreaterThan(0);
  });
  it('picks up new announcements and schedule changes', async () => {
    const changed = sample();
    changed.content.updates = [{ id: 'n', at: '2027-06-10T09:00:00-04:00', message: 'Shuttles start at noon' }];
    changed.events = changed.events.map((e) => (e.id === 'ceremony' ? { ...e, start: '2027-06-12T16:30:00-04:00' } : e));
    const f = await buildVault(changed, 'FOREVER', { iterations: 1000 });
    const r = await refreshSession(async (p) => f[p] ?? null, session());
    if (r.kind !== 'updated') throw new Error('expected updated');
    expect(r.payload.content.updates[0].message).toBe('Shuttles start at noon');
    expect(r.payload.events.find((e) => e.id === 'ceremony')!.start).toBe('2027-06-12T16:30:00-04:00');
  });
  it('works after a republish (new random file ids and keys)', async () => {
    const f2 = await buildVault(sample(), 'FOREVER', { iterations: 1000 });
    expect((await refreshSession(async (p) => f2[p] ?? null, session())).kind).not.toBe('kept');
  });
  it('re-selects the saved party for a shared name', async () => {
    const s = session({ name: 'Pat Kim', pick: 'Pat Kim' , payload: payloadFor('Pat Kim') });
    const r = await refreshSession(fetcher(), { ...s, payload: { ...s.payload, guestName: 'stale' } });
    if (r.kind !== 'updated') throw new Error(`expected updated, got ${r.kind}`);
    expect(r.payload.householdNames).toEqual(['Pat Kim']);
    expect(r.payload.events.map((e) => e.id)).toEqual(['ceremony', 'reception']);
  });
  it('keeps the saved copy when the shared-name party no longer matches', async () => {
    const r = await refreshSession(fetcher(), session({ name: 'Pat Kim', pick: 'Somebody Else' }));
    expect(r).toEqual({ kind: 'kept', reason: 'no-match' });
    expect(await refreshSession(fetcher(), session({ name: 'Pat Kim' }))).toEqual({ kind: 'kept', reason: 'no-match' });
  });
  it('keeps the saved copy offline (network error)', async () => {
    const boom: Fetcher = async () => { throw new TypeError('Failed to fetch'); };
    expect(await refreshSession(boom, session())).toEqual({ kind: 'kept', reason: 'offline' });
  });
  it('keeps the saved copy when the code was changed (never logs the guest out)', async () => {
    expect(await refreshSession(fetcher(), session({ code: 'oldcode' }))).toEqual({ kind: 'kept', reason: 'rejected' });
  });
  it('keeps the saved copy when the vault is missing', async () => {
    expect(await refreshSession(async () => null, session())).toEqual({ kind: 'kept', reason: 'offline' });
  });
});
