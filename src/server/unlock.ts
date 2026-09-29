import { matchGuest } from '../core/matching';
import { sortEvents } from '../core/time';
import type { Guest, GuestPayload, PublishedData } from '../core/types';

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

export interface PartyChoice {
  index: number;
  label: string;
}

export interface UnlockResult {
  status: number;
  body:
    | { ok: true; payload: GuestPayload }
    | { ok: false; error: string }
    | { ok: false; choose: PartyChoice[] };
}

function safeEqual(a: string, b: string): boolean {
  const x = a.trim().toLowerCase().replace(/\s+/g, '');
  const y = b.trim().toLowerCase().replace(/\s+/g, '');
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

function partyLabel(members: Guest[]): string {
  const names = members.map((m) => m.name);
  return names.length <= 3 ? names.join(' & ') : `${names.slice(0, 2).join(' & ')} + ${names.length - 2} more`;
}

export function handleUnlock(
  data: PublishedData,
  input: { name?: unknown; code?: unknown; pick?: unknown },
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

  let guest: Guest;
  if (m.kind === 'match') guest = m.guest;
  else if (m.kind === 'ambiguous' && m.exact) {
    // The same name appears in more than one party: ask which one (only after the code was right).
    const parties: Guest[][] = [];
    for (const g of m.guests)
      if (!parties.some((p) => p[0].householdId === g.householdId))
        parties.push(data.guests.filter((x) => x.householdId === g.householdId));
    const pick = input.pick;
    if (typeof pick !== 'number' || !Number.isInteger(pick)) {
      return {
        status: 409,
        body: { ok: false, choose: parties.map((p, index) => ({ index, label: partyLabel(p) })) },
      };
    }
    if (pick < 0 || pick >= parties.length) return fail();
    const chosen = matchGuest(parties[pick], name);
    if (chosen.kind !== 'match') return fail();
    guest = chosen.guest;
  } else return fail();

  const household = data.guests.filter((g) => g.householdId === guest.householdId);
  const invitedIds = new Set(household.flatMap((g) => g.invited));
  const payload: GuestPayload = {
    guestName: guest.name,
    householdNames: household.map((g) => g.name),
    events: sortEvents(data.events.filter((e) => invitedIds.has(e.id))),
    content: data.content,
  };
  limiter.reset(clientKey);
  return { status: 200, body: { ok: true, payload } };
}
