import '@fontsource/sacramento/latin-400.css';
import '@fontsource/cormorant-garamond/latin-400.css';
import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/jost/latin-400.css';
import '@fontsource/jost/latin-500.css';
import './style.css';
import { buildIcs } from './core/links';
import type { GuestPayload } from './core/types';
import { failureDelayMs, unlock } from './core/vaultClient';
import type { Outcome } from './core/vault';
import { eventDays } from './core/weather';
import { loadWeather } from './core/weatherClient';
import { ALL_TABS, renderApp, renderGate, renderPartyPicker, type TabId, type WeatherState } from './ui/render';
import { renderWeatherBody } from './ui/pages';

const root = document.getElementById('root')!;
const KEY = 'wedding.session.v1';
const MAX_AGE = 1000 * 60 * 60 * 24 * 14;

let payload: GuestPayload | null = null;
let tab: TabId = 'weekend';
let jumpedToToday = false;
let weatherState: WeatherState = { phase: 'loading' };
let weatherLoadedAt = 0;
let weatherRun = 0;

function load(): GuestPayload | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as { at: number; payload: GuestPayload };
    return Date.now() - s.at < MAX_AGE ? s.payload : null;
  } catch {
    return null;
  }
}
function save(p: GuestPayload | null) {
  try {
    if (p) localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), payload: p }));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: session just won't persist */
  }
}

let failures = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Shows the result of an unlock attempt. Returns an error message to display, or null when handled. */
async function handle(run: () => Promise<Outcome>): Promise<string | null> {
  try {
    const outcome = await run();
    if (outcome.kind === 'ok') {
      failures = 0;
      payload = outcome.payload;
      weatherState = { phase: 'loading' };
      weatherLoadedAt = 0;
      save(payload);
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
      const error = await handle(() => choice.select(Number(b.dataset.pick)));
      if (error) showGate(error);
    }),
  );
  document.getElementById('picker-back')?.addEventListener('click', () => showGate());
}

let typedName = '';

function showGate(error = '') {
  root.innerHTML = renderGate(error);
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
  root.innerHTML = renderApp(p, tab, new Date(), weatherState);
  if (tab === 'weekend' && !jumpedToToday) {
    jumpedToToday = true; // on the weekend itself, open at today's schedule
    root.querySelector('[data-today]')?.scrollIntoView({ block: 'start' });
  }
  root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      tab = b.dataset.tab as TabId;
      if (!ALL_TABS.includes(tab)) tab = 'weekend';
      showApp();
      window.scrollTo({ top: 0 });
    }),
  );
  root.querySelectorAll<HTMLButtonElement>('[data-ics]').forEach((b) =>
    b.addEventListener('click', () => {
      const e = p.events.find((x) => x.id === b.dataset.ics);
      if (!e) return;
      const blob = new Blob([buildIcs([e], e.name)], { type: 'text/calendar' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${e.id}.ics`;
      a.click();
      URL.revokeObjectURL(a.href);
    }),
  );
  if (tab === 'weather') void refreshWeather();
  document.getElementById('signout')?.addEventListener('click', () => {
    payload = null;
    weatherState = { phase: 'loading' };
    weatherLoadedAt = 0;
    save(null);
    showGate();
  });
}

function paintWeather(p: GuestPayload) {
  if (tab !== 'weather') return;
  const el = document.getElementById('weather-root');
  if (el) el.innerHTML = renderWeatherBody(p, weatherState, new Date());
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

// One delegated listener for actions inside pages that re-render (jump links, copy code, weather retry).
root.addEventListener('click', async (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-jump],[data-copy],[data-retry]');
  if (!el) return;
  if (el.dataset.jump) {
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

payload = load();
if (payload) showApp();
else showGate();

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
