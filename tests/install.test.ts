import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { installKind, isIos } from '../src/core/install';
import { renderInstall, renderMore } from '../src/ui/pages';
import { renderApp } from '../src/ui/render';
import { payloadFor } from './fixtures';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

describe('installKind', () => {
  it('offers nothing once opened from the home screen', () => {
    for (const ua of [IPHONE, ANDROID]) expect(installKind({ ua, standalone: true, canPrompt: true })).toBe('none');
  });
  it('uses the browser\'s own dialog when it offers one', () => expect(installKind({ ua: ANDROID, standalone: false, canPrompt: true })).toBe('prompt'));
  it('shows Share steps on iPhone, and on iPad (which reports itself as a Mac with touch)', () => {
    expect(installKind({ ua: IPHONE, standalone: false, canPrompt: false })).toBe('ios');
    expect(installKind({ ua: IPAD, standalone: false, canPrompt: false, touchMac: true })).toBe('ios');
    expect(isIos(IPAD, false)).toBe(false); // a real Mac
  });
  it('falls back to the browser menu elsewhere', () => expect(installKind({ ua: ANDROID, standalone: false, canPrompt: false })).toBe('manual'));
});

describe('install card', () => {
  it('prompt: one button that opens the browser dialog', () => {
    const h = renderInstall('prompt', 'card');
    expect(h).toContain('data-install>');
    expect(h).toContain('Add to home screen');
    expect(h).toContain('data-install-dismiss');
  });
  it('iPhone: Share, Add to Home Screen, and a heads-up about signing in once more', () => {
    const h = renderInstall('ios', 'card');
    expect(h).toContain('<b>Share</b>');
    expect(h).toContain('<b>Add to Home Screen</b>');
    expect(h).toContain('name and code once more');
    expect(h).not.toContain('data-install>');
  });
  it('manual: points at the browser menu', () => expect(renderInstall('manual', 'card')).toContain('browser&rsquo;s menu'));
  it('nothing when already installed', () => {
    expect(renderInstall('none', 'card')).toBe('');
    expect(renderInstall('none', 'more')).toBe('');
  });
  it('the More version cannot be dismissed', () => expect(renderInstall('ios', 'more')).not.toContain('data-install-dismiss'));
  it('pages have slots for it: Weekend after the header, More above Appearance', () => {
    const w = renderApp(payloadFor('Alex Rivera'), 'weekend', new Date('2027-06-01T12:00:00-04:00'));
    expect(w.indexOf('id="install-slot"')).toBeGreaterThan(w.indexOf('class="hero'));
    expect(w.indexOf('id="install-slot"')).toBeLessThan(w.indexOf('class="daystrip"'));
    const m = renderMore();
    expect(m.indexOf('id="install-more"')).toBeLessThan(m.indexOf('Appearance'));
  });
});

describe('home-screen icons', () => {
  const png = (f: string) => {
    const b = readFileSync(`public/${f}`);
    expect(b.subarray(1, 4).toString()).toBe('PNG');
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  };
  it('the manifest lists 192 and 512 PNGs that exist at those sizes', () => {
    const m = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
    for (const size of [192, 512]) {
      const icon = m.icons.find((i: { sizes: string }) => i.sizes === `${size}x${size}`);
      expect(icon.type).toBe('image/png');
      expect(png(icon.src)).toEqual([size, size]);
    }
    expect(m.display).toBe('standalone');
    expect(m.short_name.length).toBeLessThanOrEqual(12); // fits under the icon
  });
  it('iPhones get a 180px PNG and app tags', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('rel="apple-touch-icon" href="/icon-180.png"');
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(png('icon-180.png')).toEqual([180, 180]);
  });
});
