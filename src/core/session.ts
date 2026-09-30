import { normalizePayload } from './payload';
import type { GuestPayload } from './types';
import { unlockVault, type Fetcher } from './vault';

export const SESSION_VERSION = 2;
export const SESSION_KEY = 'wedding.session.v2';
/** Version 1 saved only the data (no way to refresh it), so it is dropped and the guest signs in once more. */
export const LEGACY_SESSION_KEY = 'wedding.session.v1';
/** Long enough to cover the whole wedding weekend. */
export const SESSION_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;

export type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * What is kept on the guest's own phone. The name and code let the app quietly re-download the
 * guide (so later updates arrive by themselves). The code is shared with every guest anyway.
 */
export interface Session {
  v: number;
  at: number;
  name: string;
  code: string;
  /** Party the guest picked when their name was shared by several parties. */
  pick?: string;
  payload: GuestPayload;
}

export type LoadResult = { kind: 'session'; session: Session } | { kind: 'legacy' } | { kind: 'none' };

export function loadSession(store: Store | null, now = Date.now()): LoadResult {
  if (!store) return { kind: 'none' };
  try {
    const raw = store.getItem(SESSION_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Session>;
      const payload = normalizePayload(s.payload);
      const fresh = typeof s.at === 'number' && now - s.at >= 0 && now - s.at < SESSION_MAX_AGE_MS;
      if (s.v === SESSION_VERSION && fresh && typeof s.name === 'string' && typeof s.code === 'string' && s.name && s.code && payload) {
        const session: Session = { v: SESSION_VERSION, at: s.at!, name: s.name, code: s.code, payload };
        if (typeof s.pick === 'string' && s.pick) session.pick = s.pick;
        return { kind: 'session', session };
      }
      store.removeItem(SESSION_KEY);
    }
    if (store.getItem(LEGACY_SESSION_KEY) !== null) {
      store.removeItem(LEGACY_SESSION_KEY);
      return { kind: 'legacy' };
    }
  } catch {
    try {
      store.removeItem(SESSION_KEY);
    } catch {
      /* storage unavailable */
    }
  }
  return { kind: 'none' };
}

export function saveSession(store: Store | null, s: Omit<Session, 'v' | 'at'>, now = Date.now()): void {
  try {
    store?.setItem(SESSION_KEY, JSON.stringify({ ...s, v: SESSION_VERSION, at: now }));
  } catch {
    /* private mode or storage full: the guest just signs in again next time */
  }
}

export function clearSession(store: Store | null): void {
  try {
    store?.removeItem(SESSION_KEY);
    store?.removeItem(LEGACY_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export type RefreshResult =
  | { kind: 'updated'; payload: GuestPayload }
  | { kind: 'unchanged' }
  /** The saved copy stays in use: offline, a changed code, or a party that no longer matches. */
  | { kind: 'kept'; reason: 'offline' | 'rejected' | 'no-match' };

/**
 * Quietly re-downloads a guest's guide using the saved name and code, so announcements, vouchers,
 * menus and any updated schema reach phones that unlocked earlier. Never signs the guest out.
 */
export async function refreshSession(fetcher: Fetcher, session: Session): Promise<RefreshResult> {
  let raw: GuestPayload;
  try {
    const outcome = await unlockVault(fetcher, session.name, session.code);
    if (outcome.kind === 'ok') raw = outcome.payload;
    else if (outcome.kind === 'choose') {
      const choice = session.pick ? outcome.choices.find((c) => c.label === session.pick) : undefined;
      if (!choice) return { kind: 'kept', reason: 'no-match' };
      const picked = await outcome.select(choice.index);
      if (picked.kind !== 'ok') return { kind: 'kept', reason: 'rejected' };
      raw = picked.payload;
    } else return { kind: 'kept', reason: 'rejected' };
  } catch {
    return { kind: 'kept', reason: 'offline' };
  }
  const next = normalizePayload(raw);
  if (!next) return { kind: 'kept', reason: 'rejected' };
  return JSON.stringify(next) === JSON.stringify(session.payload) ? { kind: 'unchanged' } : { kind: 'updated', payload: next };
}
