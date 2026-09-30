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
import { TABS, renderApp, renderGate, renderPartyPicker, type TabId } from './ui/render';

const root = document.getElementById('root')!;
const KEY = 'wedding.session.v1';
const MAX_AGE = 1000 * 60 * 60 * 24 * 14;

let payload: GuestPayload | null = null;
let tab: TabId = 'weekend';
let jumpedToToday = false;

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
  root.innerHTML = renderApp(p, tab, new Date());
  if (tab === 'weekend' && !jumpedToToday) {
    jumpedToToday = true; // on the weekend itself, open at today's schedule
    root.querySelector('[data-today]')?.scrollIntoView({ block: 'start' });
  }
  root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      tab = b.dataset.tab as TabId;
      if (!TABS.some((t) => t.id === tab)) tab = 'weekend';
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
  document.getElementById('signout')?.addEventListener('click', () => {
    payload = null;
    save(null);
    showGate();
  });
}

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
