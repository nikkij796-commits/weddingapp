import { appleMapsUrl, googleMapsUrl, uberRideUrl } from '../core/links';
import { formatDay, formatTime, sortEvents } from '../core/time';
import type { EventInfo, GuestPayload } from '../core/types';
import { clock12, forecastOpensOn, formatYmd, nwsUrl, tempAtEvent, tipsFor, weatherCodeInfo, ymdInTimezone } from '../core/weather';
import type { WeatherResult } from '../core/weatherClient';
import { esc } from './html';

const RULE = '<div class="rule" aria-hidden="true"><span>&#10049;</span></div>';

// ---------- navigation ----------

const svg = (body: string, fill = false) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" fill="${fill ? 'currentColor' : 'none'}" stroke="${fill ? 'none' : 'currentColor'}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  weekend: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  program: svg('<path d="M12 6.5C10 5 7.5 4.5 4.5 5v13c3-.5 5.500 0 7.500 1.500 2-1.500 4.500-2 7.500-1.500V5c-3-.5-5.500 0-7.500 1.500z"/><path d="M12 6.500v13"/>'),
  meals: svg('<path d="M7 3v7.500M4.500 3v5a2.500 2.500 0 0 0 5 0V3M7 11v10M17.500 21V3c-2.500 1.500-3.500 5-3.500 8h3.500"/>'),
  rides: svg('<path d="M5 15.500l1.500-4.500a2 2 0 0 1 1.900-1.400h7.200a2 2 0 0 1 1.900 1.400l1.500 4.500"/><rect x="3" y="15.500" width="18" height="4" rx="1.500"/><path d="M6.500 19.500v1.500M17.500 19.500v1.500"/><circle cx="7.500" cy="17.500" r=".5" fill="currentColor"/><circle cx="16.500" cy="17.500" r=".5" fill="currentColor"/>'),
  more: svg('<circle cx="5" cy="12" r="1.700"/><circle cx="12" cy="12" r="1.700"/><circle cx="19" cy="12" r="1.700"/>', true),
  weather: svg('<circle cx="8.500" cy="8.500" r="3.200"/><path d="M8.500 2.500v1.500M2.500 8.500H4M4.300 4.300l1 1M12.700 4.300l-1 1"/><path d="M8 20h9.500a3.500 3.500 0 0 0 .3-7 5 5 0 0 0-9.600 1.300A3 3 0 0 0 8 20z"/>'),
  map: svg('<path d="M12 21.500s-7-5.900-7-11.500a7 7 0 0 1 14 0c0 5.600-7 11.500-7 11.500z"/><circle cx="12" cy="10" r="2.500"/>'),
  faq: svg('<circle cx="12" cy="12" r="9"/><path d="M9.500 9.500a2.500 2.500 0 0 1 5 0c0 1.700-2.500 2-2.500 4M12 17h.01"/>'),
  updates: svg('<path d="M6 16.500V11a6 6 0 0 1 12 0v5.500l1.500 2h-15z"/><path d="M10 21a2 2 0 0 0 4 0"/>'),
} as const;

export const NAV = [
  { id: 'weekend', label: 'Weekend', icon: ICONS.weekend },
  { id: 'program', label: 'Program', icon: ICONS.program },
  { id: 'meals', label: 'Meals', icon: ICONS.meals },
  { id: 'rides', label: 'Rides', icon: ICONS.rides },
  { id: 'more', label: 'More', icon: ICONS.more },
] as const;

export const MORE_ITEMS = [
  { id: 'weather', title: 'Weather', blurb: 'Forecast for your days', icon: ICONS.weather },
  { id: 'map', title: 'Hotel map', blurb: 'Where everything is', icon: ICONS.map },
  { id: 'faq', title: 'FAQ', blurb: 'Good to know', icon: ICONS.faq },
  { id: 'updates', title: 'Updates', blurb: 'Latest announcements', icon: ICONS.updates },
] as const;

export type NavId = (typeof NAV)[number]['id'];
export type MoreId = (typeof MORE_ITEMS)[number]['id'];
export type TabId = NavId | MoreId;
export const ALL_TABS: TabId[] = [...NAV.map((n) => n.id), ...MORE_ITEMS.map((m) => m.id)];
export const isMoreChild = (t: TabId): t is MoreId => MORE_ITEMS.some((m) => m.id === t);
/** Which bottom-bar button is lit for a page: pages under the More menu light up "More". */
export const navFor = (t: TabId): NavId => (isMoreChild(t) ? 'more' : (t as NavId));

// ---------- shared bits ----------

const head = (title: string, sub = '') => `<header class="page-head"><h2>${esc(title)}</h2>${sub ? `<p class="page-sub">${esc(sub)}</p>` : ''}</header>`;

const soon = (title: string, text: string) => `
  <article class="soon"><div class="soon-panel">
    <p class="eyebrow">Coming soon</p>
    <h3>${esc(title)}</h3>
    ${RULE}
    <p>${esc(text)}</p>
  </div></article>`;

const paragraphs = (text: string) => text.split(/\n{2,}/).map((t) => `<p>${esc(t.trim())}</p>`).join('');

const BASE = (import.meta.env?.BASE_URL as string | undefined) ?? '/';

// ---------- More menu ----------

export function renderMore(): string {
  return `${head('More')}
  <div class="menu-grid">
    ${MORE_ITEMS.map((m) => `<button type="button" class="menu-card" data-tab="${m.id}"><span class="menu-icon">${m.icon}</span><span class="menu-text"><b>${esc(m.title)}</b><small>${esc(m.blurb)}</small></span><span class="chev" aria-hidden="true">&rsaquo;</span></button>`).join('')}
  </div>`;
}

// ---------- Program ----------

export function renderProgram(p: GuestPayload): string {
  const { intro, sections } = p.content.program;
  return `${head('Wedding Program', 'Follow along on your phone')}
  ${intro ? `<div class="intro">${paragraphs(intro)}</div>` : ''}
  ${
    sections.length
      ? sections.map((s) => `<article class="card program-card"><h3>${esc(s.title)}</h3>${paragraphs(s.body)}</article>`).join('')
      : soon('Virtual Wedding Program', 'The program for the ceremonies will appear here, so you can follow along on your phone.')
  }`;
}

// ---------- Meals ----------

export function renderMeals(p: GuestPayload): string {
  const { intro, items } = p.content.meals;
  const tz = p.content.timezone;
  const byId = new Map(p.events.map((e) => [e.id, e]));
  const rows = items
    .map((m) => ({ m, e: byId.get(m.eventId) }))
    .filter((r): r is { m: (typeof items)[number]; e: EventInfo } => !!r.e);
  const ordered = sortEvents(rows.map((r) => r.e)).flatMap((e) => rows.filter((r) => r.e.id === e.id));
  const seen = new Set<(typeof items)[number]>();
  const list = ordered.filter((r) => (seen.has(r.m) ? false : (seen.add(r.m), true)));

  const days: { day: string; rows: typeof list }[] = [];
  for (const r of list) {
    const day = formatDay(r.e.start, tz);
    const g = days.find((d) => d.day === day);
    if (g) g.rows.push(r);
    else days.push({ day, rows: [r] });
  }

  const card = ({ m, e }: (typeof list)[number]) => {
    const when = m.time ?? (e.timeTbd ? 'Time to be announced' : formatTime(e.start, tz));
    return `<article class="card meal" data-meal="${esc(e.id)}">
      <p class="time">${esc(when)}</p>
      <h3>${esc(m.label)}</h3>
      <p class="meal-where">${esc(e.name)} &middot; ${esc(e.venue)}</p>
      ${m.menu ? `<p class="menu">${esc(m.menu)}</p>` : '<p class="menu tba">Menu to be announced</p>'}
      ${m.notes ? `<p class="muted">${esc(m.notes)}</p>` : ''}
    </article>`;
  };

  return `${head('Meals', 'What is served, and when')}
  ${intro ? `<div class="intro">${paragraphs(intro)}</div>` : ''}
  ${
    days.length
      ? days.map((d) => `<section class="day"><h2>${esc(d.day)}</h2>${d.rows.map(card).join('')}</section>`).join('')
      : soon('Meal Schedule', 'Your meals and menus will be listed here as they are finalized.')
  }`;
}

// ---------- Rides (Uber) ----------

function destinations(p: GuestPayload): { name: string; address: string }[] {
  const out: { name: string; address: string }[] = [];
  const add = (name: string, address: string) => {
    if (address && !out.some((d) => d.address.toLowerCase() === address.toLowerCase())) out.push({ name, address });
  };
  for (const e of p.events) add(e.venue, e.address);
  for (const pl of p.content.map.places) add(pl.name, pl.address);
  return out;
}

export function renderRides(p: GuestPayload): string {
  const r = p.content.rides;
  const dest = destinations(p);
  return `${head('Rides', 'Getting around by Uber')}
  <nav class="jump" aria-label="On this page">
    <button type="button" data-jump="rides-voucher">Voucher</button>
    <button type="button" data-jump="rides-go">Get a ride</button>
    <button type="button" data-jump="rides-how">How it works</button>
  </nav>
  <div class="intro"><p>${esc(r.intro || 'Uber vouchers are being arranged for the weekend. Details will be posted here.')}</p></div>

  <section id="rides-voucher"><h2>Your voucher</h2>
  ${
    r.voucher.code
      ? `<article class="card voucher"><p class="eyebrow">Voucher code</p><p class="code" data-code>${esc(r.voucher.code)}</p><button type="button" class="chip" data-copy="${esc(r.voucher.code)}">Copy code</button>${r.voucher.note ? `<p class="muted">${esc(r.voucher.note)}</p>` : ''}</article>`
      : soon('Voucher details', 'Your Uber voucher information will appear here.')
  }</section>

  <section id="rides-go"><h2>Get a ride</h2>
  ${
    dest.length
      ? dest.map((d) => `<article class="card ride"><h3>${esc(d.name)}</h3><p class="muted">${esc(d.address)}</p><div class="actions"><a class="chip" data-uber href="${esc(uberRideUrl(d))}" target="_blank" rel="noopener">Ride to ${esc(d.name)}</a></div></article>`).join('')
      : '<p class="empty">Destinations will appear here.</p>'
  }
  <p class="muted note">Tapping a button opens the Uber app with the destination filled in. Pickup is your current location.</p></section>

  <section id="rides-how"><h2>How it works</h2>
  ${
    r.steps.length
      ? `<ol class="steps">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`
      : '<p class="empty">Step-by-step instructions will be posted here.</p>'
  }
  ${r.tips.length ? `<h3 class="sub">Good to know</h3><ul class="tips">${r.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}</section>`;
}

// ---------- Hotel map ----------

export function renderMap(p: GuestPayload): string {
  const { intro, imagePath, imageAlt, places } = p.content.map;
  const primary = places[0] ?? (p.events[0] ? { name: p.events[0].venue, address: p.events[0].address } : null);
  const list = places.length ? places : primary ? [primary] : [];
  return `${head('Hotel Map', primary ? primary.name : '')}
  ${intro ? `<div class="intro">${paragraphs(intro)}</div>` : ''}
  ${
    primary
      ? `<div class="map-frame"><iframe title="Map of ${esc(primary.name)}" loading="lazy" referrerpolicy="no-referrer" src="https://maps.google.com/maps?q=${encodeURIComponent(`${primary.name}, ${primary.address}`)}&z=16&output=embed"></iframe></div>`
      : soon('Map', 'The map will appear here.')
  }
  ${
    imagePath
      ? `<figure class="map-figure"><a href="${esc(BASE + imagePath)}" target="_blank" rel="noopener"><img src="${esc(BASE + imagePath)}" alt="${esc(imageAlt || 'Property map')}" loading="lazy"></a><figcaption class="muted">Tap the map to open it full size</figcaption></figure>`
      : soon('Property Map', 'A map of the property will be added here.')
  }
  <section><h2>Places</h2>
  ${list.map((pl) => `<article class="card place"><h3>${esc(pl.name)}</h3>${'note' in pl && pl.note ? `<p class="time">${esc(pl.note)}</p>` : ''}<p class="muted">${esc(pl.address)}</p><div class="actions"><a class="chip" href="${esc(googleMapsUrl({ venue: pl.name, address: pl.address }))}" target="_blank" rel="noopener">Google Maps</a><a class="chip" href="${esc(appleMapsUrl({ venue: pl.name, address: pl.address }))}" target="_blank" rel="noopener">Apple Maps</a><a class="chip" href="${esc(uberRideUrl(pl))}" target="_blank" rel="noopener">Uber</a></div></article>`).join('')}
  </section>`;
}

// ---------- Weather ----------

export type WeatherState = { phase: 'loading' } | { phase: 'unconfigured' } | WeatherResult;

export function renderWeatherBody(p: GuestPayload, state: WeatherState, now: Date): string {
  const cfg = p.content.weather;
  const tz = p.content.timezone;
  if (!cfg || state.phase === 'unconfigured') return soon('Weather', 'The forecast for your days will appear here.');
  if (state.phase === 'loading') return '<p class="empty" role="status">Checking the forecast&hellip;</p>';
  const fallback = `<p class="muted note">Official forecast: <a href="${esc(nwsUrl(cfg))}" target="_blank" rel="noopener">weather.gov</a></p>`;
  if (state.phase === 'error') {
    return `<article class="card wx-error"><h3>We couldn&rsquo;t load the weather</h3><p class="muted">Check your connection and try again.</p><div class="actions"><button type="button" class="chip" data-retry>Try again</button></div></article>${fallback}`;
  }

  const eventsByDay = new Map<string, EventInfo[]>();
  for (const e of p.events) {
    const d = ymdInTimezone(new Date(e.start), tz);
    eventsByDay.set(d, [...(eventsByDay.get(d) ?? []), e]);
  }
  const typicalDays = state.days.filter((d) => d.kind === 'typical');
  const banner = typicalDays.length
    ? `<p class="wx-banner"><b>Typical weather</b> for these dates, averaged from past years. The live forecast starts on ${esc(formatYmd(forecastOpensOn(typicalDays[0].date)))}.</p>`
    : `<p class="wx-banner"><b>Live forecast</b> &middot; updated ${esc(formatTime(new Date(state.updatedAt).toISOString(), tz))}${state.stale ? ' (saved copy; you appear to be offline)' : ''}</p>`;

  const day = (d: (typeof state.days)[number]) => {
    const info = weatherCodeInfo(d.code);
    const events = sortEvents(eventsByDay.get(d.date) ?? []);
    const tips = tipsFor(d);
    return `<article class="card wx-day" data-day="${esc(d.date)}" data-kind="${d.kind}">
      <header><span class="badge">${d.kind === 'forecast' ? 'Forecast' : 'Typical'}</span><h3>${esc(formatYmd(d.date))}${ymdInTimezone(now, tz) === d.date ? ' <span class="today">Today</span>' : ''}</h3></header>
      <div class="wx-main"><span class="wx-icon" role="img" aria-label="${esc(info.label)}">${info.icon}</span><div><p class="wx-cond">${esc(info.label)}</p><p class="wx-temps"><b>${d.high}&deg;</b> <span>/ ${d.low}&deg;F</span></p></div></div>
      <ul class="wx-facts">
        ${d.precipChance != null ? `<li><b>${d.precipChance}%</b> ${d.kind === 'forecast' ? 'chance of rain' : 'of past years had rain'}</li>` : ''}
        ${d.wind != null ? `<li><b>${d.wind} mph</b> wind</li>` : ''}
        ${d.sunrise ? `<li>Sunrise <b>${esc(clock12(d.sunrise))}</b></li>` : ''}
        ${d.sunset ? `<li>Sunset <b>${esc(clock12(d.sunset))}</b></li>` : ''}
      </ul>
      ${
        events.length
          ? `<ul class="wx-events">${events
              .map((e) => {
                const h = e.timeTbd ? null : tempAtEvent(d, e.start, tz);
                return `<li><span>${esc(e.timeTbd ? 'Time TBA' : formatTime(e.start, tz))}</span> ${esc(e.name)}${h ? ` <b>${h.temp}&deg;</b> ${esc(weatherCodeInfo(h.code).label.toLowerCase())}` : ''}</li>`;
              })
              .join('')}</ul>`
          : ''
      }
      ${tips.length ? `<p class="wx-tip">${esc(tips.join(' '))}</p>` : ''}
    </article>`;
  };

  const missing = state.missing.length ? `<p class="muted note">We couldn&rsquo;t load ${state.missing.map((m) => esc(formatYmd(m))).join(', ')}.</p>` : '';
  return `${banner}${state.days.map(day).join('')}${missing}
  <p class="muted note">Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a>. Official forecast: <a href="${esc(nwsUrl(cfg))}" target="_blank" rel="noopener">weather.gov</a></p>`;
}

export function renderWeather(p: GuestPayload, state: WeatherState, now: Date): string {
  const cfg = p.content.weather;
  return `${head('Weather', cfg?.place ?? '')}<div id="weather-root">${renderWeatherBody(p, state, now)}</div>`;
}

