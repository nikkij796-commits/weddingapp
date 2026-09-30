import { describe, expect, it } from 'vitest';
import { normalizePayload } from '../src/core/payload';
import { pickContent, pickEvents } from '../src/core/sanitize';
import { pickContent as pickContentDirect } from '../src/core/content';
import { ALL_TABS } from '../src/ui/pages';
import { renderApp } from '../src/ui/render';
import { payloadFor, sample } from './fixtures';

const now = new Date('2027-06-11T12:00:00-04:00');

/** What a phone saved BEFORE the Program/Meals/Rides/Weather/Map pages existed. */
function oldShaped() {
  const p = payloadFor('Alex Rivera');
  const c = p.content as any;
  return { ...p, content: { coupleNames: c.coupleNames, tagline: c.tagline, timezone: c.timezone, welcome: c.welcome, faq: c.faq, contact: c.contact, updates: c.updates } };
}

describe('normalizePayload', () => {
  it('fills every newer content field with an empty default', () => {
    const p = normalizePayload(oldShaped())!;
    expect(p.content.program).toEqual({ intro: '', sections: [] });
    expect(p.content.meals).toEqual({ intro: '', items: [] });
    expect(p.content.rides).toEqual({ intro: '', steps: [], voucher: { code: '', note: '' }, tips: [] });
    expect(p.content.map).toEqual({ intro: '', places: [] });
    expect(p.content.weather).toBeNull();
  });
  it('keeps the data that was already there', () => {
    const before = oldShaped();
    const p = normalizePayload(before)!;
    expect(p.guestName).toBe('Alex Rivera');
    expect(p.householdNames).toEqual(['Alex Rivera', 'Jordan Rivera']);
    expect(p.events.map((e) => e.id)).toEqual(['welcome', 'ceremony', 'reception', 'brunch']);
    expect(p.content.faq).toEqual(before.content.faq);
    expect(p.content.timezone).toBe('America/New_York');
  });
  it('leaves a complete, current copy unchanged', () => {
    const full = payloadFor('Alex Rivera');
    expect(normalizePayload(full)).toEqual(full);
  });
  it('is idempotent', () => {
    const once = normalizePayload(oldShaped())!;
    expect(normalizePayload(once)).toEqual(once);
  });
  it('keeps event flags and moments', () => {
    const p = normalizePayload(payloadFor('Alex Rivera'))!;
    expect(p.events.find((e) => e.id === 'brunch')!.timeTbd).toBe(true);
    expect(p.events.find((e) => e.id === 'ceremony')!.moments).toHaveLength(2);
  });
  it('drops events that are missing essentials, and non-object events', () => {
    const raw = { ...oldShaped(), events: [null, 5, 'x', { id: 'a' }, ...oldShaped().events] };
    expect(normalizePayload(raw)!.events).toHaveLength(4);
  });
  it('tolerates missing lists and names', () => {
    const p = normalizePayload({ content: { timezone: 'America/Phoenix' } })!;
    expect(p).toMatchObject({ guestName: '', householdNames: [], events: [] });
    expect(p.content.faq).toEqual([]);
    expect(p.content.updates).toEqual([]);
    expect(p.content.contact).toEqual({ label: '', detail: '' });
  });
  it.each([null, undefined, 42, 'text', [], {}, { content: null }, { content: {} }, { content: { timezone: 'Mars/Base' } }, { content: { timezone: '' } }])(
    'unusable input %j -> null (guest is asked to sign in again)', (bad) => expect(normalizePayload(bad)).toBeNull());
});

describe('every page renders from an old or partial copy (the bug a returning guest hit)', () => {
  it('reproduction: an old-shaped copy would crash without normalizing', () => {
    // documents the original failure so nobody removes the safety net
    const crashed = ALL_TABS.filter((t) => {
      try {
        renderApp(oldShaped() as any, t, now);
        return false;
      } catch {
        return true;
      }
    });
    expect(crashed).toEqual(['program', 'meals', 'rides', 'map']);
  });
  it.each(ALL_TABS)('%s renders after normalizing an old-shaped copy', (tab) => {
    const p = normalizePayload(oldShaped())!;
    expect(() => renderApp(p, tab, now), tab).not.toThrow();
  });
  it.each(ALL_TABS)('%s renders with only a timezone in content', (tab) => {
    const p = normalizePayload({ content: { timezone: 'America/Phoenix' } })!;
    expect(() => renderApp(p, tab, now), tab).not.toThrow();
  });
  it('old copies show placeholders, not empty or broken pages', () => {
    const p = normalizePayload(oldShaped())!;
    expect(renderApp(p, 'weather', now)).toContain('Coming soon');
    expect(renderApp(p, 'program', now)).toContain('Coming soon');
    expect(renderApp(p, 'rides', now)).toContain('Voucher details');
    expect(renderApp(p, 'meals', now)).toContain('Meal Schedule');
  });
});

describe('shared content shaping', () => {
  it('the publisher and the app use the same function', () => {
    expect(pickContent).toBe(pickContentDirect);
    const raw = sample().content;
    expect(pickContent(raw)).toEqual(pickContentDirect(raw));
    expect(pickEvents(sample().events)).toHaveLength(4);
  });
});

describe('saved cover image', () => {
  const base = { guestName: 'A', householdNames: [], events: [], content: { timezone: 'America/Phoenix' } };
  it('keeps a plain image data URL', () => {
    const cover = 'data:image/jpeg;base64,/9j/4AAQ';
    expect(normalizePayload({ ...base, cover })?.cover).toBe(cover);
  });
  it.each(['data:text/html;base64,PHNjcmlwdD4=', 'javascript:alert(1)', 'https://example.com/x.jpg', 'data:image/jpeg;base64,"><script>', 42])('drops %j', (cover) => {
    expect(normalizePayload({ ...base, cover })?.cover).toBeUndefined();
  });
});
