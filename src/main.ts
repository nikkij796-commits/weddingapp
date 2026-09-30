import '@fontsource/sacramento/latin-400.css';
import '@fontsource/cormorant-garamond/latin-400.css';
import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/cormorant-garamond/latin-600.css';
import '@fontsource/jost/latin-400.css';
import '@fontsource/jost/latin-500.css';
import './style.css';
import { buildIcs, googleCalendarUrl, isAppleDevice } from './core/links';
import type { GuestPayload } from './core/types';
import { normalizePayload } from './core/payload';
import { SESSION_VERSION, clearSession, loadSession, refreshSession, saveSession, type Session, type Store } from './core/session';
import { failureDelayMs, httpFetcher, unlock } from './core/vaultClient';
import type { Outcome } from './core/vault';
import { eventDays } from './core/weather';
import { loadWeather } from './core/weatherClient';
import { ALL_TABS, renderApp, renderGate, renderPartyPicker, renderProblem, type TabId, type WeatherState } from './ui/render';
import { renderWeatherBody } from './ui/pages';

const root = document.getElementById('root')!;
let payload: GuestPayload | null = null;
let tab: TabId = 'weekend';
let jumpedToToday = false;
let weatherState: WeatherState = { phase: 'loading' };
let weatherLoadedAt = 0;
let weatherRun = 0;

function safeStore(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null; // private mode: the guide still works, the guest just signs in again next time
  }
}
const store = safeStore();

/** The name and code this guest signed in with, kept so the guide can quietly re-download itself. */
let creds: { name: string; code: string; pick?: string } | null = null;
let typedName = '';
let typedCode = '';
let currentPick: string | undefined;
let lastRefresh = 0;
const REFRESH_AFTER_MS = 10 * 60_000;

const sessionOf = (p: GuestPayload): Session => ({ v: SESSION_VERSION, at: Date.now(), name: creds!.name, code: creds!.code, ...(creds!.pick ? { pick: creds!.pick } : {}), payload: p });

function persist() {
  if (creds && payload) saveSession(store, { name: creds.name, code: creds.code, ...(creds.pick ? { pick: creds.pick } : {}), payload });
}

let failures = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Shows the result of an unlock attempt. Returns an error message to display, or null when handled. */
async function handle(run: () => Promise<Outcome>): Promise<string | null> {
  try {
    const outcome = await run();
    if (outcome.kind === 'ok') {
      failures = 0;
      payload = normalizePayload(outcome.payload) ?? outcome.payload;
      creds = { name: typedName, code: typedCode, ...(currentPick ? { pick: currentPick } : {}) };
      weatherState = { phase: 'loading' };
      weatherLoadedAt = 0;
      lastRefresh = Date.now();
      persist();
      tab = 'weekend';
      showApp();
      return null;
    }
    if (outcome.kind === 'choose') {
      showPicker(outcome);
      return null;
    }
    failures++;
    await sleep(failureDelayMs(failures));
    return outcome.error;
  } catch {
    return 'We could not load the guest data. Check your connection and try again.';
  }
}

function showPicker(choice: Extract<Outcome, { kind: 'choose' }>) {
  root.innerHTML = renderPartyPicker(typedName, choice.choices);
  root.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) =>
    b.addEventListener('click', async () => {
      root.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((x) => (x.disabled = true));
      currentPick = choice.choices.find((c) => c.index === Number(b.dataset.pick))?.label;
      const error = await handle(() => choice.select(Number(b.dataset.pick)));
      if (error) showGate(error);
    }),
  );
  document.getElementById('picker-back')?.addEventListener('click', () => showGate());
}


function showGate(error = '', notice = '') {
  root.innerHTML = renderGate(error, notice);
  const form = document.getElementById('gate-form') as HTMLFormElement;
  const btn = form.querySelector('button')!;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = (form.elements.namedItem('name') as HTMLInputElement).value;
    const code = (form.elements.namedItem('code') as HTMLInputElement).value;
    const err = document.getElementById('gate-error')!;
    if (!name.trim() || !code.trim()) {
      err.textContent = 'Please enter both your name and the wedding code.';
      err.hidden = false;
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Checking…';
    typedName = name.trim();
    typedCode = code;
    currentPick = undefined;
    const error = await handle(() => unlock(name, code));
    if (error === null) return;
    err.textContent = error;
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Unlock my weekend';
  });
}

function showApp() {
  if (!payload) return showGate();
  const p = payload;
  try {
    root.innerHTML = renderApp(p, tab, new Date(), weatherState);
  } catch (err) {
    console.error('A page failed to draw', err);
    return showProblem();
  }
  if (tab === 'weekend' && !jumpedToToday) {
    jumpedToToday = true; // on the weekend itself, open at today's schedule (unless the now/next card is up top)
    if (!root.querySelector('.nownext')) root.querySelector('[data-today]')?.scrollIntoView({ block: 'start' });
  }
  root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      tab = b.dataset.tab as TabId;
      if (!ALL_TABS.includes(tab)) tab = 'weekend';
      showApp();
      window.scrollTo({ top: 0 });
    }),
  );
  if (tab === 'weather') void refreshWeather();
  document.getElementById('signout')?.addEventListener('click', signOut);
}

function signOut() {
  payload = null;
  creds = null;
  weatherState = { phase: 'loading' };
  weatherLoadedAt = 0;
  clearSession(store);
  showGate();
}

/** If a page fails to draw, offer a way out instead of leaving the guest with taps that do nothing. */
function showProblem() {
  root.innerHTML = renderProblem();
  document.getElementById('signout')?.addEventListener('click', signOut);
  root.querySelector('[data-recover]')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Refreshing…';
    if (await refreshInBackground(true)) return;
    // Nothing newer to download: fall back to the main page, and only sign out if even that cannot draw.
    tab = 'weekend';
    try {
      if (!payload) throw new Error('no data');
      renderApp(payload, 'weekend', new Date(), weatherState);
      showApp();
    } catch {
      signOut();
      showGate('We could not refresh your guide. Please enter your name and code again.');
    }
  });
}

/**
 * Quietly re-downloads the guide with the saved name and code, so announcements, vouchers, menus and
 * app updates reach phones that unlocked earlier. Keeps the saved copy if offline. Returns true if
 * the guide was updated.
 */
async function refreshInBackground(force = false): Promise<boolean> {
  const c = creds;
  const p = payload;
  if (!c || !p) return false;
  lastRefresh = Date.now();
  const result = await refreshSession(httpFetcher, sessionOf(p));
  if (result.kind !== 'updated' || creds !== c) return false; // signed out meanwhile, or nothing new
  payload = result.payload;
  persist();
  weatherState = { phase: 'loading' };
  weatherLoadedAt = 0;
  if (force) tab = 'weekend';
  const y = window.scrollY;
  showApp();
  window.scrollTo({ top: y });
  return true;
}

function paintWeather(p: GuestPayload) {
  if (tab !== 'weather') return;
  const el = document.getElementById('weather-root');
  if (!el) return;
  try {
    el.innerHTML = renderWeatherBody(p, weatherState, new Date());
  } catch (err) {
    console.error('Weather failed to draw', err);
    el.innerHTML = '<article class="card wx-error"><h3>We couldn&rsquo;t show the weather</h3><div class="actions"><button type="button" class="chip" data-retry>Try again</button></div></article>';
  }
}

/** Loads (or reloads) the forecast for this guest's event days, at most every 10 minutes unless forced. */
async function refreshWeather(force = false) {
  const p = payload;
  const cfg = p?.content.weather;
  if (!p || !cfg) return;
  if (!force && weatherState.phase === 'ready' && Date.now() - weatherLoadedAt < 10 * 60_000) return;
  const run = ++weatherRun;
  weatherState = { phase: 'loading' };
  paintWeather(p);
  const result = await loadWeather(cfg, eventDays(p.events, p.content.timezone), p.content.timezone);
  if (run !== weatherRun) return;
  weatherState = result;
  weatherLoadedAt = Date.now();
  paintWeather(p);
}

/** One event: Apple devices get a calendar file (opens Calendar), others Google Calendar. The whole weekend is always a file. */
function addToCalendar(id: string) {
  const p = payload;
  if (!p) return;
  const events = id === 'all' ? p.events.filter((e) => !e.timeTbd) : p.events.filter((e) => e.id === id);
  if (!events.length) return;
  if (id !== 'all' && !isAppleDevice()) {
    window.open(googleCalendarUrl(events[0]), '_blank', 'noopener');
    return;
  }
  const name = id === 'all' ? `${p.content.coupleNames} wedding weekend` : events[0].name;
  const blob = new Blob([buildIcs(events, name)], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = id === 'all' ? 'wedding-weekend.ics' : `${events[0].id}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- interactive resort map ----------

function setMapZoom(zoomed: boolean) {
  const scroller = document.querySelector<HTMLElement>('#resort-map .map-scroll');
  if (!scroller) return;
  scroller.dataset.zoomed = String(zoomed);
  const btn = document.querySelector<HTMLElement>('#resort-map [data-mapzoom]');
  if (btn) btn.textContent = zoomed ? 'Zoom out' : 'Zoom in';
}

/** Highlights the pins for these letters, shows what is there, and zooms/scrolls so they are in view. */
function focusPins(letters: string[], scrollPage: boolean) {
  const fig = document.getElementById('resort-map');
  if (!fig) return;
  const img = fig.querySelector('img');
  if (img && !img.complete) {
    img.addEventListener('load', () => focusPins(letters, scrollPage), { once: true }); // positions depend on the image size
    return;
  }
  fig.querySelectorAll<HTMLElement>('.pin').forEach((pin) => pin.classList.toggle('active', letters.includes(pin.dataset.pin!)));
  fig.querySelectorAll<HTMLElement>('.pin-info').forEach((info) => (info.hidden = !letters.includes(info.dataset.info!)));
  fig.querySelector<HTMLElement>('.pin-hint')?.toggleAttribute('hidden', letters.length > 0);
  // Zoom without the animation so pin positions can be measured at their final size.
  const canvas = fig.querySelector<HTMLElement>('.map-canvas')!;
  canvas.style.transition = 'none';
  setMapZoom(true);
  void canvas.offsetWidth; // apply the new width now
  canvas.style.transition = '';
  const scroller = fig.querySelector<HTMLElement>('.map-scroll')!;
  const pins = letters.map((l) => fig.querySelector<HTMLElement>(`.pin[data-pin="${l}"]`)).filter((x): x is HTMLElement => !!x);
  requestAnimationFrame(() => {
    if (pins.length) {
      const x = pins.reduce((sum, pin) => sum + pin.offsetLeft, 0) / pins.length;
      const y = pins.reduce((sum, pin) => sum + pin.offsetTop, 0) / pins.length;
      scroller.scrollTo({ left: x - scroller.clientWidth / 2, top: y - scroller.clientHeight / 2, behavior: 'smooth' });
    }
    if (scrollPage) fig.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
}

// One delegated listener for actions inside pages that re-render (jump links, copy code, weather retry, map, calendar).
root.addEventListener('click', async (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-jump],[data-copy],[data-retry],[data-cal],[data-pin],[data-mapzoom],[data-mapfocus]');
  if (!el) return;
  if (el.dataset.cal) {
    addToCalendar(el.dataset.cal);
  } else if (el.dataset.pin) {
    focusPins([el.dataset.pin], false);
  } else if (el.hasAttribute('data-mapzoom')) {
    setMapZoom(document.querySelector<HTMLElement>('#resort-map .map-scroll')?.dataset.zoomed !== 'true');
  } else if (el.dataset.mapfocus) {
    const letters = el.dataset.mapfocus.split(' ');
    if (tab !== 'map') {
      tab = 'map';
      showApp();
      window.scrollTo({ top: 0 });
    }
    focusPins(letters, true);
  } else if (el.dataset.jump) {
    document.getElementById(el.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (el.dataset.copy !== undefined) {
    const text = el.dataset.copy;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    const label = el.textContent;
    el.textContent = 'Copied';
    setTimeout(() => (el.textContent = label), 1500);
  } else if (el.hasAttribute('data-retry')) {
    void refreshWeather(true);
  }
});

const loaded = loadSession(store);
if (loaded.kind === 'session') {
  const { name, code, pick, payload: saved } = loaded.session;
  creds = { name, code, ...(pick ? { pick } : {}) };
  payload = saved;
  showApp();
  void refreshInBackground();
} else {
  showGate('', loaded.kind === 'legacy' ? 'The guide was updated. Please enter your name and code again.' : '');
}

// Coming back to the app later (e.g. on the wedding weekend): fetch anything published since.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && payload && Date.now() - lastRefresh > REFRESH_AFTER_MS) void refreshInBackground();
});

// Keep "happening now" and the countdown fresh.
setInterval(() => {
  if (payload && document.visibilityState === 'visible' && tab === 'weekend') {
    const y = window.scrollY;
    showApp();
    window.scrollTo({ top: y });
  }
}, 60_000);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
}
