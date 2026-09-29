import { describe, expect, it } from 'vitest';
import { countdown, currentOrNext, eventStatus, formatDay, formatTime, groupByDay, sortEvents } from '../src/core/time';
import { sample } from './fixtures';

const events = sample().events;
const at = (iso: string) => new Date(iso);

describe('eventStatus', () => {
  const e = events.find((x) => x.id === 'ceremony')!;
  it('upcoming', () => expect(eventStatus(e, at('2027-06-12T15:00:00-04:00'))).toBe('upcoming'));
  it('live at start', () => expect(eventStatus(e, at('2027-06-12T16:00:00-04:00'))).toBe('live'));
  it('live at end boundary', () => expect(eventStatus(e, at('2027-06-12T16:45:00-04:00'))).toBe('live'));
  it('past', () => expect(eventStatus(e, at('2027-06-12T16:45:01-04:00'))).toBe('past'));
});

describe('currentOrNext', () => {
  it('picks the first event before the weekend', () =>
    expect(currentOrNext(events, at('2027-01-01T00:00:00Z'))?.id).toBe('welcome'));
  it('picks the live event', () =>
    expect(currentOrNext(events, at('2027-06-12T17:30:00-04:00'))?.id).toBe('reception'));
  it('picks the next between events', () =>
    expect(currentOrNext(events, at('2027-06-12T00:00:00-04:00'))?.id).toBe('ceremony'));
  it('is undefined once everything is over', () =>
    expect(currentOrNext(events, at('2027-06-14T00:00:00-04:00'))).toBeUndefined());
  it('is undefined for no events', () => expect(currentOrNext([], new Date())).toBeUndefined());
});

describe('countdown', () => {
  it('computes days/hours/minutes', () =>
    expect(countdown(at('2027-06-12T16:00:00Z'), at('2027-06-10T13:30:00Z'))).toEqual({ days: 2, hours: 2, minutes: 30 }));
  it('returns null when passed', () => expect(countdown(at('2020-01-01T00:00:00Z'), new Date())).toBeNull());
  it('handles under a minute', () =>
    expect(countdown(at('2027-01-01T00:00:30Z'), at('2027-01-01T00:00:00Z'))).toEqual({ days: 0, hours: 0, minutes: 0 }));
});

describe('formatting in the wedding timezone', () => {
  it('formats the day', () => expect(formatDay('2027-06-12T16:00:00-04:00', 'America/New_York')).toBe('Saturday, June 12'));
  it('formats the time', () => expect(formatTime('2027-06-12T16:00:00-04:00', 'America/New_York')).toBe('4:00 PM'));
  it('uses the venue timezone, not the viewer', () =>
    expect(formatTime('2027-06-12T16:00:00-04:00', 'America/Los_Angeles')).toBe('1:00 PM'));
  it('date rolls per timezone for late events', () =>
    expect(formatDay('2027-06-13T03:00:00Z', 'America/New_York')).toBe('Saturday, June 12'));
});

describe('sort & group', () => {
  it('sorts chronologically', () => {
    const shuffled = [...events].reverse();
    expect(sortEvents(shuffled).map((e) => e.id)).toEqual(['welcome', 'ceremony', 'reception', 'brunch']);
  });
  it('groups by day', () => {
    const g = groupByDay(events, 'America/New_York');
    expect(g.map((x) => x.day)).toEqual(['Friday, June 11', 'Saturday, June 12', 'Sunday, June 13']);
    expect(g[1].events.map((e) => e.id)).toEqual(['ceremony', 'reception']);
  });
  it('does not mutate input', () => {
    const copy = [...events].reverse();
    const before = copy.map((e) => e.id);
    sortEvents(copy);
    expect(copy.map((e) => e.id)).toEqual(before);
  });
});

describe('events with an undecided time', () => {
  const tbd = { ...events.find((x) => x.id === 'brunch')!, timeTbd: true };
  const all = events.map((e) => (e.id === 'brunch' ? tbd : e));
  it('is never "live", even inside its placeholder window', () =>
    expect(eventStatus(tbd, at('2027-06-13T11:00:00-04:00'))).toBe('upcoming'));
  it('becomes past once its day is over', () => expect(eventStatus(tbd, at('2027-06-14T00:00:00-04:00'))).toBe('past'));
  it('is skipped for the countdown target', () =>
    expect(currentOrNext(all, at('2027-06-12T23:45:00-04:00'))).toBeUndefined());
  it('still sorts and groups with the rest', () => {
    const g = groupByDay(all, 'America/New_York');
    expect(g[g.length - 1].events.map((e) => e.id)).toEqual(['brunch']);
  });
});
