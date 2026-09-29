import { matchGuest } from '../core/matching';
import { sortEvents } from '../core/time';
import type { GuestPayload, PublishedData } from '../core/types';

export const GENERIC_FAILURE =
  "We couldn't find that name and code. Please use the name on your invitation and the code printed on it.";

/** Sliding-window limiter on failed attempts, keyed by client. */
export class RateLimiter {
  private fails = new Map<string, number[]>();
  constructor(
    private max = 8,
    private windowMs = 10 * 60 * 1000,
    private now: () => number = Date.now,
  ) {}

  private recent(key: string): number[] {
    const t = this.now();
    const list = (this.fails.get(key) ?? []).filter((x) => t - x < this.windowMs);
    this.fails.set(key, list);
    return list;
  }
  blocked(key: string): boolean {
    return this.recent(key).length >= this.max;
  }
  recordFailure(key: string): void {
    this.recent(key).push(this.now());
  }
  reset(key: string): void {
    this.fails.delete(key);
  }
}

export interface UnlockResult {
  status: number;
  body: { ok: true; payload: GuestPayload } | { ok: false; error: string };
}

function safeEqual(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

export function handleUnlock(
  data: PublishedData,
  input: { name?: unknown; code?: unknown },
  limiter: RateLimiter,
  clientKey: string,
): UnlockResult {
  if (limiter.blocked(clientKey))
    return { status: 429, body: { ok: false, error: 'Too many attempts. Please wait a few minutes and try again.' } };

  const name = typeof input.name === 'string' ? input.name.slice(0, 100) : '';
  const code = typeof input.code === 'string' ? input.code.slice(0, 50) : '';
  const fail = (): UnlockResult => {
    limiter.recordFailure(clientKey);
    return { status: 401, body: { ok: false, error: GENERIC_FAILURE } };
  };

  // Check the code first so a wrong code reveals nothing about which names exist.
  if (!name.trim() || !safeEqual(code, data.code)) return fail();
  const m = matchGuest(data.guests, name);
  if (m.kind !== 'match') return fail();

  const household = data.guests.filter((g) => g.householdId === m.guest.householdId);
  const invitedIds = new Set(household.flatMap((g) => g.invited));
  const payload: GuestPayload = {
    guestName: m.guest.name,
    householdNames: household.map((g) => g.name),
    events: sortEvents(data.events.filter((e) => invitedIds.has(e.id))),
    content: data.content,
  };
  limiter.reset(clientKey);
  return { status: 200, body: { ok: true, payload } };
}
