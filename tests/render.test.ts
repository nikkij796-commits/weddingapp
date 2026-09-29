import { describe, expect, it } from 'vitest';
import { RateLimiter, handleUnlock } from '../src/server/unlock';
import { esc, firstName, renderApp, renderCountdown, renderFaq, renderGate, renderPartyPicker, renderUpdates, renderWeekend } from '../src/ui/render';
import type { GuestPayload } from '../src/core/types';
import { sample } from './fixtures';

const data = sample();
const payloadFor = (name: string): GuestPayload => {
  const r = handleUnlock(data, { name, code: 'FOREVER' }, new RateLimiter(), 'k');
  if (!r.body.ok) throw new Error('unlock failed');
  return r.body.payload;
};
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
    expect(h).toContain('Also on your invitation: Alex Rivera');
  });
  it('includes time, venue, dress code, maps and calendar per event', () => {
    const h = renderWeekend(payloadFor('Sam Chen'), before);
    expect(h).toContain('4:00 PM');
    expect(h).toContain('Rosewood Chapel');
    expect(h).toContain('Black Tie Optional');
    expect(h).toContain('google.com/maps');
    expect(h).toContain('maps.apple.com');
    expect(h).toContain('calendar.google.com');
    expect(h).toContain('data-ics="ceremony"');
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
    expect(h).toMatch(/data-tab="faq" aria-current="page"/);
    expect(h).toContain('id="signout"');
  });
});

describe('three tabs, no Travel', () => {
  const p = payloadFor('Sam Chen');
  it('has Weekend, FAQ and Updates only', () => {
    const h = renderApp(p, 'weekend', before);
    expect(h.match(/data-tab="/g)).toHaveLength(3);
    expect(h).not.toContain('Travel');
  });
});

describe('time to be announced / no attire', () => {
  const p = payloadFor('Alex Rivera');
  const h = renderWeekend(p, before);
  const brunch = h.slice(h.indexOf('data-event="brunch"'));
  it('shows "Time to be announced" for the brunch', () => expect(brunch).toContain('Time to be announced'));
  it('omits attire when there is no dress code', () => expect(brunch.slice(0, brunch.indexOf('</article>'))).not.toContain('Attire'));
  it('keeps map links but drops calendar buttons for TBD events', () => {
    const card = brunch.slice(0, brunch.indexOf('</article>'));
    expect(card).toContain('google.com/maps');
    expect(card).not.toMatch(/calendar\.google|data-ics/);
  });
  it('still shows attire and calendar for timed events', () => {
    const cer = h.slice(h.indexOf('data-event="ceremony"'), h.indexOf('data-event="reception"'));
    expect(cer).toContain('Attire');
    expect(cer).toContain('data-ics="ceremony"');
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
