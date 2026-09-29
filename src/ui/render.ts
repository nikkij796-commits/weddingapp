import { appleMapsUrl, googleCalendarUrl, googleMapsUrl } from '../core/links';
import { countdown, currentOrNext, eventStatus, formatDay, formatTime, groupByDay } from '../core/time';
import type { EventInfo, GuestPayload } from '../core/types';

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

export function renderGate(error = ''): string {
  return `
  <main class="gate">
    <div class="gate-card">
      <p class="eyebrow">You're invited</p>
      <h1 class="monogram">N <span>&amp;</span> S</h1>
      <p class="lede">Enter your name and wedding code to see your weekend.</p>
      <form id="gate-form" novalidate>
        <label for="name">Your name</label>
        <input id="name" name="name" autocomplete="name" placeholder="As shown on your invitation" required />
        <label for="code">Wedding code</label>
        <input id="code" name="code" autocomplete="off" autocapitalize="characters" placeholder="Printed on your invitation" required />
        <p id="gate-error" class="error" role="alert" ${error ? '' : 'hidden'}>${esc(error)}</p>
        <button type="submit" class="btn">Unlock my weekend</button>
      </form>
    </div>
  </main>`;
}

export function renderPartyPicker(name: string, choices: { index: number; label: string }[]): string {
  return `
  <main class="gate">
    <div class="gate-card">
      <p class="eyebrow">One quick step</p>
      <h1 class="picker-title">Select your party</h1>
      <p class="lede">More than one invitation includes the name &ldquo;${esc(name)}&rdquo;. Which one is yours?</p>
      <div class="party-list">
        ${choices.map((c) => `<button type="button" class="party" data-pick="${c.index}">${esc(c.label)}</button>`).join('')}
      </div>
      <button type="button" class="link" id="picker-back">Back</button>
    </div>
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

export function renderEvent(e: EventInfo, tz: string, now: Date): string {
  const status = eventStatus(e, now);
  const badge =
    status === 'live' ? '<span class="badge live">Happening now</span>' : status === 'past' ? '<span class="badge past">Completed</span>' : '';
  const when = e.timeTbd ? 'Time to be announced' : `${formatTime(e.start, tz)} &ndash; ${formatTime(e.end, tz)}`;
  const calendar = e.timeTbd
    ? ''
    : `<a class="chip" href="${esc(googleCalendarUrl(e))}" target="_blank" rel="noopener">Add to Google Calendar</a>
      <button class="chip" data-ics="${esc(e.id)}" type="button">Download .ics</button>`;
  return `
  <article class="event ${status}" data-event="${esc(e.id)}">
    <header>
      <p class="time">${e.timeTbd ? esc(when) : when}</p>
      <h3>${esc(e.name)} ${badge}</h3>
    </header>
    ${e.description ? `<p>${esc(e.description)}</p>` : ''}
    <p class="venue"><strong>${esc(e.venue)}</strong><br>${esc(e.address)}</p>
    ${e.dressCode ? `<p class="dress"><span class="label">Attire</span> ${esc(e.dressCode)}${e.dressNotes ? `<br><span class="muted">${esc(e.dressNotes)}</span>` : ''}</p>` : ''}
    <div class="actions">
      <a class="chip" href="${esc(googleMapsUrl(e))}" target="_blank" rel="noopener">Google Maps</a>
      <a class="chip" href="${esc(appleMapsUrl(e))}" target="_blank" rel="noopener">Apple Maps</a>
      ${calendar}
    </div>
  </article>`;
}

export function renderWeekend(p: GuestPayload, now: Date): string {
  const tz = p.content.timezone;
  const days = groupByDay(p.events, tz);
  const others = p.householdNames.filter((n) => n !== p.guestName);
  return `
  <section class="hero">
    <p class="eyebrow">Welcome, ${esc(firstName(p.guestName))}</p>
    <h1 class="monogram">${esc(p.content.coupleNames)}</h1>
    ${p.content.tagline ? `<p class="tagline">${esc(p.content.tagline)}</p>` : ''}
    ${renderCountdown(p, now)}
    <p class="welcome">${esc(p.content.welcome)}</p>
    ${others.length ? `<p class="household">Also on your invitation: ${esc(others.join(', '))}</p>` : ''}
  </section>
  ${
    days.length
      ? days.map((d) => `<section class="day"><h2>${esc(d.day)}</h2>${d.events.map((e) => renderEvent(e, tz, now)).join('')}</section>`).join('')
      : '<p class="empty">Your schedule will appear here soon.</p>'
  }`;
}

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

export const TABS = [
  { id: 'weekend', label: 'Weekend' },
  { id: 'faq', label: 'FAQ' },
  { id: 'updates', label: 'Updates' },
] as const;
export type TabId = (typeof TABS)[number]['id'];

export function renderApp(p: GuestPayload, tab: TabId, now: Date): string {
  const body =
    tab === 'weekend' ? renderWeekend(p, now) : tab === 'faq' ? renderFaq(p) : renderUpdates(p);
  return `
  <div class="app">
    <main id="content" tabindex="-1">${body}</main>
    <nav class="tabs" aria-label="Sections">
      ${TABS.map((t) => `<button type="button" data-tab="${t.id}" ${t.id === tab ? 'aria-current="page"' : ''}>${t.label}</button>`).join('')}
    </nav>
    <footer class="foot"><button type="button" id="signout" class="link">Not you? Sign out</button></footer>
  </div>`;
}
