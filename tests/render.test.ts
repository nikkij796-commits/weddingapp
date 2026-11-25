import { describe, expect, it } from 'vitest';
import { esc, firstName, renderApp, renderCountdown, renderFaq, renderGate, renderPartyPicker, renderUpdates, renderWeekend, hasProgramLink, renderGcalList } from '../src/ui/render';
import { payloadFor } from './fixtures';

const before = new Date('2027-06-01T12:00:00-04:00');

describe('esc', () => {
  it('escapes html', () => expect(esc(`<img src=x onerror="a('b')">&`)).toBe('&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;'));
  it('firstName', () => expect(firstName('  María José García')).toBe('María'));
});

describe('gate', () => {
  it('has name and code fields and no event data', () => {
    const h = renderGate();
    expect(h).toContain('id="name"');
    expect(h).toContain('id="code"');
    expect(h).not.toMatch(/Ceremony|Reception|Rosewood/);
  });
  it('escapes and shows errors', () => expect(renderGate('<b>x</b>')).toContain('&lt;b&gt;x&lt;/b&gt;'));
});

describe('personalized weekend', () => {
  it('shows only invited events', () => {
    const h = renderWeekend(payloadFor('Sam Chen'), before);
    expect(h).toContain('Ceremony');
    expect(h).not.toMatch(/Welcome Drinks|Farewell Brunch|Grand Ballroom/);
  });
  it('shows everything for a fully invited household', () => {
    const h = renderWeekend(payloadFor('Alex Rivera'), before);
    for (const n of ['Welcome Drinks', 'Ceremony', 'Cocktail Hour', 'Farewell Brunch']) expect(h).toContain(n);
  });
  it('greets by first name and lists household', () => {
    const h = renderWeekend(payloadFor('Jordan Rivera'), before);
    expect(h).toContain('Welcome, Jordan');
    expect(h).toContain('Your party: Alex Rivera');
  });
  it('includes time, venue, dress code, one directions button, Uber and one calendar button per event', () => {
    const h = renderWeekend(payloadFor('Sam Chen'), before);
    expect(h).toContain('4:00 PM');
    expect(h).toContain('Rosewood Chapel');
    expect(h).toContain('Black Tie Optional');
    expect(h).toContain('>Directions<');
    expect(h.match(/google\.com\/maps|maps\.apple\.com/g)).toHaveLength(1); // one maps link, not two
    expect(h).toContain('m.uber.com');
    expect(h).toContain('data-cal="ceremony"');
    expect(h).not.toContain('data-ics');
  });
  it('an event at the main resort drops the repeated street address and Directions, and offers the resort map', () => {
    const h = renderWeekend(payloadFor('Alex Rivera'), before);
    const welcome = h.slice(h.indexOf('data-event="welcome"'), h.indexOf('data-event="ceremony"'));
    expect(welcome).toContain('Main Lawn (L)');
    expect(welcome).toContain('The Garden Terrace');
    expect(welcome).not.toContain('100 Example Street');
    expect(welcome).not.toContain('Directions');
    expect(welcome).toContain('data-mapfocus="L"');
    const brunch = h.slice(h.indexOf('data-event="brunch"'));
    expect(brunch).not.toContain('data-mapfocus'); // no lawn chosen yet
  });
  it('groups by day headings', () => expect(renderWeekend(payloadFor('Alex Rivera'), before)).toContain('Saturday, June 12'));
  it('marks live and past events', () => {
    expect(renderWeekend(payloadFor('Sam Chen'), new Date('2027-06-12T16:10:00-04:00'))).toContain('Happening now');
    expect(renderWeekend(payloadFor('Sam Chen'), new Date('2027-06-20T00:00:00-04:00'))).toContain('Completed');
  });
  it('has an empty state when a guest has no events', () => {
    const p = { ...payloadFor('Sam Chen'), events: [] };
    expect(renderWeekend(p, before)).toContain('will appear here soon');
  });
  it('escapes hostile content', () => {
    const p = payloadFor('Sam Chen');
    p.events[0] = { ...p.events[0], name: '<script>alert(1)</script>' };
    const h = renderWeekend(p, before);
    expect(h).not.toContain('<script>');
    expect(h).toContain('&lt;script&gt;');
  });
});

describe('countdown', () => {
  const p = payloadFor('Sam Chen');
  it('counts down to the next event', () => expect(renderCountdown(p, before)).toMatch(/<b>11<\/b>[\s\S]*<b>4<\/b>/));
  it('shows happening now', () => expect(renderCountdown(p, new Date('2027-06-12T16:10:00-04:00'))).toContain('Happening now'));
  it('shows thanks when finished', () => expect(renderCountdown(p, new Date('2028-01-01T00:00:00Z'))).toContain('Thank you'));
});

describe('other tabs', () => {
  const p = payloadFor('Sam Chen');
  it('faq uses details/summary and contact', () => {
    const h = renderFaq(p);
    expect(h).toContain('<details');
    expect(h).toContain('What&#39;s the weather like?');
    expect(h).not.toContain('Contact');
  });
  it('updates newest first, with empty state', () => {
    const two = { ...p, content: { ...p.content, updates: [{ id: 'a', at: '2027-05-01T09:00:00-04:00', message: 'OLD' }, { id: 'b', at: '2027-06-01T09:00:00-04:00', message: 'NEW' }] } };
    const h = renderUpdates(two);
    expect(h.indexOf('NEW')).toBeLessThan(h.indexOf('OLD'));
    expect(renderUpdates({ ...p, content: { ...p.content, updates: [] } })).toContain('No announcements');
  });
  it('app shell marks the active tab', () => {
    const h = renderApp(p, 'faq', before);
    // FAQ lives under More, so the More button is the lit one
    expect(h).toMatch(/data-tab="more" aria-current="page"/);
    expect(h).toContain('id="signout"');
  });
});

describe('bottom bar', () => {
  const p = payloadFor('Sam Chen');
  it('has five items: Weekend, Program, Meals, Rides, More (no Travel)', () => {
    const h = renderApp(p, 'weekend', before);
    const bar = h.slice(h.indexOf('<nav class="tabs"'), h.indexOf('</nav>'));
    expect(bar.match(/data-tab="/g)).toHaveLength(5);
    for (const l of ['Weekend', 'Program', 'Meals', 'Rides', 'More']) expect(bar).toContain(`<span>${l}</span>`);
    expect(h).not.toContain('Travel');
  });
});

describe('time to be announced / no attire', () => {
  const p = payloadFor('Alex Rivera');
  const h = renderWeekend(p, before);
  const brunch = h.slice(h.indexOf('data-event="brunch"'));
  it('shows "Time to be announced" for the brunch', () => expect(brunch).toContain('Time to be announced'));
  it('omits attire when there is no dress code', () => expect(brunch.slice(0, brunch.indexOf('</article>'))).not.toContain('Attire'));
  it('drops the calendar button for TBD events', () => {
    const card = brunch.slice(0, brunch.indexOf('</article>'));
    expect(card).not.toContain('data-cal');
  });
  it('still shows attire and calendar for timed events', () => {
    const cer = h.slice(h.indexOf('data-event="ceremony"'), h.indexOf('data-event="reception"'));
    expect(cer).toContain('Attire');
    expect(cer).toContain('data-cal="ceremony"');
  });
  it('never counts down to a TBD event', () => {
    const onlyTbd = { ...p, events: p.events.filter((e) => e.id === 'brunch') };
    expect(renderCountdown(onlyTbd, before)).toContain('Thank you');
  });
});

describe('party picker', () => {
  const h = renderPartyPicker('Pat <Kim>', [{ index: 0, label: 'Pat Kim & Lee Kim' }, { index: 1, label: 'Pat Kim' }]);
  it('lists each party as a button with its index', () => {
    expect(h).toContain('data-pick="0"');
    expect(h).toContain('data-pick="1"');
    expect(h).toContain('Select your party');
  });
  it('escapes the typed name', () => expect(h).toContain('Pat &lt;Kim&gt;'));
});

describe('greeting with titles (real guest lists have them)', () => {
  it('greets "Dr. Neel Jain" by first name, not "Dr."', () => {
    const p = { ...payloadFor('Sam Chen'), guestName: 'Dr. Neel Jain' };
    const h = renderWeekend(p, before);
    expect(h).toContain('Welcome, Neel');
    expect(h).not.toContain('Welcome, Dr');
  });
});

describe('guide features: moments and Today', () => {
  const p = payloadFor('Alex Rivera');
  it('shows run-of-show lines on the card', () => {
    const h = renderWeekend(p, before);
    expect(h).toContain('<ul class="moments">');
    expect(h).toContain('<b>3:45 PM</b> Seating');
    expect(h).toContain('<b>4:00 PM</b> Ceremony');
  });
  it('omits the list when an event has no moments', () => {
    const h = renderWeekend(p, before);
    const welcome = h.slice(h.indexOf('data-event="welcome"'), h.indexOf('data-event="ceremony"'));
    expect(welcome).not.toContain('moments');
  });
  it('marks only the current day as Today', () => {
    const h = renderWeekend(p, new Date('2027-06-12T10:00:00-04:00'));
    expect(h.match(/data-today/g)).toHaveLength(1);
    expect(h.slice(h.indexOf('data-today'))).toMatch(/Saturday, June 12 <span class="today">Today/);
  });
  it('has no Today marker before or after the weekend', () => {
    expect(renderWeekend(p, before)).not.toContain('data-today');
    expect(renderWeekend(p, new Date('2027-07-01T12:00:00-04:00'))).not.toContain('data-today');
  });
  it('uses the wedding timezone for "today", not the viewer’s', () => {
    // 03:00 UTC on Jun 13 is still Saturday evening in New York
    const h = renderWeekend(p, new Date('2027-06-13T03:00:00Z'));
    expect(h).toMatch(/Saturday, June 12 <span class="today">/);
  });
  it('writes guide copy, not invitation copy', () => {
    const h = renderGate() + renderWeekend(p, before);
    expect(h).not.toMatch(/warmly|request the pleasure|you're invited|invite you/i);
    expect(h).toContain('Wedding weekend guide');
  });
});

describe('cover image at the top', () => {
  const p = payloadFor('Alex Rivera');
  it('replaces the drawn header when present, keeps a heading for screen readers', () => {
    const h = renderWeekend({ ...p, cover: 'data:image/jpeg;base64,AAAA' }, before);
    expect(h).toContain('<img class="cover" src="data:image/jpeg;base64,AAAA"');
    expect(h).toContain('class="sr-only"');
    expect(h).not.toContain('class="monogram"');
    expect(h).not.toContain('class="scene"');
    expect(h).toContain('Welcome, Alex');
  });
  it('without one, the drawn header stays', () => {
    const h = renderWeekend(p, before);
    expect(h).toContain('class="monogram"');
    expect(h).not.toContain('class="cover"');
  });
});

describe('event cards: calendar buttons, Uber pin and swipe layout', () => {
  const cardOf = (h: string, id: string) => {
    const i = h.indexOf(`data-event="${id}"`);
    return h.slice(i, h.indexOf('</article>', i));
  };
  it('a timed event offers both a calendar file and Google Calendar', () => {
    const c = cardOf(renderWeekend(payloadFor('Sam Chen'), before), 'ceremony');
    expect(c).toContain('data-cal="ceremony">Add to calendar</button>');
    expect(c).toContain('data-gcal="ceremony">Google Calendar</button>');
  });
  it('an event without a time has neither calendar button', () => {
    const c = cardOf(renderWeekend(payloadFor('Alex Rivera'), before), 'brunch');
    expect(c).not.toContain('data-cal=');
    expect(c).not.toContain('data-gcal=');
  });
  it('the Uber button carries the map pin so the app fills in the destination', () => {
    const c = cardOf(renderWeekend(payloadFor('Sam Chen'), before), 'ceremony');
    const href = c.match(/href="([^"]*m\.uber\.com[^"]*)"/)![1].replace(/&amp;/g, '&');
    const u = new URL(href);
    expect(u.searchParams.get('dropoff[latitude]')).toBe('40.7411');
    expect(u.searchParams.get('dropoff[longitude]')).toBe('-73.9897');
    expect(u.searchParams.get('dropoff[formatted_address]')).toBe('200 Example Avenue, Sampleville, NY 10001');
  });
  it("each day's events sit in one swipe row, with a hint only when there is more than one", () => {
    const h = renderWeekend(payloadFor('Alex Rivera'), before);
    const days = h.split('<section class="day"').slice(1);
    expect(days).toHaveLength(3);
    for (const d of days) {
      expect(d).toContain('<div class="swipe" role="group"');
      const n = (d.match(/<article class="event/g) ?? []).length;
      if (n > 1) expect(d).toContain(`Swipe for ${n} events`);
      else expect(d).not.toContain('swipe-hint');
    }
  });
  it('has a skip link to the main content', () => {
    const h = renderApp(payloadFor('Alex Rivera'), 'weekend', before);
    expect(h).toMatch(/<a class="skip-link" href="#content"[^>]*>Skip to content<\/a>\s*<main id="content" tabindex="-1">/);
  });
});

describe('Program link on the Baraat & wedding ceremony card', () => {
  const p = payloadFor('Alex Rivera');
  const asWedding = { ...p, events: p.events.map((e) => (e.id === 'ceremony' ? { ...e, id: 'wedding', name: 'Baraat & Wedding Ceremony' } : e)) };
  const cardOf = (h: string, id: string) => {
    const i = h.indexOf(`data-event="${id}"`);
    return h.slice(i, h.indexOf('</article>', i));
  };
  it('the Baraat & Wedding Ceremony card has a Program button that opens the Program tab', () => {
    expect(cardOf(renderWeekend(asWedding, before), 'wedding')).toContain('<button type="button" class="chip" data-tab="program">Program</button>');
  });
  it('the Program button sits before the two calendar buttons, which stay side by side', () => {
    const c = cardOf(renderWeekend(asWedding, before), 'wedding');
    expect(c.indexOf('data-tab="program"')).toBeLessThan(c.indexOf('data-cal='));
    expect(c.indexOf('data-cal=')).toBeLessThan(c.indexOf('data-gcal='));
  });
  it('matches by name too, but not other ceremonies', () => {
    expect(hasProgramLink({ ...p.events[0], id: 'x', name: 'Baraat' })).toBe(true);
    expect(hasProgramLink({ ...p.events[0], id: 'x', name: 'Mayra Ceremony' })).toBe(false);
    expect(hasProgramLink({ ...p.events[0], id: 'x', name: 'Welcome Dinner' })).toBe(false);
  });
  it('no other card gets it', () => {
    const h = renderWeekend(asWedding, before);
    expect(h.match(/data-tab="program"/g)).toHaveLength(1);
  });
});

describe('Add all: calendar file and Google Calendar side by side', () => {
  const p = payloadFor('Alex Rivera');
  it('the hero has both buttons in one row', () => {
    const h = renderWeekend(p, before);
    expect(h).toMatch(/<div class="cal-all-row"><button[^>]*data-cal="all"[^>]*>.*Add all 3 events<\/button><button[^>]*data-gcal-all[^>]*>.*Google Calendar<\/button><\/div>/);
  });
  it('the Google Calendar list has one Add per timed event, in time order, and ticks ones already added', () => {
    const h = renderGcalList(p, new Set(['ceremony']));
    const ids = [...h.matchAll(/data-gcal-one="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(['welcome', 'ceremony', 'reception']); // brunch has no time yet
    expect(h).toMatch(/<li class="added">[^]*?data-gcal-one="ceremony"[^>]*>Added ✓<\/button>/);
    expect(h).toContain('2 to go');
    expect(renderGcalList(p, new Set(['welcome', 'ceremony', 'reception']))).toContain('All added');
  });
  it('escapes event names', () => {
    const q = { ...p, events: p.events.map((e) => (e.id === 'welcome' ? { ...e, name: '<b>x</b>' } : e)) };
    expect(renderGcalList(q, new Set())).not.toContain('<b>x</b>');
  });
});
