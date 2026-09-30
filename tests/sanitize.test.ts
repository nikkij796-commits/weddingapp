import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/core/csv';
import { PublishError, buildPublished, duplicateNames, findForbidden, guestsFromCsv, isPlaceholderName, pickEvents } from '../src/core/sanitize';
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
  it('gives guests without a household their own (per sheet row)', () => expect(guests[2].householdId).toBe('row-4'));
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
      ['address', 'area', 'description', 'dressCode', 'dressNotes', 'end', 'id', 'name', 'start', 'venue'],
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
  it('blocks duplicate event ids; warns (not blocks) on duplicate guest names', () => {
    expect(() => build({ events: [base.events[0], base.events[0]], guestsCsv: 'Name\nA B' })).toThrow(/Duplicate event/);
    const warns: string[] = [];
    build({ guestsCsv: 'Name\nA B\na b', onWarn: (m: string) => warns.push(m) });
    expect(warns.join()).toMatch(/more than one household/);
  });
  it('reports all problems at once', () => {
    try {
      build({ code: 'x', timezone: 'bad', events: [{ ...base.events[0], venue: '' }], guestsCsv: 'Name\nA B' });
    } catch (e) {
      expect((e as PublishError).problems.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('household-per-row guest sheets (real-world layout)', () => {
  const sheet = [
    'Host,# of people,Likelihood,Guest 1 name,Guest 2 name,Guest 3 name,Email,Phone,Hotel,Notes,Welcome Drinks,Ceremony,Reception,Brunch',
    'Jain parents,3,H,Dr. Neel Jain,Dr. Sheethal Jain,Ms. Sonya Jain,neel@example.com,555-0100,Andaz,VIP allergy,TRUE,TRUE,TRUE,FALSE',
    'Nikki,2,L,Mr. Vipul Jain,? Jain,,v@example.com,,Sonesta,,FALSE,TRUE,FALSE,FALSE',
    'Shah parents,3,M,Mahavir Shah,Mahavir Shah Wife,Kid,,,,,FALSE,TRUE,TRUE,TRUE',
    'Nikki,1,H,Mrs. Nikita Jain,,,,,,,FALSE,TRUE,TRUE,FALSE',
    'Nikki,1,H,Ms. Nikita Jain,,,,,,,TRUE,TRUE,TRUE,TRUE',
  ].join('\n');
  const skipped: string[] = [];
  const guests = guestsFromCsv(sheet, base.events, (n) => skipped.push(n));

  it('makes one household per row with every named guest', () => {
    expect(guests.filter((g) => g.householdId === 'row-2').map((g) => g.name)).toEqual(['Dr. Neel Jain', 'Dr. Sheethal Jain', 'Ms. Sonya Jain']);
  });
  it('reads TRUE/FALSE checkboxes and shares them across the household', () => {
    for (const g of guests.filter((x) => x.householdId === 'row-2')) expect(g.invited).toEqual(['welcome', 'ceremony', 'reception']);
    expect(guests.find((g) => g.name === 'Mahavir Shah')!.invited).toEqual(['ceremony', 'reception', 'brunch']);
  });
  it('skips and reports placeholder names', () => expect(skipped).toEqual(['? Jain', 'Mahavir Shah Wife', 'Kid']));
  it('never carries email, phone, hotel, host, likelihood or notes', () => {
    const json = JSON.stringify(guests);
    expect(json).not.toMatch(/example\.com|555-0100|Andaz|Sonesta|VIP|Jain parents|Likelihood/);
  });
  it('detects names shared by different households', () => expect(duplicateNames(guests)).toEqual(['nikita jain']));
  it('still publishes, with warnings', () => {
    const warns: string[] = [];
    const d = buildPublished({ code: 'ABCD1', events: base.events, content: base.content, guestsCsv: sheet, onWarn: (m) => warns.push(m) });
    expect(d.guests.length).toBe(guests.length);
    expect(warns).toHaveLength(2);
  });
});

describe('isPlaceholderName', () => {
  it.each(['? Jain', 'Kid', "Leena's husband", 'Mahavir Shah Wife', 'Vishal ?', '', 'Baba', 'Jiju'])('%j is a placeholder', (n) =>
    expect(isPlaceholderName(n)).toBe(true));
  it.each(['Kid Cudi', 'Dr. Neel Jain', 'Wife Man', 'Jay Shah', 'Sanika Shah'])('%j is a real name', (n) =>
    expect(isPlaceholderName(n)).toBe(false));
});

describe('aliases, everyone-events and undecided times', () => {
  const events = [
    ...base.events,
    { ...base.events[0], id: 'lunch', name: 'Lunch', everyone: true },
    { ...base.events[0], id: 'tbd', name: 'Brunch', timeTbd: true, everyone: true, dressCode: '' },
  ];
  const sheet = 'Guest 1 name,Guest 2 name,ceremony\nMs. Nikita Jain,Mr. Soham Shah,TRUE\nMrs. Nikita Jain,Mr. Vipul Jain,FALSE';
  const make = (extra: object = {}) =>
    buildPublished({ code: 'luke', events, content: base.content, guestsCsv: sheet, ...extra });

  it('keeps the everyone and timeTbd flags through the allowlist', () => {
    const d = make();
    expect(d.events.find((e) => e.id === 'lunch')!.everyone).toBe(true);
    expect(d.events.find((e) => e.id === 'tbd')!.timeTbd).toBe(true);
    expect(d.events.find((e) => e.id === 'ceremony')!.timeTbd).toBeUndefined();
  });
  it('invites every household to everyone-events, even with no sheet column', () => {
    const d = make();
    for (const g of d.guests) expect(g.invited).toEqual(expect.arrayContaining(['lunch', 'tbd']));
  });
  it('still respects sheet checkboxes for normal events', () => {
    const d = make();
    expect(d.guests[0].invited).toContain('ceremony');
    expect(d.guests[2].invited).not.toContain('ceremony');
  });
  it('applies an alias only to the exactly-named guest', () => {
    const d = make({ aliases: { 'Ms. Nikita Jain': ['Nikki Jain'] } });
    expect(d.guests.find((g) => g.name === 'Ms. Nikita Jain')!.aliases).toEqual(['Nikki Jain']);
    expect(d.guests.find((g) => g.name === 'Mrs. Nikita Jain')!.aliases).toEqual([]);
  });
  it('warns about an alias that matches nobody', () => {
    const w: string[] = [];
    make({ aliases: { 'Ms. Nikta Jain': ['Nikki'] }, onWarn: (m: string) => w.push(m) });
    expect(w.join()).toMatch(/match no guest.*Nikta/);
  });
  it('the bride can unlock as "Nikki Jain" and shared "Nikita Jain" asks for a party', async () => {
    const { buildVault, unlockVault } = await import('../src/core/vault');
    const d = make({ aliases: { 'Ms. Nikita Jain': ['Nikki Jain'] } });
    const files = await buildVault(d, 'luke', { iterations: 1000 });
    const go = (name: string) => unlockVault(async (p) => files[p] ?? null, name, 'LUKE');
    expect((await go('Nikki Jain')).kind).toBe('ok');
    expect((await go('Nikita Jain')).kind).toBe('choose');
  });
  it('warns that shared names lead to the party picker', () => {
    const w: string[] = [];
    make({ onWarn: (m: string) => w.push(m) });
    expect(w.join()).toMatch(/select their party.*nikita jain/);
  });
  it('a TBD-time event does not need to look valid as a time of day', () => {
    expect(() => make()).not.toThrow();
  });
});

describe('event moments (run-of-show lines)', () => {
  it('keeps well-formed moments and drops empty or malformed ones', () => {
    const [e] = pickEvents([{ ...base.events[0], moments: [{ time: '9:00 AM', label: 'Baraat' }, { time: '', label: 'x' }, { label: 'no time' }, null, { time: '10:00 AM', label: ' Ceremony ' }] }]);
    expect(e.moments).toEqual([{ time: '9:00 AM', label: 'Baraat' }, { time: '10:00 AM', label: 'Ceremony' }]);
  });
  it('omits the field when there are none', () => {
    expect(pickEvents([{ ...base.events[0], moments: [] }])[0].moments).toBeUndefined();
    expect(pickEvents([{ ...base.events[0], moments: 'nope' }])[0].moments).toBeUndefined();
  });
  it('ignores extra keys inside moments', () => {
    const [e] = pickEvents([{ ...base.events[0], moments: [{ time: '1 PM', label: 'x', cost: 500 }] }]);
    expect(JSON.stringify(e)).not.toContain('500');
  });
  it('scans moments text for private terms too', () => {
    const events = [{ ...base.events[0], moments: [{ time: '1 PM', label: 'Vendor load-in' }] }];
    expect(() => buildPublished({ code: 'ABCD1', events, content: base.content, guestsCsv: 'Name\nA B' })).toThrow(/vendor/i);
  });
});

describe('new guide content (program, meals, rides, map, weather)', () => {
  const raw = {
    ...base.content,
    program: { intro: ' Hello ', sections: [{ title: 'Baraat', body: 'Order of events', secret: 'x' }, { title: '', body: '' }] },
    meals: { intro: '', items: [{ eventId: 'welcome', label: 'Dinner', start: '19:00', end: '21:00', place: 'Main Lawn', time: 'Evening', jain: 'options', menu: 'Buffet', vendor: 'Acme Catering', cost: 5000 }, { date: '2027-06-11', label: 'Snacks', jain: 'full' }, { eventId: '', label: 'no event' }, { eventId: 'welcome', label: '' }] },
    rides: { intro: 'Uber vouchers', steps: [' Open app ', '', 42], voucher: { code: ' RIDE50 ', note: 'Worth $150 each', internal: 'x' }, tips: ['Share rides'] },
    map: { intro: 'Map', imagePath: 'resort-map.png', places: [{ name: 'Andaz', address: '6114 N Scottsdale Rd', note: 'Venue', extra: 1 }, { name: '', address: 'x' }] },
    weather: { place: 'Scottsdale, AZ', latitude: '33.53', longitude: -111.93, apiKey: 'nope' },
  };
  const make = (content: unknown = raw, over: object = {}) =>
    buildPublished({ code: 'ABCD1', events: base.events, content, guestsCsv: 'Name\nA B', ...over });

  it('keeps only allowlisted fields', () => {
    const c = make().content;
    expect(c.program).toEqual({ intro: 'Hello', sections: [{ title: 'Baraat', body: 'Order of events' }] });
    expect(c.meals.items).toEqual([
      { eventId: 'welcome', label: 'Dinner', start: '19:00', end: '21:00', time: 'Evening', place: 'Main Lawn', jain: 'options' },
      { date: '2027-06-11', label: 'Snacks', jain: 'full' },
    ]);
    expect(c.rides).toEqual({ intro: 'Uber vouchers', steps: ['Open app'], voucher: { code: 'RIDE50', note: 'Worth $150 each' }, tips: ['Share rides'] });
    expect(c.map.places).toEqual([{ name: 'Andaz', address: '6114 N Scottsdale Rd', note: 'Venue' }]);
    expect(c.weather).toEqual({ place: 'Scottsdale, AZ', latitude: 33.53, longitude: -111.93 });
    expect(JSON.stringify(c)).not.toMatch(/Acme|5000|apiKey|internal|secret|Buffet|menu/);
  });
  it('fills in empty defaults when the new fields are missing', () => {
    const c = make({ ...base.content, program: undefined, meals: undefined, rides: undefined, map: undefined, weather: undefined }).content;
    expect(c.program).toEqual({ intro: '', sections: [] });
    expect(c.meals).toEqual({ intro: '', items: [] });
    expect(c.rides).toEqual({ intro: '', steps: [], voucher: { code: '', note: '' }, tips: [] });
    expect(c.map).toEqual({ intro: '', places: [] });
    expect(c.weather).toBeNull();
  });
  it('allows a dollar amount in ride voucher text only', () => {
    expect(() => make()).not.toThrow();
    expect(() => make({ ...raw, meals: { intro: 'Each plate is $150', items: [] } })).toThrow(/\$150/);
    expect(() => make({ ...raw, program: { intro: 'Gift of $500', sections: [] } })).toThrow(/\$500/);
  });
  it('still blocks private terms inside ride text', () => {
    expect(() => make({ ...raw, rides: { ...raw.rides, tips: ['Ask the vendor'] } })).toThrow(/vendor/i);
  });
  it('blocks private terms in meals, program and map text', () => {
    expect(() => make({ ...raw, meals: { intro: '', items: [{ eventId: 'welcome', label: 'Dinner', notes: 'Catering contract details' }] } })).toThrow(/contract/i);
    expect(() => make({ ...raw, program: { intro: 'See the budget', sections: [] } })).toThrow(/budget/i);
    expect(() => make({ ...raw, map: { ...raw.map, intro: 'Vendor entrance' } })).toThrow(/vendor/i);
  });
  it('rejects a meal that points at an unknown event', () =>
    expect(() => make({ ...raw, meals: { intro: '', items: [{ eventId: 'ghost', label: 'Dinner' }] } })).toThrow(/unknown event "ghost"/));
  it('rejects out-of-range coordinates and unsafe image paths', () => {
    expect(() => make({ ...raw, weather: { place: 'x', latitude: 91, longitude: 0 } })).toThrow(/out of range/);
    expect(() => make({ ...raw, map: { ...raw.map, imagePath: '../../etc/passwd?x=1' } })).toThrow(/unsafe/);
  });
  it('treats non-numeric weather coordinates as "not configured"', () => {
    expect(make({ ...raw, weather: { place: 'x', latitude: 'abc', longitude: 1 } }).content.weather).toBeNull();
    expect(make({ ...raw, weather: null }).content.weather).toBeNull();
  });
  it('the new content survives the encrypted vault', async () => {
    const { buildVault, unlockVault } = await import('../src/core/vault');
    const files = await buildVault(make(), 'luke', { iterations: 1000 });
    const r = await unlockVault(async (p) => files[p] ?? null, 'A B', 'luke');
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.payload.content.rides.voucher.code).toBe('RIDE50');
    expect(r.payload.content.weather?.latitude).toBe(33.53);
    expect(Object.values(files).join('')).not.toContain('RIDE50');
  });
});

describe('event area (lawn / hall within the property)', () => {
  const noArea = base.events[1]; // the ceremony has no area
  const withFirst = (patch: object) => [{ ...base.events[0], ...patch }, ...base.events.slice(1)];
  it('is kept, trimmed, and omitted when empty', () => {
    const [a, b, c] = pickEvents([{ ...noArea, area: '  Sonoran Lawn ' }, { ...noArea, area: '   ' }, noArea]);
    expect(a.area).toBe('Sonoran Lawn');
    expect('area' in b).toBe(false);
    expect('area' in c).toBe(false);
  });
  it('survives publishing', () => {
    const d = buildPublished({ code: 'ABCD1', events: withFirst({ area: 'Sonoran Lawn' }), content: base.content, guestsCsv: 'Name,welcome\nA B,yes' });
    expect(d.events[0].area).toBe('Sonoran Lawn');
  });
  it('reaches the guest through the encrypted vault', async () => {
    const { buildVault, unlockVault } = await import('../src/core/vault');
    const d = buildPublished({ code: 'ABCD1', events: withFirst({ area: 'Sonoran Lawn' }), content: base.content, guestsCsv: 'Name,welcome\nA B,yes' });
    const files = await buildVault(d, 'ABCD1', { iterations: 1000 });
    const r = await unlockVault(async (p) => files[p] ?? null, 'A B', 'ABCD1');
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.payload.events.find((e) => e.id === 'welcome')!.area).toBe('Sonoran Lawn');
    expect(Object.values(files).join('')).not.toContain('Sonoran');
  });
  it('is scanned for private terms', () => {
    expect(() => buildPublished({ code: 'ABCD1', events: withFirst({ area: 'Vendor loading dock' }), content: base.content, guestsCsv: 'Name\nA B' })).toThrow(/vendor/i);
  });
});

describe('meal validation', () => {
  const meals = (items: object[]) => ({ ...base.content, meals: { intro: '', items } });
  const make = (items: object[]) => buildPublished({ code: 'ABCD1', events: base.events, content: meals(items), guestsCsv: 'Name\nA B' });
  it('accepts an event meal and a day meal with times and a Jain label', () => {
    expect(() => make([{ eventId: 'welcome', label: 'Dinner', start: '19:00', end: '21:30', jain: 'full' }, { date: '2027-06-11', label: 'Snacks', jain: 'options' }])).not.toThrow();
  });
  it('rejects a meal with both an event and a date', () =>
    expect(() => make([{ eventId: 'welcome', date: '2027-06-11', label: 'X' }])).toThrow(/both an event and a date/));
  it.each(['2027-6-11', '11/06/2027', '2027-02-30', '2027-13-01', 'tomorrow'])('rejects the date %s', (date) =>
    expect(() => make([{ date, label: 'X' }])).toThrow(/invalid date/));
  it.each(['7pm', '25:00', '19:60', '7:00', '19:0'])('rejects the time %s', (start) =>
    expect(() => make([{ eventId: 'welcome', label: 'X', start }])).toThrow(/invalid start time/));
  it('rejects a meal that ends before it starts', () =>
    expect(() => make([{ eventId: 'welcome', label: 'X', start: '20:00', end: '19:00' }])).toThrow(/ends before it starts/));
  it.each(['vegan', 'Jain', 'yes', 'FULL'])('rejects the Jain value %s', (jain) =>
    expect(() => make([{ eventId: 'welcome', label: 'X', jain }])).toThrow(/invalid jain value/));
  it('rejects an unknown event', () => expect(() => make([{ eventId: 'ghost', label: 'X' }])).toThrow(/unknown event "ghost"/));
  it('scans meal text for private terms, including the place and notes', () => {
    expect(() => make([{ eventId: 'welcome', label: 'Dinner', place: 'Vendor tent' }])).toThrow(/vendor/i);
    expect(() => make([{ eventId: 'welcome', label: 'Dinner', notes: 'Final invoice due' }])).toThrow(/invoice/i);
  });
});

describe('events whose address is not known yet', () => {
  const events = [{ ...base.events[0], venue: 'Airbnb', address: '' }, ...base.events.slice(1)];
  it('are accepted (venue is required, address is not)', () => {
    const d = buildPublished({ code: 'ABCD1', events, content: base.content, guestsCsv: 'Name\nA B' });
    expect(d.events[0]).toMatchObject({ venue: 'Airbnb', address: '' });
  });
  it('still need a venue and a name', () => {
    expect(() => buildPublished({ code: 'ABCD1', events: [{ ...base.events[0], venue: '' }, ...base.events.slice(1)], content: base.content, guestsCsv: 'Name\nA B' })).toThrow(/needs a name and a venue/);
  });
});
