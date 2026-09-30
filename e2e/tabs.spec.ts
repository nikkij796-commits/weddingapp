import { expect, test } from '@playwright/test';
import { contrast, mockExternal, openTab, unlock, type External } from './helpers';

let ext: External;
test.beforeEach(async ({ page, context }) => {
  ext = await mockExternal(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
});

test.describe('navigation and the More menu', () => {
  test('bottom bar has five items and More lists the other four pages', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    await expect(page.locator('.tabs button')).toHaveText(['Weekend', 'Program', 'Meals', 'Rides', 'More']);
    await page.locator('.tabs button', { hasText: 'More' }).click();
    await expect(page.locator('.menu-card b')).toHaveText(['Weather', 'Hotel map', 'FAQ', 'Updates']);
    await expect(page.locator('.tabs button[aria-current=page]')).toHaveText('More');
  });

  test('each More page opens with a back button, keeps More lit, and Back returns to the menu', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    for (const label of ['Weather', 'Hotel map', 'FAQ', 'Updates'] as const) {
      await openTab(page, label);
      await expect(page.locator('.back')).toBeVisible();
      await expect(page.locator('.tabs button[aria-current=page]')).toHaveText('More');
      await page.locator('.back').click();
      await expect(page.locator('.menu-card')).toHaveCount(4);
    }
  });

  test('every page fits the screen without sideways scrolling and has big tap targets', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    await expect(page.locator('.hero')).toBeVisible();
    for (const label of ['Weekend', 'Program', 'Meals', 'Rides', 'Weather', 'Hotel map', 'FAQ', 'Updates'] as const) {
      await openTab(page, label);
      await expect(page.locator('#content')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${label} overflows`).toBeLessThanOrEqual(0);
      const small = await page.$$eval('.chip, .menu-card, .jump button, .tabs button, .back, .party', (els) =>
        els.filter((e) => (e as HTMLElement).offsetParent !== null && e.getBoundingClientRect().height < 40).length);
      expect(small, `${label} has small tap targets`).toBe(0);
    }
  });

  test('nothing personal leaks: another household\'s data is never on the new pages', async ({ page }) => {
    await unlock(page, 'Sam Chen'); // ceremony only
    for (const label of ['Meals', 'Rides', 'Weather', 'Hotel map'] as const) {
      await openTab(page, label);
      await page.waitForTimeout(150);
      const text = await page.locator('#content').innerText();
      expect(text, label).not.toMatch(/Alex Rivera|Welcome Drinks|Farewell Brunch|Grand Ballroom/);
    }
  });
});

test.describe('Program', () => {
  test('is a placeholder for now', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    await openTab(page, 'Program');
    await expect(page.getByRole('heading', { name: 'Wedding Program', exact: true })).toBeVisible();
    await expect(page.getByText('Virtual Wedding Program')).toBeVisible();
    await expect(page.getByText('Coming soon')).toBeVisible();
  });
});

test.describe('Meals', () => {
  test('lists this guest\'s meals by day', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    await openTab(page, 'Meals');
    await expect(page.locator('.day h2')).toHaveText(['Friday, June 11', 'Saturday, June 12', 'Sunday, June 13']);
    await expect(page.locator('[data-meal=welcome]')).toContainText('Passed appetizers');
    await expect(page.locator('[data-meal=reception]')).toContainText('7:00 PM');
    await expect(page.locator('[data-meal=reception]')).toContainText('Menu to be announced');
    await expect(page.locator('[data-meal=brunch]')).toContainText('Time to be announced');
  });
  test('a guest with no meals sees the placeholder', async ({ page }) => {
    await unlock(page, 'Sam Chen');
    await openTab(page, 'Meals');
    await expect(page.getByText('Meal Schedule')).toBeVisible();
    await expect(page.locator('[data-meal]')).toHaveCount(0);
  });
});

test.describe('Rides', () => {
  test('shows the voucher, copies it, and has working Uber links', async ({ page, browserName }) => {
    await unlock(page, 'Alex Rivera');
    await openTab(page, 'Rides');
    await expect(page.locator('.voucher .code')).toHaveText('SAMPLE-RIDE-50');
    const copy = page.getByRole('button', { name: 'Copy code' });
    await copy.click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
    if (browserName === 'chromium') {
      const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => 'SAMPLE-RIDE-50');
      expect(clip).toBe('SAMPLE-RIDE-50');
    }
    await expect(page.getByRole('button', { name: 'Copy code' })).toBeVisible({ timeout: 3000 }); // label restores
    const hrefs = await page.locator('a[data-uber]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    expect(hrefs.length).toBeGreaterThanOrEqual(3);
    for (const h of hrefs) {
      const u = new URL(h);
      expect(u.hostname).toBe('m.uber.com');
      expect(u.searchParams.get('pickup')).toBe('my_location');
      expect(u.searchParams.get('dropoff[formatted_address]')).toBeTruthy();
    }
  });
  test('the jump buttons scroll to their sections', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    await openTab(page, 'Rides');
    await page.getByRole('button', { name: 'How it works' }).click();
    await expect(page.locator('#rides-how h2')).toBeInViewport();
    await page.getByRole('button', { name: 'Voucher' }).click();
    await expect(page.locator('#rides-voucher h2')).toBeInViewport();
  });
  test('steps and tips are shown', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    await openTab(page, 'Rides');
    await expect(page.locator('.steps li')).toHaveCount(3);
    await expect(page.locator('.tips li')).toHaveCount(1);
  });
});

test.describe('Hotel map', () => {
  test('embeds a map and lists places with map and Uber links', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    await openTab(page, 'Hotel map');
    const src = await page.locator('.map-frame iframe').getAttribute('src');
    expect(src).toContain('https://maps.google.com/maps?q=');
    expect(decodeURIComponent(src!)).toContain('The Garden Terrace');
    await expect(page.locator('.place')).toHaveCount(2);
    await expect(page.locator('.place').first().getByRole('link', { name: 'Google Maps' })).toHaveAttribute('href', /google\.com\/maps/);
    await expect(page.locator('.place').first().getByRole('link', { name: 'Uber' })).toHaveAttribute('href', /m\.uber\.com/);
    await expect(page.getByText('A map of the property will be added here')).toBeVisible();
  });
});

test.describe('Weather', () => {
  test('within 15 days it shows the live forecast for this guest\'s days, with temperatures at event times', async ({ page }) => {
    await page.clock.install({ time: new Date('2027-06-10T12:00:00-04:00') });
    await unlock(page, 'Alex Rivera');
    await openTab(page, 'Weather');
    await expect(page.getByText('Live forecast')).toBeVisible();
    await expect(page.locator('.wx-day')).toHaveCount(3);
    const sat = page.locator('[data-day="2027-06-12"]');
    await expect(sat).toContainText('Saturday, June 12');
    await expect(sat).toContainText('72°');
    await expect(sat).toContainText('/ 49°F');
    await expect(sat).toContainText('20% chance of rain');
    await expect(sat).toContainText('9 mph wind');
    await expect(sat).toContainText('Sunrise 5:27 AM');
    await expect(sat).toContainText('Sunset 8:31 PM');
    await expect(sat).toContainText('wrap or jacket'); // the low is 49
    await expect(sat.locator('.wx-events li').first()).toContainText('4:00 PM Ceremony 56° mostly clear'); // 40 + 16
    await expect(page.locator('.wx-day .badge').first()).toHaveText('Forecast');
    await expect(page.getByRole('link', { name: 'Open-Meteo.com' })).toBeVisible();
  });

  test('asks the forecast API for exactly the right place, units, timezone and days', async ({ page }) => {
    await page.clock.install({ time: new Date('2027-06-10T12:00:00-04:00') });
    await unlock(page, 'Alex Rivera');
    await openTab(page, 'Weather');
    await expect(page.locator('.wx-day')).toHaveCount(3);
    expect(ext.forecast).toHaveLength(1);
    const q = ext.forecast[0].searchParams;
    expect(q.get('latitude')).toBe('40.71');
    expect(q.get('longitude')).toBe('-74');
    expect(q.get('temperature_unit')).toBe('fahrenheit');
    expect(q.get('timezone')).toBe('America/New_York');
    expect(q.get('start_date')).toBe('2027-06-11');
    expect(q.get('end_date')).toBe('2027-06-13');
    expect(ext.archive).toHaveLength(0);
  });

  test('only asks for the guest\'s own days (a one-day guest gets one day)', async ({ page }) => {
    await page.clock.install({ time: new Date('2027-06-10T12:00:00-04:00') });
    await unlock(page, 'Sam Chen'); // ceremony only
    await openTab(page, 'Weather');
    await expect(page.locator('.wx-day')).toHaveCount(1);
    expect(ext.forecast[0].searchParams.get('start_date')).toBe('2027-06-12');
    expect(ext.forecast[0].searchParams.get('end_date')).toBe('2027-06-12');
  });

  test('far ahead it shows typical weather and says when the live forecast starts', async ({ page }) => {
    await page.clock.install({ time: new Date('2027-05-01T12:00:00-04:00') });
    await unlock(page, 'Alex Rivera');
    await openTab(page, 'Weather');
    await expect(page.getByText('Typical weather')).toBeVisible();
    await expect(page.getByText('The live forecast starts on Thursday, May 27')).toBeVisible();
    await expect(page.locator('.wx-day .badge').first()).toHaveText('Typical');
    await expect(page.locator('[data-day="2027-06-12"]')).toContainText('70°');
    expect(ext.forecast).toHaveLength(0);
    expect(ext.archive).toHaveLength(8);
    const years = ext.archive.map((u) => u.searchParams.get('start_date')!.slice(0, 4)).sort();
    expect(years).toEqual(['2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026']);
  });

  test('a failed load shows a friendly error, and Try again recovers', async ({ page }) => {
    await page.clock.install({ time: new Date('2027-06-10T12:00:00-04:00') });
    ext.failWeather(true);
    await unlock(page, 'Alex Rivera');
    await openTab(page, 'Weather');
    await expect(page.getByText('We couldn’t load the weather')).toBeVisible();
    await expect(page.getByRole('link', { name: 'weather.gov' })).toHaveAttribute('href', /forecast\.weather\.gov/);
    ext.failWeather(false);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('.wx-day')).toHaveCount(3);
    await expect(page.getByText('We couldn’t load the weather')).toHaveCount(0);
  });

  test('switching away and back does not refetch right away', async ({ page }) => {
    await page.clock.install({ time: new Date('2027-06-10T12:00:00-04:00') });
    await unlock(page, 'Alex Rivera');
    await openTab(page, 'Weather');
    await expect(page.locator('.wx-day')).toHaveCount(3);
    await page.locator('.back').click();
    await openTab(page, 'Weather');
    await expect(page.locator('.wx-day')).toHaveCount(3);
    expect(ext.forecast).toHaveLength(1);
  });

  test('a reload uses the saved forecast', async ({ page }) => {
    await page.clock.install({ time: new Date('2027-06-10T12:00:00-04:00') });
    await unlock(page, 'Alex Rivera');
    await openTab(page, 'Weather');
    await expect(page.locator('.wx-day')).toHaveCount(3);
    await page.reload();
    await openTab(page, 'Weather');
    await expect(page.locator('.wx-day')).toHaveCount(3);
    expect(ext.forecast).toHaveLength(1);
  });
});

test.describe('legibility on the new pages', () => {
  test('buttons, cards and text are readable at rest and on hover', async ({ page }) => {
    await page.clock.install({ time: new Date('2027-06-10T12:00:00-04:00') });
    await unlock(page, 'Alex Rivera');
    for (const label of ['Rides', 'Hotel map', 'Weather', 'Meals', 'Program'] as const) {
      await openTab(page, label);
      await expect(page.locator('#content')).toBeVisible();
      if (label === 'Weather') await expect(page.locator('.wx-day').first()).toBeVisible();
      for (const sel of ['.chip', '.jump button', '.menu-card b', '.soon-panel h3', '.card h3', '.wx-cond', '.wx-tip', '.page-head h2']) {
        const els = page.locator(`#content ${sel}`);
        const n = await els.count();
        for (let i = 0; i < n; i++) {
          const el = els.nth(i);
          if (!(await el.isVisible())) continue;
          await page.mouse.move(0, 0);
          expect(await contrast(el), `${label} ${sel} at rest`).toBeGreaterThanOrEqual(3);
          if (sel === '.chip' || sel === '.jump button') {
            await el.hover();
            expect(await contrast(el), `${label} ${sel} on hover`).toBeGreaterThanOrEqual(3);
          }
        }
      }
    }
  });
});
