import type { EventInfo } from './types';

export type EventStatus = 'upcoming' | 'live' | 'past';

export function eventStatus(e: EventInfo, now: Date): EventStatus {
  const t = now.getTime();
  if (t < new Date(e.start).getTime()) return 'upcoming';
  if (t <= new Date(e.end).getTime()) return 'live';
  return 'past';
}

export function sortEvents(events: EventInfo[]): EventInfo[] {
  return [...events].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

/** The live event if any, otherwise the next upcoming one. */
export function currentOrNext(events: EventInfo[], now: Date): EventInfo | undefined {
  const sorted = sortEvents(events);
  return (
    sorted.find((e) => eventStatus(e, now) === 'live') ??
    sorted.find((e) => eventStatus(e, now) === 'upcoming')
  );
}

export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
}

export function countdown(target: Date, now: Date): Countdown | null {
  const ms = target.getTime() - now.getTime();
  if (ms <= 0) return null;
  const totalMin = Math.floor(ms / 60000);
  return {
    days: Math.floor(totalMin / 1440),
    hours: Math.floor((totalMin % 1440) / 60),
    minutes: totalMin % 60,
  };
}

export function formatDay(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: tz,
  }).format(new Date(iso));
}

export function formatTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
  }).format(new Date(iso));
}

/** Group by calendar day in the wedding's timezone, preserving chronological order. */
export function groupByDay(events: EventInfo[], tz: string): { day: string; events: EventInfo[] }[] {
  const groups: { day: string; events: EventInfo[] }[] = [];
  for (const e of sortEvents(events)) {
    const day = formatDay(e.start, tz);
    const g = groups.find((x) => x.day === day);
    if (g) g.events.push(e);
    else groups.push({ day, events: [e] });
  }
  return groups;
}
