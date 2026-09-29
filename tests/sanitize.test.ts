import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/core/csv';
import { PublishError, buildPublished, findForbidden, guestsFromCsv, pickEvents } from '../src/core/sanitize';
import { sample } from './fixtures';

const base = sample();
const csv = [
  'Name,Aliases,Household,Dietary,Table,Welcome Drinks,ceremony,reception,brunch',
  'Alex Rivera,Alexander Rivera; Al,h1,vegan,4,Yes,yes,Y,',
  '"Rivera, Jordan",,h1,,4,,YES,no,',
  'Pat Lee,,,nut allergy,9,,x,1,true',
].join('\n');
const build = (over: Record<string, unknown> = {}) =>
  buildPublished({ code: 'SECRET', events: base.events, content: base.content, guestsCsv: csv, ...over });

describe('parseCsv', () => {
  it('handles quotes, commas, escaped quotes and CRLF', () =>
    expect(parseCsv('a,"b,c","d""e"\r\n1,2,3\r\n')).toEqual([['a', 'b,c', 'd"e'], ['1', '2', '3']]));
  it('handles embedded newlines', () => expect(parseCsv('a,"x\ny"\n')).toEqual([['a', 'x\ny']]));
  it('skips blank lines and strips BOM', () => expect(parseCsv('﻿a,b\n\n,\nc,d')).toEqual([['a', 'b'], ['c', 'd']]));
  it('handles no trailing newline', () => expect(parseCsv('a,b')).toEqual([['a', 'b']]));
});

describe('guestsFromCsv', () => {
  const guests = guestsFromCsv(csv, base.events);
  it('reads names, aliases and households', () => {
    expect(guests[0]).toMatchObject({ name: 'Alex Rivera', aliases: ['Alexander Rivera', 'Al'], householdId: 'h1' });
  });
  it('supports event columns by name and by id, Yes/Y/x/1/true', () => {
    expect(guests[0].invited).toEqual(['welcome', 'ceremony', 'reception']);
    expect(guests[2].invited).toEqual(['ceremony', 'reception', 'brunch']);
  });
  it('handles quoted names with commas', () => expect(guests[1].name).toBe('Rivera, Jordan'));
  it('gives solo guests their own household', () => expect(guests[2].householdId).toBe('solo-3'));
  it('never carries over unlisted columns like dietary or table', () => {
    const json = JSON.stringify(guests);
    expect(json).not.toMatch(/vegan|nut allergy|Dietary|table/i);
  });
  it('requires a Name column', () => expect(() => guestsFromCsv('Foo\nbar', base.events)).toThrow(/Name/));
  it('returns nothing for an empty sheet', () => expect(guestsFromCsv('', base.events)).toEqual([]));
});

describe('pickEvents allowlist', () => {
  it('drops unknown fields such as cost or vendor', () => {
    const [e] = pickEvents([{ ...base.events[0], vendorName: 'Acme Floral', cost: 9000, notes: 'private' }]);
    expect(Object.keys(e).sort()).toEqual(
      ['address', 'description', 'dressCode', 'dressNotes', 'end', 'id', 'name', 'start', 'venue'],
    );
    expect(JSON.stringify(e)).not.toMatch(/Acme|9000|private/);
  });
  it('tolerates garbage input', () => expect(pickEvents('nope')).toEqual([]));
});

describe('findForbidden', () => {
  it.each(['Our budget is tight', 'see contract', 'Vendor: Acme', 'Invoice #2', 'deposit due', 'Paid $5,000', 'CONFIDENTIAL'])(
    'flags %s',
    (t) => expect(findForbidden(t)).not.toBeNull(),
  );
  it.each(['Join us for dinner', 'Semi-formal attire', 'Parking is free', 'Text (555) 010-0100'])(
    'allows %s',
    (t) => expect(findForbidden(t)).toBeNull(),
  );
});

describe('buildPublished', () => {
  it('builds valid data', () => {
    const d = build();
    expect(d.code).toBe('SECRET');
    expect(d.guests).toHaveLength(3);
  });
  it('blocks private language anywhere in guest copy', () => {
    const content = { ...base.content, faq: [{ q: 'Cost?', a: 'See our vendor contract' }] };
    expect(() => build({ content })).toThrow(PublishError);
    try {
      build({ content });
    } catch (e) {
      expect((e as PublishError).problems.join()).toMatch(/vendor/i);
    }
  });
  it('blocks a short code', () => expect(() => build({ code: 'ab' })).toThrow(/code/i));
  it('blocks bad timezone', () =>
    expect(() => build({ content: { ...base.content, timezone: 'Mars/Base' } })).toThrow(/timezone/i));
  it('blocks event ending before it starts', () => {
    const events = [{ ...base.events[0], end: base.events[0].start.replace('18:00', '17:00') }];
    expect(() => build({ events, guestsCsv: 'Name\nA B' })).toThrow(/before it starts/);
  });
  it('blocks times without a UTC offset', () => {
    const events = [{ ...base.events[0], start: '2027-06-11T18:00:00', end: '2027-06-11T19:00:00' }];
    expect(() => build({ events, guestsCsv: 'Name\nA B' })).toThrow(/offset/);
  });
  it('blocks duplicate event ids and duplicate guests', () => {
    expect(() => build({ events: [base.events[0], base.events[0]], guestsCsv: 'Name\nA B' })).toThrow(/Duplicate event/);
    expect(() => build({ guestsCsv: 'Name\nA B\na b' })).toThrow(/Duplicate guest/);
  });
  it('reports all problems at once', () => {
    try {
      build({ code: 'x', guestsCsv: 'Name\nA B\nA B' });
    } catch (e) {
      expect((e as PublishError).problems.length).toBeGreaterThanOrEqual(2);
    }
  });
});
