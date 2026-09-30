import { describe, expect, it } from 'vitest';
import { areaSpots, mealRows, nowNext, relativeDay } from '../src/core/plan';
import { directionsUrl, isAppleDevice } from '../src/core/links';
import { renderWeekend } from '../src/ui/render';
import { payloadFor } from './fixtures';

const at = (iso: string) => new Date(iso);
const alex = () => payloadFor('Alex Rivera');
const tz = 'America/New_York';

describe('mealRows', () => {
  it('orders the guest\'s meals by day and time, including date-based ones', () => {
    expect(mealRows(alex()).map((r) => r.m.label)).toEqual(['Afternoon snacks', 'Welcome drinks & bites', 'Cocktail hour', 'Dinner', 'Farewell brunch']);
  });
  it('a date-based meal only shows to guests with an event that day', () => {
    expect(mealRows(payloadFor('Sam Chen')).map((r) => r.m.label)).not.toContain('Afternoon snacks');
  });
  it('an event meal with no own time runs for the length of the event', () => {
    const r = mealRows(alex()).find((x) => x.m.label === 'Welcome drinks & bites')!;
    expect([r.at, r.until]).toEqual(['18:00', '20:30']);
  });
});

describe('nowNext', () => {
  it('is off well before the weekend (the countdown shows instead)', () => {
    expect(nowNext(alex(), at('2027-06-01T12:00:00-04:00')).weekend).toBe(false);
  });
  it('turns on the day before the first event: next event and next meal', () => {
    const nn = nowNext(alex(), at('2027-06-10T20:00:00-04:00'));
    expect(nn.weekend).toBe(true);
    expect(nn.live).toEqual([]);
    expect(nn.next?.id).toBe('welcome');
    expect(nn.meal).toMatchObject({ serving: false, row: { m: { label: 'Afternoon snacks' } } });
  });
  it('says when a meal is being served', () => {
    expect(nowNext(alex(), at('2027-06-11T15:30:00-04:00')).meal).toMatchObject({ serving: true, row: { m: { label: 'Afternoon snacks' } } });
  });
  it('during an event: it is live, and the next one is up next', () => {
    const nn = nowNext(alex(), at('2027-06-12T16:10:00-04:00'));
    expect(nn.live.map((e) => e.id)).toEqual(['ceremony']);
    expect(nn.next?.id).toBe('reception');
  });
  it('with overlapping meals, shows the one that started last', () => {
    expect(nowNext(alex(), at('2027-06-12T19:30:00-04:00')).meal?.row.m.label).toBe('Dinner');
  });
  it('never counts a time-to-be-announced event as next, and turns off after the last event', () => {
    const late = nowNext(alex(), at('2027-06-12T23:45:00-04:00'));
    expect(late.next).toBeUndefined();
    expect(nowNext(alex(), at('2027-06-13T12:00:00-04:00')).weekend).toBe(false);
  });
});

describe('relativeDay', () => {
  const now = at('2027-06-11T23:30:00-04:00');
  it('uses the wedding time zone', () => {
    expect(relativeDay('2027-06-11', now, tz)).toBe('Today');
    expect(relativeDay('2027-06-12', now, tz)).toBe('Tomorrow');
    expect(relativeDay('2027-06-13', now, tz)).toBe('Sunday');
  });
});

describe('areaSpots', () => {
  it('reads map letters from an area', () => {
    expect(areaSpots('Cholla Lawn (D) + Foundry Ballroom (J)')).toEqual([{ name: 'Cholla Lawn', letter: 'D' }, { name: 'Foundry Ballroom', letter: 'J' }]);
    expect(areaSpots('Main Lawn')).toEqual([]);
    expect(areaSpots(undefined)).toEqual([]);
  });
});

describe('directions', () => {
  const e = { venue: 'Hangar', address: '1 A St' };
  it('Apple devices get Apple Maps, others Google Maps', () => {
    expect(isAppleDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(true);
    expect(isAppleDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe(false);
    expect(directionsUrl(e, true)).toContain('maps.apple.com');
    expect(directionsUrl(e, false)).toContain('google.com/maps');
  });
});

describe('weekend page: now/next and whole-weekend calendar', () => {
  it('shows the countdown before the weekend and the now/next card during it', () => {
    expect(renderWeekend(alex(), at('2027-06-01T12:00:00-04:00'))).toContain('class="cd"');
    const during = renderWeekend(alex(), at('2027-06-12T16:10:00-04:00'));
    expect(during).not.toContain('class="cd"');
    expect(during).toContain('class="nownext"');
    expect(during).toContain('Happening now');
    expect(during).toContain('data-jump="ev-ceremony"');
    expect(during).toContain('Up next &middot; Today, 5:00 PM');
    expect(during).toContain('Next meal &middot; Today &middot; Just before dinner'); // free-text time kept as written
    expect(renderWeekend(alex(), at('2027-06-10T20:00:00-04:00'))).toContain('Next meal &middot; Tomorrow, 3:00 PM');
  });
  it('the next-meal row opens the Meals page and shows the Jain label', () => {
    const h = renderWeekend(alex(), at('2027-06-12T18:59:00-04:00'));
    const row = h.slice(h.indexOf('meal-row'), h.indexOf('</button>', h.indexOf('meal-row')));
    expect(row).toContain('data-tab="meals"');
    expect(h).toContain('Being served now');
  });
  it('offers one button to add every timed event to the calendar', () => {
    expect(renderWeekend(alex(), at('2027-06-01T12:00:00-04:00'))).toContain('Add all 3 events to my calendar'); // brunch time is TBA
    expect(renderWeekend(payloadFor('Sam Chen'), at('2027-06-01T12:00:00-04:00'))).not.toContain('data-cal="all"');
  });
  it('every event card has an id the now/next rows can jump to', () => {
    const h = renderWeekend(alex(), at('2027-06-01T12:00:00-04:00'));
    for (const id of ['welcome', 'ceremony', 'reception', 'brunch']) expect(h).toContain(`id="ev-${id}"`);
  });
});
