import './style.css';
import { buildIcs } from './core/links';
import type { GuestPayload } from './core/types';
import { TABS, renderApp, renderGate, type TabId } from './ui/render';

const root = document.getElementById('root')!;
const KEY = 'wedding.session.v1';
const MAX_AGE = 1000 * 60 * 60 * 24 * 14;

let payload: GuestPayload | null = null;
let tab: TabId = 'weekend';

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
    try {
      const res = await fetch('/api/unlock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, code }),
      });
      const data = await res.json();
      if (data.ok) {
        payload = data.payload;
        save(payload);
        tab = 'weekend';
        showApp();
        return;
      }
      err.textContent = data.error ?? 'Something went wrong. Please try again.';
    } catch {
      err.textContent = 'We could not reach the server. Check your connection and try again.';
    }
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Unlock my weekend';
  });
}

function showApp() {
  if (!payload) return showGate();
  const p = payload;
  root.innerHTML = renderApp(p, tab, new Date());
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
  navigator.serviceWorker.register('/sw.js').catch(() => undefined);
}
