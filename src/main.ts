import '@fontsource/sacramento/latin-400.css';
import '@fontsource/cormorant-garamond/latin-400.css';
import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/jost/latin-400.css';
import '@fontsource/jost/latin-500.css';
import './style.css';
import { buildIcs } from './core/links';
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
