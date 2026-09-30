/**
 * The guest's weekend as a timeline: which meals they get, and what is happening now / next.
 * Times are compared as local "YYYY-MM-DD HH:MM" strings in the wedding's time zone.
 */
import type { EventInfo, GuestPayload, MealItem } from './types';
import { ymdInTimezone } from './weather';

export const localHm = (iso: string | Date, tz: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

export const localKey = (d: Date, tz: string) => `${ymdInTimezone(d, tz)} ${localHm(d, tz)}`;

export interface MealRow {
  m: MealItem;
  e?: EventInfo;
  day: string;
  /** local HH:MM used for ordering */
  at: string;
  /** local HH:MM when it is over, if known */
  until?: string;
}

/** A meal shows for everyone invited to its event, or (with a date) for anyone with an event that day. */
export function mealRows(p: GuestPayload): MealRow[] {
  const tz = p.content.timezone;
  const byId = new Map(p.events.map((e) => [e.id, e]));
  const dayOf = (e: EventInfo) => ymdInTimezone(new Date(e.start), tz);
  const guestDays = new Set(p.events.map(dayOf));
  const rows = (p.content.meals?.items ?? []).flatMap((m): MealRow[] => {
    if (m.eventId) {
      const e = byId.get(m.eventId);
      if (!e) return [];
      const at = m.start ?? (e.timeTbd ? '12:00' : localHm(e.start, tz));
      const until = m.end ?? (m.start || e.timeTbd ? undefined : localHm(e.end, tz));
      return [{ m, e, day: dayOf(e), at, until }];
    }
    if (m.date && guestDays.has(m.date)) return [{ m, day: m.date, at: m.start ?? '12:00', until: m.end }];
    return [];
  });
  return rows.sort((a, b) => (a.day + a.at).localeCompare(b.day + b.at));
}

export interface NowNext {
  /** true from 24 hours before the guest's first event until 6 hours after the last one ends */
  weekend: boolean;
  live: EventInfo[];
  next?: EventInfo;
  meal?: { row: MealRow; serving: boolean };
}

export function nowNext(p: GuestPayload, now: Date): NowNext {
  const tz = p.content.timezone;
  const timed = p.events.filter((e) => !e.timeTbd).sort((a, b) => +new Date(a.start) - +new Date(b.start));
  if (!timed.length) return { weekend: false, live: [] };
  const t = +now;
  const weekend = t >= +new Date(timed[0].start) - 24 * 3600_000 && t <= Math.max(...timed.map((e) => +new Date(e.end))) + 6 * 3600_000;
  const live = timed.filter((e) => +new Date(e.start) <= t && t < +new Date(e.end));
  const next = timed.find((e) => +new Date(e.start) > t);
  const key = localKey(now, tz);
  // Meals not over yet. If several are being served (e.g. cocktails running into dinner), show the latest to start.
  const open = mealRows(p).filter((r) => `${r.day} ${r.until ?? r.at}` > key);
  const serving = open.filter((r) => `${r.day} ${r.at}` <= key);
  const row = serving.length ? serving[serving.length - 1] : open[0];
  const meal = row ? { row, serving: serving.includes(row) } : undefined;
  return { weekend, live, next, meal };
}

/** "Today", "Tomorrow", or the weekday, for a local day relative to now. */
export function relativeDay(ymd: string, now: Date, tz: string): string {
  const today = ymdInTimezone(now, tz);
  if (ymd === today) return 'Today';
  const tomorrow = ymdInTimezone(new Date(+now + 24 * 3600_000), tz);
  if (ymd === tomorrow) return 'Tomorrow';
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

/** Map letters in an area like "Cholla Lawn (D) + Foundry Ballroom (J)" -> [{ name: 'Cholla Lawn', letter: 'D' }, ...] */
export function areaSpots(area: string | undefined): { name: string; letter: string }[] {
  return (area ?? '')
    .split('+')
    .map((part) => part.trim().match(/^(.*?)\s*\(([A-Z])\)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ name: m[1], letter: m[2] }));
}
