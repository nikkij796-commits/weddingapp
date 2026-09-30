import { directionsUrl, uberRideUrl } from '../core/links';
import { areaSpots, nowNext, relativeDay } from '../core/plan';
import { firstName } from '../core/matching';
import { clock12, ymdInTimezone } from '../core/weather';
import { countdown, currentOrNext, eventStatus, formatDay, formatTime, groupByDay } from '../core/time';
import type { EventInfo, GuestPayload } from '../core/types';
import { esc } from './html';
import { ALL_TABS, JAIN_LABEL, dayStrip, MORE_ITEMS, NAV, isMoreChild, navFor, renderMap, renderMeals, renderMore, renderProgram, renderRides, renderWeather, type TabId, type WeatherState } from './pages';
export { esc };
export type { TabId, WeatherState };

export { firstName };

/** Decorative Scottsdale scene (sun, mountains, saguaro) echoing the invitation cover. */
export const DESERT_SCENE = `<svg class="scene" viewBox="0 0 400 110" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
  <circle cx="110" cy="62" r="34" fill="#ffd88a" opacity=".9"/>
  <path d="M0 110V76l40-24 30 16 52-40 46 34 40-22 54 30 46-34 44 30 48-20V110z" fill="#e9a071" opacity=".65"/>
  <path d="M0 110V92q100-24 200-4t200-6v28z" fill="#c8654b"/>
  <g fill="#6f7f4f"><rect x="322" y="46" width="11" height="62" rx="5.5"/><rect x="304" y="62" width="9" height="24" rx="4.5"/><rect x="304" y="80" width="26" height="8" rx="4"/><rect x="340" y="54" width="9" height="22" rx="4.5"/><rect x="327" y="70" width="22" height="8" rx="4"/></g>
  <g fill="#6f7f4f" opacity=".85"><rect x="52" y="76" width="8" height="32" rx="4"/><rect x="40" y="84" width="6" height="14" rx="3"/><rect x="40" y="94" width="18" height="6" rx="3"/></g>
</svg>`;

const RULE = '<div class="rule" aria-hidden="true"><span>&#10049;</span></div>';

export function renderGate(error = '', notice = ''): string {
  return `
  <main class="gate">
    <div class="gate-card"><div class="gate-inner">
      <p class="eyebrow">Wedding weekend guide</p>
      <h1 class="monogram">N &amp; S</h1>
      ${RULE}
      <p class="lede">Enter your name and wedding code to see your weekend.</p>
      ${notice ? `<p class="notice" role="status">${esc(notice)}</p>` : ''}
      <form id="gate-form" novalidate>
        <label for="name">Your name</label>
        <input id="name" name="name" autocomplete="name" placeholder="First and last name" required />
        <label for="code">Wedding code</label>
        <input id="code" name="code" autocomplete="off" autocapitalize="characters" placeholder="Code from your invitation" required />
        <p id="gate-error" class="error" role="alert" ${error ? '' : 'hidden'}>${esc(error)}</p>
        <button type="submit" class="btn">Unlock my weekend</button>
      </form>
    </div></div>
  </main>`;
}

/** Shown if a page ever fails to draw, so a tap is never silently dead. */
export function renderProblem(): string {
  return `
  <main class="gate">
    <div class="gate-card"><div class="gate-inner">
      <p class="eyebrow">One moment</p>
      <h1 class="picker-title">Something went wrong</h1>
      <p class="lede">Tap below to refresh your guide.</p>
      <button type="button" class="btn" data-recover>Refresh my guide</button>
      <button type="button" class="link" id="signout">Sign out</button>
    </div></div>
  </main>`;
}

export function renderPartyPicker(name: string, choices: { index: number; label: string }[]): string {
  return `
  <main class="gate">
    <div class="gate-card"><div class="gate-inner">
      <p class="eyebrow">One quick step</p>
      <h1 class="picker-title">Select your party</h1>
      <p class="lede">More than one party includes the name &ldquo;${esc(name)}&rdquo;. Which one is yours?</p>
      <div class="party-list">
        ${choices.map((c) => `<button type="button" class="party" data-pick="${c.index}">${esc(c.label)}</button>`).join('')}
      </div>
      <button type="button" class="link" id="picker-back">Back</button>
    </div></div>
  </main>`;
}

export function renderCountdown(p: GuestPayload, now: Date): string {
  const next = currentOrNext(p.events, now);
  if (!next) return `<p class="cd-done">Thank you for celebrating with us.</p>`;
  if (eventStatus(next, now) === 'live') {
    return `<p class="cd-live"><span class="pulse"></span>Happening now: <strong>${esc(next.name)}</strong></p>`;
  }
  const c = countdown(new Date(next.start), now)!;
  return `<div class="cd" aria-label="Countdown to ${esc(next.name)}">
    <div><b>${c.days}</b><span>days</span></div>
    <div><b>${c.hours}</b><span>hrs</span></div>
    <div><b>${c.minutes}</b><span>min</span></div>
  </div><p class="cd-next">until ${esc(next.name)}</p>`;
}

/** Where an event is, in one short line: the lawn or hall at the resort, else the venue. */
export const whereShort = (e: EventInfo) => e.area || e.venue;

/** During the weekend: what is on right now, what is next, and the next meal. Each row jumps to the details. */
export function renderNowNext(p: GuestPayload, now: Date): string {
  const tz = p.content.timezone;
  const nn = nowNext(p, now);
  if (!nn.weekend) return '';
  const when = (e: EventInfo) => `${relativeDay(ymdInTimezone(new Date(e.start), tz), now, tz)}, ${formatTime(e.start, tz)}`;
  const rows: string[] = [];
  for (const e of nn.live) {
    rows.push(`<button type="button" class="nn-row live" data-jump="ev-${esc(e.id)}"><span class="nn-tag"><span class="pulse"></span>Happening now</span><b>${esc(e.name)}</b><span class="nn-meta">${esc(whereShort(e))} &middot; until ${esc(formatTime(e.end, tz))}</span></button>`);
  }
  if (nn.next) {
    const e = nn.next;
    rows.push(`<button type="button" class="nn-row" data-jump="ev-${esc(e.id)}"><span class="nn-tag">Up next &middot; ${esc(when(e))}</span><b>${esc(e.name)}</b><span class="nn-meta">${esc(whereShort(e))}${e.dressCode ? ` &middot; ${esc(e.dressCode)}` : ''}</span></button>`);
  }
  if (nn.meal) {
    const { row, serving } = nn.meal;
    const day = esc(relativeDay(row.day, now, tz));
    const label = serving ? 'Being served now' : `Next meal &middot; ${day}${row.m.time ? ` &middot; ${esc(row.m.time)}` : `, ${esc(clock12(row.at))}`}`;
    const place = row.m.place ?? (row.e ? whereShort(row.e) : '');
    rows.push(`<button type="button" class="nn-row meal-row" data-tab="meals"><span class="nn-tag">${label}</span><b>${esc(row.m.label)}${row.m.jain ? ` <span class="pill ${row.m.jain}">${JAIN_LABEL[row.m.jain]}</span>` : ''}</b>${place ? `<span class="nn-meta">${esc(place)}</span>` : ''}</button>`);
  }
  if (!rows.length) return `<p class="cd-done">Thank you for celebrating with us.</p>`;
  return `<section class="nownext" aria-label="Now and next">${rows.join('')}</section>`;
}

/** Info for rendering one event: is it at the main resort, and does it have pins on the resort map? */
export function eventPlace(p: GuestPayload, e: EventInfo) {
  const map = p.content.map as GuestPayload['content']['map'] | undefined; // tolerate an old saved copy
  const home = map?.places?.[0]?.name.toLowerCase() ?? '';
  const onSite = !!home && e.venue.toLowerCase() === home;
  const letters = new Set(map?.spots?.map((s) => s.letter) ?? []);
  const pins = onSite && map?.imagePath ? areaSpots(e.area).filter((s) => letters.has(s.letter)).map((s) => s.letter) : [];
  return { onSite, pins };
}

export function renderEvent(e: EventInfo, tz: string, now: Date, p?: GuestPayload): string {
  const status = eventStatus(e, now);
  const badge =
    status === 'live' ? '<span class="badge live">Happening now</span>' : status === 'past' ? '<span class="badge past">Completed</span>' : '';
  const when = e.timeTbd ? 'Time to be announced' : `${formatTime(e.start, tz)} &ndash; ${formatTime(e.end, tz)}`;
  const { onSite, pins } = p ? eventPlace(p, e) : { onSite: false, pins: [] as string[] };
  // At the main resort the street address is the same for every event, so only off-site events show it.
  const address = onSite ? '' : e.address ? `<span class="addr">${esc(e.address)}</span>` : '<span class="tba">Address to be announced</span>';
  const buttons = [
    pins.length ? `<button type="button" class="chip" data-mapfocus="${esc(pins.join(' '))}">Show on map</button>` : '',
    !onSite && e.address ? `<a class="chip" href="${esc(directionsUrl(e))}" target="_blank" rel="noopener">Directions</a>` : '',
    !onSite && e.address ? `<a class="chip" data-uber href="${esc(uberRideUrl({ name: e.venue, address: e.address }))}" target="_blank" rel="noopener">Uber</a>` : '',
    e.timeTbd ? '' : `<button type="button" class="chip" data-cal="${esc(e.id)}">Add to calendar</button>`,
  ].filter(Boolean);
  return `
  <article class="event ${status}" data-event="${esc(e.id)}" id="ev-${esc(e.id)}">
    <div class="frame"><div class="panel">
      <p class="time">${e.timeTbd ? esc(when) : when}</p>
      <h3>${esc(e.name)} ${badge}</h3>
      ${RULE}
      ${e.description ? `<p class="desc">${esc(e.description)}</p>` : ''}
      ${e.moments?.length ? `<ul class="moments">${e.moments.map((m) => `<li><b>${esc(m.time)}</b> ${esc(m.label)}</li>`).join('')}</ul>` : ''}
      <p class="venue">${e.area ? `<span class="area">${esc(e.area)}</span>` : ''}<strong>${esc(e.venue)}</strong>${address}</p>
      ${e.dressCode ? `<p class="dress"><span class="label">Attire</span><span class="attire">${esc(e.dressCode)}</span>${e.dressNotes ? `<br><span class="muted">${esc(e.dressNotes)}</span>` : ''}</p>` : ''}
      ${buttons.length ? `<div class="actions">${buttons.join('')}</div>` : ''}
    </div></div>
  </article>`;
}

export function renderWeekend(p: GuestPayload, now: Date): string {
  const tz = p.content.timezone;
  const days = groupByDay(p.events, tz);
  const others = p.householdNames.filter((n) => n !== p.guestName);
  const ymd = (d: (typeof days)[number]) => ymdInTimezone(new Date(d.events[0].start), tz);
  const today = formatDay(now.toISOString(), tz);
  const nn = renderNowNext(p, now);
  const datable = p.events.filter((e) => !e.timeTbd).length;
  return `
  <section class="hero${p.cover ? ' has-cover' : ''}">
    ${
      p.cover
        ? `<h1 class="sr-only">${esc(p.content.coupleNames)}</h1><img class="cover" src="${esc(p.cover)}" alt="${esc(p.content.coupleNames)}${p.content.tagline ? `, ${esc(p.content.tagline)}` : ''}"><p class="eyebrow">Welcome, ${esc(firstName(p.guestName))}</p>`
        : `<p class="eyebrow">Welcome, ${esc(firstName(p.guestName))}</p>
    <h1 class="monogram">${esc(p.content.coupleNames)}</h1>
    ${p.content.tagline ? `<p class="tagline">${esc(p.content.tagline)}</p>` : ''}`
    }
    ${nn || renderCountdown(p, now)}
    ${nn ? '' : `<p class="welcome">${esc(p.content.welcome)}</p>`}
    ${others.length ? `<p class="household">Your party: ${esc(others.join(', '))}</p>` : ''}
    ${datable > 1 ? `<button type="button" class="cal-all" data-cal="all">${ICON_CAL} Add all ${datable} events to my calendar</button>` : ''}
    ${p.cover ? '' : DESERT_SCENE}
  </section>
  ${
    days.length
      ? dayStrip(days.map(ymd), 'day') +
        days.map((d) => `<section class="day" id="day-${ymd(d)}"${d.day === today ? ' data-today' : ''}><h2>${esc(d.day)}${d.day === today ? ' <span class="today">Today</span>' : ''}</h2>${d.events.map((e) => renderEvent(e, tz, now, p)).join('')}</section>`).join('')
      : '<p class="empty">Your schedule will appear here soon.</p>'
  }`;
}

const ICON_CAL = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/></svg>';

export function renderFaq(p: GuestPayload): string {
  const { faq, contact } = p.content;
  return `<section><h2>Good to know</h2>
  ${faq.map((f) => `<details class="faq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('') || '<p class="empty">Nothing here yet.</p>'}
  ${contact.detail ? `<article class="card contact"><h3>${esc(contact.label || 'Contact')}</h3><p>${esc(contact.detail)}</p></article>` : ''}
  </section>`;
}

export function renderUpdates(p: GuestPayload, tz = p.content.timezone): string {
  const list = [...p.content.updates].sort((a, b) => +new Date(b.at) - +new Date(a.at));
  return `<section><h2>Updates</h2>${
    list.length
      ? list
          .map(
            (u) =>
              `<article class="card update"><p class="time">${esc(formatDay(u.at, tz))}, ${esc(formatTime(u.at, tz))}</p><p>${esc(u.message)}</p></article>`,
          )
          .join('')
      : '<p class="empty">No announcements yet. Check back closer to the weekend.</p>'
  }</section>`;
}

export const TABS = NAV;
export { ALL_TABS };

export function renderApp(p: GuestPayload, tab: TabId, now: Date, weather: WeatherState = { phase: 'loading' }): string {
  const pages: Record<TabId, () => string> = {
    weekend: () => renderWeekend(p, now),
    program: () => renderProgram(p),
    meals: () => renderMeals(p),
    rides: () => renderRides(p),
    more: () => renderMore(),
    weather: () => renderWeather(p, weather, now),
    map: () => renderMap(p),
    faq: () => renderFaq(p),
    updates: () => renderUpdates(p),
  };
  const active = navFor(tab);
  const back = isMoreChild(tab)
    ? `<button type="button" class="back" data-tab="more">&lsaquo; More</button>`
    : '';
  return `
  <div class="app">
    <main id="content" tabindex="-1">${back}${pages[tab]()}</main>
    <nav class="tabs" aria-label="Sections">
      ${NAV.map((t) => `<button type="button" data-tab="${t.id}" ${t.id === active ? 'aria-current="page"' : ''}>${t.icon}<span>${t.label}</span></button>`).join('')}
    </nav>
    <footer class="foot"><button type="button" id="signout" class="link">Not you? Sign out</button></footer>
  </div>`;
}

export { MORE_ITEMS };
