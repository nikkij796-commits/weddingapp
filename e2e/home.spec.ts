import { expect, test, type Page } from '@playwright/test';
import { mockExternal, unlock } from './helpers';

// The production build's offline cache would refresh the guide behind the test's back; keep it out of these tests.
test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await mockExternal(page);
});

/** The day strip is entirely on the first screen, above the bottom tab bar. */
async function stripFitsFirstScreen(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = await page.evaluate(() => {
    const strip = document.querySelector('.daystrip')!.getBoundingClientRect();
    const tabs = document.querySelector('.tabs')!.getBoundingClientRect();
    return { stripTop: strip.top, stripBottom: strip.bottom, tabsTop: tabs.top };
  });
  expect(box.stripTop).toBeGreaterThan(0);
  expect(box.stripBottom).toBeLessThanOrEqual(box.tabsTop);
}

/** Puts an invitation-shaped picture (5:7) into the saved guide, as a real publish does, and reloads offline. */
async function withCover(page: Page, color = '#ffffff') {
  await unlock(page, 'Alex Rivera');
  await expect(page.locator('.daystrip')).toBeVisible();
  await page.evaluate((fill) => {
    const c = Object.assign(document.createElement('canvas'), { width: 500, height: 700 });
    const g = c.getContext('2d')!;
    g.fillStyle = fill;
    g.fillRect(0, 0, 500, 700);
    g.fillStyle = '#7a1f2b';
    g.fillRect(150, 60, 200, 40); // a "headline" near the top, which must stay in view
    const key = 'wedding.session.v2';
    const s = JSON.parse(localStorage.getItem(key)!);
    s.payload.cover = c.toDataURL('image/png');
    localStorage.setItem(key, JSON.stringify(s));
  }, color);
  await page.route('**/vault/**', (r) => r.abort()); // keep the saved copy (no background refresh)
  await page.reload();
  await expect(page.locator('.cover-wrap img.cover')).toBeVisible();
}

test.describe('home screen first view', () => {
  test('without a picture: the day strip is visible without scrolling, and there is no app description', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    await expect(page.locator('.daystrip')).toBeVisible();
    await stripFitsFirstScreen(page);
    await expect(page.locator('.welcome')).toHaveCount(0);
    await expect(page.getByText('Your guide to the weekend')).toHaveCount(0);
    await expect(page.locator('.hero .cd')).toBeVisible();
  });

  test('with the invitation picture: smaller picture, countdown on top of it, strip visible without scrolling', async ({ page }) => {
    await withCover(page);
    await stripFitsFirstScreen(page);
    await expect(page.locator('.welcome')).toHaveCount(0);
    const r = await page.evaluate(() => {
      const img = document.querySelector('.cover')!.getBoundingClientRect();
      const cd = document.querySelector('.cover-overlay .cd')!.getBoundingClientRect();
      const eyebrow = document.querySelector('.cover-overlay .eyebrow')!.getBoundingClientRect();
      return { img: { top: img.top, bottom: img.bottom, w: img.width, h: img.height }, cd: { top: cd.top, bottom: cd.bottom }, eyebrow: { top: eyebrow.top }, vw: innerWidth };
    });
    // The countdown is drawn over the lower part of the picture, not below it.
    expect(r.cd.top).toBeGreaterThan(r.img.top);
    expect(r.cd.bottom).toBeLessThanOrEqual(r.img.bottom);
    expect(r.eyebrow.top).toBeGreaterThan(r.img.top);
    // Smaller than the full 5:7 picture would be at this width.
    expect(r.img.h).toBeLessThan(Math.min(r.img.w, 640) * 1.4 - 1);
    expect(r.img.h).toBeGreaterThanOrEqual(219);
    await expect(page.locator('.cover-overlay')).toContainText('Welcome, Alex');
    await expect(page.locator('.cover-overlay')).toContainText('until');
  });

  test('text on the picture is readable even over a white picture', async ({ page }) => {
    await withCover(page, '#ffffff');
    const lines = page.locator('.cover-overlay .eyebrow, .cover-overlay .cd b, .cover-overlay .cd span, .cover-overlay .cd-next');
    const n = await lines.count();
    expect(n).toBeGreaterThan(4);
    const boxes = [];
    for (let i = 0; i < n; i++) {
      const b = (await lines.nth(i).boundingBox())!;
      const color = await lines.nth(i).evaluate((el) => getComputedStyle(el).color);
      boxes.push({ b, color });
    }
    // Screenshot the shade with the text hidden, then find the lightest pixel behind each line.
    await page.addStyleTag({ content: '.cover-overlay * { visibility: hidden !important; }' });
    const shot = await page.screenshot();
    const worst = await page.evaluate(
      async ({ png, boxes }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${png}`;
        await img.decode();
        const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0);
        const scale = img.width / innerWidth;
        const lum = (r: number, gg: number, b: number) => {
          const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
          return 0.2126 * f(r) + 0.7152 * f(gg) + 0.0722 * f(b);
        };
        return boxes.map(({ b, color }) => {
          const d = g.getImageData(Math.floor(b.x * scale), Math.floor(b.y * scale), Math.max(1, Math.floor(b.width * scale)), Math.max(1, Math.floor(b.height * scale))).data;
          let maxL = 0;
          for (let i = 0; i < d.length; i += 4) maxL = Math.max(maxL, lum(d[i], d[i + 1], d[i + 2]));
          const [r, gg, bb] = color.match(/\d+/g)!.map(Number);
          const t = lum(r, gg, bb);
          return (Math.max(t, maxL) + 0.05) / (Math.min(t, maxL) + 0.05);
        });
      },
      { png: shot.toString('base64'), boxes },
    );
    for (const ratio of worst) expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  test('the "add to home screen" card comes after the day strip, so it never pushes the strip down', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    await expect(page.locator('.daystrip')).toBeVisible();
    const order = await page.evaluate(() => {
      const strip = document.querySelector('.daystrip')!;
      const slot = document.getElementById('install-slot')!;
      return strip.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING;
    });
    expect(order).toBeTruthy();
    await stripFitsFirstScreen(page);
  });

  test('a phone in dark mode gets the same light first view', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await withCover(page, '#ffffff');
    await stripFitsFirstScreen(page);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(253, 243, 227)');
  });
});
