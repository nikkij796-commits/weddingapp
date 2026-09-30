import { describe, expect, it } from 'vitest';
import { ALL_TABS, MORE_ITEMS, NAV, isMoreChild, navFor, renderMap, renderMeals, renderMore, renderProgram, renderRides, renderWeather, renderWeatherBody } from '../src/ui/pages';
import { renderApp } from '../src/ui/render';
import type { DayWeather } from '../src/core/weather';
import type { GuestPayload } from '../src/core/types';
import { payloadFor } from './fixtures';

const before = new Date('2027-06-01T12:00:00-04:00');
const alex = () => payloadFor('Alex Rivera');
const sam = () => payloadFor('Sam Chen');
const withContent = (p: GuestPayload, patch: Partial<GuestPayload['content']>): GuestPayload => ({ ...p, content: { ...p.content, ...patch } });
const emptyContent = (p: GuestPayload): GuestPayload =>
  withContent(p, {
    program: { intro: '', sections: [] },
    meals: { intro: '', items: [] },
    rides: { intro: '', steps: [], voucher: { code: '', note: '' }, tips: [] },
    map: { intro: '', places: [] },
    weather: null,
  });

describe('navigation model', () => {
  it('has five bottom-bar items and four items under More', () => {
    expect(NAV.map((n) => n.id)).toEqual(['weekend', 'program', 'meals', 'rides', 'more']);
    expect(MORE_ITEMS.map((m) => m.id)).toEqual(['weather', 'map', 'faq', 'updates']);
    expect(ALL_TABS).toHaveLength(9);
  });
  it('pages under More light up More; others light themselves', () => {
    for (const m of MORE_ITEMS) {
      expect(isMoreChild(m.id)).toBe(true);
      expect(navFor(m.id)).toBe('more');
    }
    for (const id of ['weekend', 'program', 'meals', 'rides', 'more'] as const) expect(navFor(id)).toBe(id);
  });
  it('renderApp shows a back button only on pages under More', () => {
    for (const t of ALL_TABS) {
      const h = renderApp(alex(), t, before);
      expect(h.includes('class="back"'), t).toBe(isMoreChild(t));
      expect(h.match(/aria-current="page"/g), t).toHaveLength(1);
    }
  });
  it('every page renders with full content and with everything empty', () => {
    for (const p of [alex(), emptyContent(alex()), emptyContent(sam())])
      for (const t of ALL_TABS) expect(() => renderApp(p, t, before), t).not.toThrow();
  });
  it('the More menu links to each child page', () => {
    const h = renderMore();
    for (const m of MORE_ITEMS) expect(h).toContain(`data-tab="${m.id}"`);
    expect(h).toContain('Hotel map');
  });
});

describe('Program', () => {
  it('shows a coming-soon placeholder when empty', () => {
    const h = renderProgram(emptyContent(alex()));
    expect(h).toContain('Coming soon');
    expect(h).toContain('Virtual Wedding Program');
  });
  it('shows sections when provided, and escapes them', () => {
    const p = withContent(alex(), { program: { intro: 'Welcome & enjoy', sections: [{ title: 'Baraat <b>', body: 'Line one\n\nLine two' }] } });
    const h = renderProgram(p);
    expect(h).not.toContain('Coming soon');
    expect(h).toContain('Welcome &amp; enjoy');
    expect(h).toContain('Baraat &lt;b&gt;');
    expect(h.match(/<p>Line/g)).toHaveLength(2);
  });
});

describe('Meals', () => {
  const card = (h: string, label: string) => {
    const i = h.indexOf(`data-label="${label}"`);
    return h.slice(i, h.indexOf('</article>', i));
  };
  it('lists the guest\'s meals by day in time order', () => {
    const h = renderMeals(alex());
    expect(h.indexOf('Friday, June 11')).toBeLessThan(h.indexOf('Saturday, June 12'));
    expect(h.indexOf('Saturday, June 12')).toBeLessThan(h.indexOf('Sunday, June 13'));
  });
  it('orders meals within a day by their own start time, not the event\'s', () => {
    const h = renderMeals(alex());
    // June 11: snacks start 15:00, the welcome event starts 18:00, so snacks come first
    expect(h.indexOf('data-label="Afternoon snacks"')).toBeLessThan(h.indexOf('data-label="Welcome drinks &amp; bites"'));
  });
  it('shows a meal\'s own start and end times', () => {
    expect(card(renderMeals(alex()), 'Dinner')).toContain('7:00 PM &ndash; 9:00 PM');
    expect(card(renderMeals(alex()), 'Afternoon snacks')).toContain('3:00 PM &ndash; 4:00 PM');
  });
  it('uses free-text time when given, the event time otherwise, and TBA for undecided events', () => {
    const h = renderMeals(alex());
    expect(card(h, 'Cocktail hour')).toContain('Just before dinner');
    expect(card(h, 'Welcome drinks &amp; bites')).toContain('6:00 PM');
    const tba = withContent(alex(), { meals: { intro: '', items: [{ eventId: 'brunch', label: 'Farewell brunch' }] } });
    expect(card(renderMeals(tba), 'Farewell brunch')).toContain('Time to be announced');
  });
  it('shows where: the meal\'s own place, else the event\'s lawn/hall, else the venue', () => {
    const h = renderMeals(alex());
    expect(card(h, 'Afternoon snacks')).toContain('Main Lawn');
    expect(card(h, 'Welcome drinks &amp; bites')).toContain('<p class="meal-where">Main Lawn</p>'); // event name dropped: the title already says it
    expect(card(h, 'Cocktail hour')).toContain('Cocktail Hour &amp; Reception &middot; Grand Ballroom');
    expect(card(h, 'Farewell brunch')).toContain('The Garden Terrace');
  });
  it('labels each meal Fully Jain or Jain options, and nothing when not specified', () => {
    const h = renderMeals(alex());
    expect(card(h, 'Dinner')).toContain('<span class="pill full">Fully Jain</span>');
    expect(card(h, 'Welcome drinks &amp; bites')).toContain('<span class="pill options">Jain options</span>');
    expect(card(h, 'Farewell brunch')).not.toContain('pill');
  });
  it('explains the labels once, and only when a label is used', () => {
    expect(renderMeals(alex())).toContain('class="jain-legend"');
    const plain = withContent(alex(), { meals: { intro: '', items: [{ eventId: 'brunch', label: 'Farewell brunch' }] } });
    expect(renderMeals(plain)).not.toContain('jain-legend');
  });
  it('never shows a menu line', () => {
    const h = renderMeals(alex());
    expect(h).not.toMatch(/Menu to be announced|class="menu/);
    const sneaky = withContent(alex(), { meals: { intro: '', items: [{ eventId: 'welcome', label: 'Dinner', menu: 'Secret menu' } as any] } });
    expect(renderMeals(sneaky)).not.toContain('Secret menu');
  });
  it('event meals show only for invitees of that event', () => {
    const h = renderMeals(payloadFor('Maria Garcia')); // ceremony + reception only
    expect(h).toContain('data-label="Dinner"');
    expect(h).not.toContain('data-label="Welcome drinks');
    expect(h).not.toContain('Farewell brunch');
  });
  it('day meals show for anyone with an event that day, and only them', () => {
    expect(renderMeals(alex())).toContain('data-label="Afternoon snacks"'); // has the June 11 welcome event
    expect(renderMeals(payloadFor('Maria Garcia'))).not.toContain('Afternoon snacks'); // no event on June 11
    expect(renderMeals(sam())).not.toContain('Afternoon snacks');
  });
  it('a day meal also reaches guests whose only event that day is a different event', () => {
    const p = withContent(payloadFor('Maria Garcia'), { meals: { intro: '', items: [{ date: '2027-06-12', label: 'Day snack' }] } });
    expect(renderMeals(p)).toContain('Day snack'); // her ceremony is on June 12
  });
  it('shows the snack with no time text when it has neither time nor start', () => {
    const p = withContent(alex(), { meals: { intro: '', items: [{ date: '2027-06-11', label: 'Snack' }] } });
    expect(card(renderMeals(p), 'Snack')).not.toContain('class="time"');
  });
  it('is a placeholder when the guest has no meals', () => expect(renderMeals(sam())).toContain('Meal Schedule'));
  it('is a placeholder when nothing is configured', () => expect(renderMeals(emptyContent(alex()))).toContain('Coming soon'));
  it('ignores meals that point at unknown events or other days', () => {
    const p = withContent(alex(), { meals: { intro: '', items: [{ eventId: 'nope', label: 'Ghost' }, { date: '2030-01-01', label: 'Phantom' }] } });
    const h = renderMeals(p);
    expect(h).not.toContain('Ghost');
    expect(h).not.toContain('Phantom');
  });
  it('escapes text', () => {
    const p = withContent(alex(), { meals: { intro: '', items: [{ eventId: 'welcome', label: '<img onerror=x>', place: 'A & "B"', notes: '<b>n</b>' }] } });
    const h = renderMeals(p);
    expect(h).not.toContain('<img');
    expect(h).not.toContain('<b>n</b>');
    expect(h).toContain('A &amp; &quot;B&quot;');
  });
});

describe('Rides (Uber)', () => {
  it('shows the voucher code with a copy button and its note', () => {
    const h = renderRides(alex());
    expect(h).toContain('SAMPLE-RIDE-50');
    expect(h).toContain('data-copy="SAMPLE-RIDE-50"');
    expect(h).toContain('Worth $150 per household');
  });
  it('shows a placeholder when there is no voucher yet', () => {
    const h = renderRides(emptyContent(alex()));
    expect(h).toContain('Voucher details');
    expect(h).toContain('Coming soon');
    expect(h).not.toContain('data-copy');
  });
  it('has a default intro and jump links that match real sections', () => {
    const h = renderRides(emptyContent(alex()));
    expect(h).toContain('Uber vouchers are being arranged');
    for (const id of ['rides-voucher', 'rides-go', 'rides-how']) {
      expect(h).toContain(`data-jump="${id}"`);
      expect(h).toContain(`id="${id}"`);
    }
  });
  it('lists steps and tips when provided, and a placeholder when not', () => {
    expect(renderRides(alex())).toContain('<ol class="steps">');
    expect(renderRides(alex())).toContain('Good to know');
    expect(renderRides(emptyContent(alex()))).toContain('Step-by-step instructions will be posted here');
  });
  it('offers an Uber ride to each distinct destination (venues and places), without duplicates', () => {
    const h = renderRides(alex());
    const links = [...h.matchAll(/data-uber href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    expect(links.length).toBeGreaterThanOrEqual(3);
    const addrs = links.map((l) => new URL(l).searchParams.get('dropoff[formatted_address]'));
    expect(new Set(addrs).size).toBe(addrs.length);
    expect(addrs).toContain('100 Example Street, Sampleville, NY 10001');
    expect(addrs).toContain('12 Sample Road, Sampleville, NY 10001');
    for (const l of links) {
      const u = new URL(l);
      expect(u.origin + u.pathname).toBe('https://m.uber.com/ul/');
      expect(u.searchParams.get('pickup')).toBe('my_location');
    }
  });
  it('only lists venues for the guest\'s own events', () => {
    const h = renderRides(sam()); // ceremony only: Rosewood Chapel
    expect(h).toContain('Rosewood Chapel');
    expect(h).not.toContain('Grand Ballroom');
  });
  it('escapes the voucher code and steps', () => {
    const p = withContent(alex(), { rides: { intro: '', steps: ['<script>x</script>'], voucher: { code: 'A"B', note: '' }, tips: [] } });
    const h = renderRides(p);
    expect(h).not.toContain('<script>');
    expect(h).toContain('data-copy="A&quot;B"');
  });
});

describe('Hotel map', () => {
  it('embeds a map of the first place and lists every place with map and Uber links', () => {
    const h = renderMap(alex());
    expect(h).toContain('<iframe');
    expect(h).toContain('https://maps.google.com/maps?q=');
    expect(decodeURIComponent(h.match(/q=([^&"]+)/)![1])).toContain('The Garden Terrace');
    expect(h).toContain('Example Inn');
    expect(h).toContain('maps.apple.com');
    expect(h).toContain('m.uber.com');
    expect(h).toContain('Host hotel and venue');
  });
  it('shows a property-map placeholder until an image is provided', () => {
    expect(renderMap(alex())).toContain('Property Map');
    expect(renderMap(alex())).toContain('where each lawn and hall is');
    const withImg = withContent(alex(), { map: { intro: '', places: [], imagePath: 'resort-map.png', imageAlt: 'Resort map' } });
    const h = renderMap(withImg);
    expect(h).toContain('<img src="/resort-map.png" alt="Resort map"');
    expect(h).not.toContain('will appear here');
  });
  it('falls back to the first event\'s venue when no places are configured', () => {
    const h = renderMap(emptyContent(alex()));
    expect(h).toContain('<iframe');
    expect(decodeURIComponent(h.match(/q=([^&"]+)/)![1])).toContain('The Garden Terrace');
  });
  it('has a placeholder when there is nothing to show at all', () => {
    const h = renderMap({ ...emptyContent(alex()), events: [] });
    expect(h).not.toContain('<iframe');
    expect(h).toContain('Coming soon');
  });
  it('escapes names and addresses in URLs and text', () => {
    const p = withContent(alex(), { map: { intro: '', places: [{ name: 'Bob\'s "Inn" & Spa', address: '1 A St #2' }] } });
    const h = renderMap(p);
    expect(h).toContain('Bob&#39;s &quot;Inn&quot; &amp; Spa');
    expect(h).not.toMatch(/src="[^"]*"[^>]*"Inn"/);
  });
});

describe('Weather page', () => {
  const day = (over: Partial<DayWeather> = {}): DayWeather => ({
    date: '2027-06-12', kind: 'forecast', high: 72, low: 48, precipChance: 20, code: 1, sunrise: '05:27', sunset: '20:31', wind: 9,
    hours: [{ time: '2027-06-12T16:00', temp: 68, code: 1 }, { time: '2027-06-12T17:00', temp: 66, code: 2 }], ...over,
  });
  const ready = (days: DayWeather[], extra: object = {}) => ({ phase: 'ready' as const, days, updatedAt: +new Date('2027-06-12T15:42:00-04:00'), stale: false, missing: [], ...extra });
  const now = new Date('2027-06-12T10:00:00-04:00');

  it('shows a loading state', () => expect(renderWeatherBody(alex(), { phase: 'loading' }, now)).toContain('Checking the forecast'));
  it('is a placeholder when weather is not configured', () => {
    expect(renderWeather(emptyContent(alex()), { phase: 'loading' }, now)).toContain('Coming soon');
    expect(renderWeatherBody(alex(), { phase: 'unconfigured' }, now)).toContain('Coming soon');
  });
  it('shows a friendly error with retry and the official forecast link', () => {
    const h = renderWeatherBody(alex(), { phase: 'error' }, now);
    expect(h).toContain('couldn&rsquo;t load the weather');
    expect(h).toContain('data-retry');
    expect(h).toContain('forecast.weather.gov/MapClick.php?lat=40.71&amp;lon=-74');
  });
  it('shows a live forecast day with temps, conditions, rain, wind, sun times and attribution', () => {
    const h = renderWeatherBody(alex(), ready([day()]), now);
    expect(h).toContain('Live forecast');
    expect(h).toContain('updated 3:42 PM');
    expect(h).toContain('Saturday, June 12');
    expect(h).toContain('<b>72&deg;</b>');
    expect(h).toContain('/ 48&deg;F');
    expect(h).toContain('Mostly clear');
    expect(h).toContain('<b>20%</b> chance of rain');
    expect(h).toContain('<b>9 mph</b> wind');
    expect(h).toContain('Sunrise <b>5:27 AM</b>');
    expect(h).toContain('Sunset <b>8:31 PM</b>');
    expect(h).toContain('Open-Meteo.com');
  });
  it('marks today', () => {
    expect(renderWeatherBody(alex(), ready([day()]), now)).toContain('Today');
    expect(renderWeatherBody(alex(), ready([day()]), before)).not.toContain('Today');
  });
  it('lists the guest\'s own events that day with the temperature at start', () => {
    const h = renderWeatherBody(alex(), ready([day()]), now);
    expect(h).toContain('Ceremony');
    expect(h).toContain('<b>68&deg;</b> mostly clear'); // 4 PM
    expect(h).toContain('Cocktail Hour &amp; Reception');
    expect(h).toContain('<b>66&deg;</b> partly cloudy'); // 5 PM
  });
  it('does not list events the guest is not invited to', () => {
    const h = renderWeatherBody(sam(), ready([day()]), now); // ceremony only
    expect(h).toContain('Ceremony');
    expect(h).not.toContain('Reception');
  });
  it('gives cool-evening advice from the numbers', () => expect(renderWeatherBody(alex(), ready([day({ low: 45 })]), now)).toContain('wrap or jacket'));
  it('typical days are labeled and say when the live forecast starts', () => {
    const h = renderWeatherBody(alex(), ready([day({ kind: 'typical', hours: undefined, sunrise: undefined, sunset: undefined, wind: undefined, precipChance: 8 })]), before);
    expect(h).toContain('Typical weather');
    expect(h).toContain('The live forecast starts on Friday, May 28'); // 15 days before Jun 12
    expect(h).toContain('of past years had rain');
    expect(h).not.toContain('Live forecast');
    expect(h).toContain('data-kind="typical"');
  });
  it('a saved offline copy is disclosed', () => expect(renderWeatherBody(alex(), ready([day()], { stale: true }), now)).toContain('saved copy'));
  it('lists days that could not be loaded', () => expect(renderWeatherBody(alex(), ready([day()], { missing: ['2027-06-13'] }), now)).toContain('couldn&rsquo;t load Sunday, June 13'));
  it('handles missing optional numbers without printing "null" or "undefined"', () => {
    const h = renderWeatherBody(alex(), ready([day({ precipChance: null, wind: null, sunrise: undefined, sunset: undefined, hours: [] , code: null})]), now);
    expect(h).not.toMatch(/null|undefined|NaN/);
  });
  it('the page wraps the body in a container the app can update', () => {
    const h = renderWeather(alex(), { phase: 'loading' }, now);
    expect(h).toContain('id="weather-root"');
    expect(h).toContain('Sampleville, NY');
  });
});

describe('Hotel map: property map and "Where is my event?"', () => {
  it('shows each of the guest\'s events with its lawn or hall, and says so when it is not decided yet', () => {
    const h = renderMap(alex());
    const row = (id: string) => h.slice(h.indexOf(`data-where="${id}"`), h.indexOf('</li>', h.indexOf(`data-where="${id}"`)));
    expect(row('welcome')).toContain('Main Lawn');
    expect(row('reception')).toContain('Grand Ballroom');
    expect(row('ceremony')).toContain('Rosewood Chapel'); // a different venue from the main property
    expect(row('brunch')).toContain('Location to be announced');
    expect(row('ceremony')).toContain('4:00 PM');
    expect(row('brunch')).toContain('Time TBA');
  });
  it('lists events by day in time order', () => {
    const h = renderMap(alex());
    expect(h.indexOf('Friday, June 11')).toBeLessThan(h.indexOf('Saturday, June 12'));
    expect(h.indexOf('Saturday, June 12')).toBeLessThan(h.indexOf('Sunday, June 13'));
    expect(h.indexOf('data-where="ceremony"')).toBeLessThan(h.indexOf('data-where="reception"'));
  });
  it('only lists the guest\'s own events', () => {
    const h = renderMap(sam());
    expect(h).toContain('data-where="ceremony"');
    expect(h).not.toMatch(/data-where="(welcome|reception|brunch)"/);
  });
  it('puts the property map first, then the event list, then the street map', () => {
    const h = renderMap(withContent(alex(), { map: { intro: '', places: [], imagePath: 'resort-map.png' } }));
    const order = ['class="map-figure"', 'id="map-where"', 'id="map-getting"', '<iframe'].map((x) => h.indexOf(x));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it('has no event list for a guest with no events, and still shows the map', () => {
    const h = renderMap({ ...alex(), events: [] });
    expect(h).not.toContain('map-where');
    expect(h).toContain('Property Map');
  });
  it('escapes the area text', () => {
    const p = alex();
    p.events = p.events.map((e) => (e.id === 'welcome' ? { ...e, area: '<b>Lawn</b> & "Deck"' } : e));
    const h = renderMap(p);
    expect(h).not.toContain('<b>Lawn</b>');
    expect(h).toContain('&lt;b&gt;Lawn&lt;/b&gt; &amp; &quot;Deck&quot;');
  });
});

describe('event area shows up everywhere an event location does', () => {
  it('on the event card, the meals page, and only when set', () => {
    const weekend = renderApp(alex(), 'weekend', before);
    const card = (id: string) => weekend.slice(weekend.indexOf(`data-event="${id}"`), weekend.indexOf('</article>', weekend.indexOf(`data-event="${id}"`)));
    expect(card('welcome')).toContain('<span class="area">Main Lawn</span>');
    expect(card('ceremony')).not.toContain('class="area"');
    expect(renderMeals(alex())).toContain('meal-where">Main Lawn<');
  });
});

describe('events with no address yet (e.g. Airbnb)', () => {
  const airbnb = (): GuestPayload => {
    const p = alex();
    return { ...p, events: p.events.map((e) => (e.id === 'welcome' ? { ...e, venue: 'Airbnb', address: '', area: undefined } : e)) };
  };
  it('the event card says the address is to be announced and has no map buttons', () => {
    const html = renderApp(airbnb(), 'weekend', before);
    const card = html.slice(html.indexOf('data-event="welcome"'), html.indexOf('data-event="ceremony"'));
    expect(card).toContain('Address to be announced');
    expect(card).not.toContain('google.com/maps');
    expect(card).not.toContain('maps.apple.com');
  });
  it('Rides has no Uber button for it, and the where-list says the address is coming', () => {
    const p = airbnb();
    expect(renderRides(p)).not.toContain('Airbnb');
    expect(renderMap(p)).toContain('Airbnb &middot; address to be announced');
  });
});

describe('resort-map letters', () => {
  const lettered = (area: string | undefined): GuestPayload => {
    const p = alex();
    return { ...p, events: p.events.map((e) => (e.id === 'welcome' ? { ...e, area } : e)) };
  };
  it('adds the caption only when an area carries a map letter', () => {
    expect(renderMap(lettered('Cholla Lawn (D)'))).toContain('letters in brackets match the letters on the resort map');
    expect(renderMap(lettered('Main Lawn'))).not.toContain('letters in brackets');
  });
  it('the property map scrolls sideways and opens full size', () => {
    const p = alex();
    const html = renderMap({ ...p, content: { ...p.content, map: { ...p.content.map, imagePath: 'resort-map.jpg', imageAlt: 'Resort map' } } });
    expect(html).toContain('class="map-scroll"');
    expect(html).toContain('resort-map.jpg');
    expect(html).toContain('target="_blank"');
  });
});

describe('day strip', () => {
  it('weekend and meals each get a strip with one button per day, pointing at real sections', () => {
    for (const html of [renderApp(alex(), 'weekend', before), renderMeals(alex())]) {
      const targets = [...html.matchAll(/data-jump="((?:day|meals)-[\d-]+)"/g)].map((m) => m[1]);
      expect(targets).toHaveLength(3); // Alex has Fri, Sat, Sun events
      for (const t of targets) expect(html).toContain(`id="${t}"`);
    }
  });
  it('is left out when the guest has only one day', () => {
    expect(renderApp(sam(), 'weekend', before)).not.toContain('daystrip');
  });
});
