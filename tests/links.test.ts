import { describe, expect, it } from 'vitest';
import { appleMapsUrl, buildIcs, foldLine, googleCalendarUrl, googleMapsUrl, icsEscape, uberRideUrl } from '../src/core/links';
import { sample } from './fixtures';

const events = sample().events;

describe('map links', () => {
  it('encodes google maps query', () => {
    const u = new URL(googleMapsUrl(events[0]));
    expect(u.hostname).toBe('www.google.com');
    expect(u.searchParams.get('query')).toBe('The Garden Terrace, 100 Example Street, Sampleville, NY 10001');
  });
  it('encodes apple maps query', () => {
    const u = new URL(appleMapsUrl(events[0]));
    expect(u.hostname).toBe('maps.apple.com');
    expect(u.searchParams.get('q')).toContain('Garden Terrace');
  });
  it('survives special characters', () => {
    const u = new URL(googleMapsUrl({ venue: 'Bob & Sue\'s "Place"', address: '1 A St #2' }));
    expect(u.searchParams.get('query')).toBe('Bob & Sue\'s "Place", 1 A St #2');
  });
});

describe('ics', () => {
  const stamp = new Date('2027-01-01T00:00:00Z');
  const ics = buildIcs(events, 'Wedding Weekend', stamp);
  it('has calendar wrapper', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });
  it('has one VEVENT per event', () => expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(events.length));
  it('converts times to UTC', () => expect(ics).toContain('DTSTART:20270612T200000Z'));
  it('uses CRLF and never bare LF', () => expect(ics.replace(/\r\n/g, '')).not.toMatch(/\n/));
  it('has unique UIDs', () => {
    const uids = ics.match(/UID:.+/g)!;
    expect(new Set(uids).size).toBe(events.length);
  });
  it('folds no line beyond 75 octets', () => {
    for (const l of ics.split('\r\n')) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
  });
  it('escapes special characters', () => expect(icsEscape('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne'));
  it('folds long lines and unfolds back to original', () => {
    const long = 'X:' + 'é'.repeat(100);
    expect(foldLine(long).split('\r\n').length).toBeGreaterThan(1);
    expect(foldLine(long).replace(/\r\n /g, '')).toBe(long);
  });
  it('builds a google calendar url', () => {
    const u = new URL(googleCalendarUrl(events[1]));
    expect(u.searchParams.get('text')).toBe('Ceremony');
    expect(u.searchParams.get('dates')).toBe('20270612T200000Z/20270612T204500Z');
  });
});

describe('events without a dress code', () => {
  const e = { ...events[3], dressCode: '', description: 'Goodbye brunch.' };
  it('ics description omits the empty dress code', () => {
    const ics = buildIcs([e], 'x');
    expect(ics).toContain('DESCRIPTION:Goodbye brunch.');
    expect(ics).not.toMatch(/Dress code/);
  });
  it('google calendar details omit it too', () =>
    expect(new URL(googleCalendarUrl(e)).searchParams.get('details')).toBe('Goodbye brunch.'));
});

describe('Uber deep link', () => {
  it('sets pickup to the rider and fills in the destination', () => {
    const u = new URL(uberRideUrl({ name: 'Andaz Scottsdale Resort', address: '6114 N Scottsdale Rd, Scottsdale, AZ 85253' }));
    expect(u.origin + u.pathname).toBe('https://m.uber.com/ul/');
    expect(u.searchParams.get('action')).toBe('setPickup');
    expect(u.searchParams.get('pickup')).toBe('my_location');
    expect(u.searchParams.get('dropoff[nickname]')).toBe('Andaz Scottsdale Resort');
    expect(u.searchParams.get('dropoff[formatted_address]')).toBe('6114 N Scottsdale Rd, Scottsdale, AZ 85253');
  });
  it('encodes special characters safely', () => {
    const u = new URL(uberRideUrl({ name: "Bob's & Sue's", address: '1 A St #2' }));
    expect(u.searchParams.get('dropoff[nickname]')).toBe("Bob's & Sue's");
    expect(u.searchParams.get('dropoff[formatted_address]')).toBe('1 A St #2');
  });
});

describe('event area in calendar locations', () => {
  const withArea = { ...events[1], area: 'Rose Lawn' }; // the ceremony, at Rosewood Chapel
  it('is part of the ics and Google Calendar location', () => {
    const ics = buildIcs([withArea], 'x').replace(/\r\n /g, ''); // undo line folding
    expect(ics).toContain('LOCATION:Rosewood Chapel\\, Rose Lawn\\, 200 Example Avenue\\, Sampleville\\, NY 10001');
    expect(new URL(googleCalendarUrl(withArea)).searchParams.get('location')).toBe('Rosewood Chapel, Rose Lawn, 200 Example Avenue, Sampleville, NY 10001');
  });
  it('is left out when there is none', () => {
    expect(new URL(googleCalendarUrl(events[1])).searchParams.get('location')).toBe('Rosewood Chapel, 200 Example Avenue, Sampleville, NY 10001');
  });
});
