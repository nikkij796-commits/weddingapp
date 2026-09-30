/**
 * Renders the home-screen icons (PNG) from the N&S arch design, using the app's own script font.
 *   node scripts/make-icons.mjs
 * iPhones ignore SVG home-screen icons and Android installs want PNGs, so these are committed in public/.
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const font = readFileSync('node_modules/@fontsource/sacramento/files/sacramento-latin-400-normal.woff2').toString('base64');
const html = (size) => `<!doctype html><html><head><style>
@font-face { font-family: Sacramento; src: url(data:font/woff2;base64,${font}) format('woff2'); }
html, body { margin: 0; width: ${size}px; height: ${size}px; }
svg { display: block; width: ${size}px; height: ${size}px; }
</style></head><body>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fcd19f"/><stop offset="1" stop-color="#fdf3e3"/></linearGradient></defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <path d="M112 432V262a144 172 0 0 1 288 0v170z" fill="none" stroke="#7a1f2b" stroke-width="10"/>
  <text x="256" y="330" font-family="Sacramento" font-size="112" text-anchor="middle" fill="#7a1f2b">N&amp;S</text>
</svg></body></html>`;

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage();
for (const size of [180, 192, 512]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(html(size));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `public/icon-${size}.png`, clip: { x: 0, y: 0, width: size, height: size } });
  console.log(`public/icon-${size}.png`);
}
await browser.close();
