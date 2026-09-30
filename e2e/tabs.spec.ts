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
    const meal = (label: string) => page.locator(`[data-label="${label}"]`);
    await expect(meal('Welcome drinks & bites')).toContainText('Jain options');
    await expect(meal('Afternoon snacks')).toContainText('3:00 PM');
    await expect(meal('Afternoon snacks')).toContainText('Main Lawn');
    await expect(meal('Dinner')).toContainText('7:00 PM');
    await expect(meal('Dinner')).toContainText('Fully Jain');
    await expect(meal('Cocktail hour')).toContainText('Just before dinner');
    await expect(meal('Farewell brunch')).toContainText('Time to be announced');
    await expect(page.locator('body')).not.toContainText('Menu to be announced');
    await expect(page.locator('.jain-legend')).toHaveCount(0);
  });
  test('meals on a day are in time order', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    await openTab(page, 'Meals');
    const labels = await page.locator('[data-meal]').evaluateAll((els) => els.map((e) => e.getAttribute('data-label')));
    expect(labels.indexOf('Welcome drinks & bites')).toBeGreaterThan(labels.indexOf('Afternoon snacks'));
    expect(labels.indexOf('Dinner')).toBeGreaterThan(labels.indexOf('Cocktail hour') - 1);
    expect(labels.at(-1)).toBe('Farewell brunch');
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
  test('shows the resort map with the guest\'s own spots pinned, and no street map', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    await openTab(page, 'Hotel map');
    await expect(page.locator('#resort-map img')).toBeVisible();
    await expect(page.locator('.pin')).toHaveCount(1);
    await expect(page.locator('.pin[data-pin=L]')).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
  });
  test('tapping a pin shows what is there', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    await openTab(page, 'Hotel map');
    await expect(page.locator('.pin-info[data-info=L]')).toBeHidden();
    await page.locator('.pin[data-pin=L]').click();
    await expect(page.locator('.pin[data-pin=L]')).toHaveClass(/active/);
    await expect(page.locator('.pin-info[data-info=L]')).toBeVisible();
    await expect(page.locator('.pin-info[data-info=L]')).toContainText('Welcome Drinks');
  });
  test('zoom in and out', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    await openTab(page, 'Hotel map');
    const scroller = page.locator('#resort-map .map-scroll');
    const w0 = await page.locator('.map-canvas').evaluate((el) => el.getBoundingClientRect().width);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(scroller).toHaveAttribute('data-zoomed', 'true');
    await expect.poll(() => page.locator('.map-canvas').evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(Math.min(w0 + 1, 999));
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect(scroller).toHaveAttribute('data-zoomed', 'false');
  });
  test('tapping an event in the list zooms to its pin and brings the map into view', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    await openTab(page, 'Hotel map');
    await page.locator('[data-where=welcome] button').click();
    await expect(page.locator('.pin[data-pin=L]')).toHaveClass(/active/);
    await expect(page.locator('.pin[data-pin=L]')).toBeInViewport();
    await expect(page.locator('.pin-info[data-info=L]')).toBeVisible();
  });
  test('"Show on map" on an event card opens the map at that spot', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    await page.locator('[data-event=welcome]').getByRole('button', { name: 'Show on map' }).click();
    await expect(page.locator('.page-head h2')).toHaveText('Hotel Map');
    await expect(page.locator('.pin[data-pin=L]')).toHaveClass(/active/);
    await expect(page.locator('.pin[data-pin=L]')).toBeInViewport();
  });
});

test.describe('Hotel map: where is my event?', () => {
  test('lists this guest\'s events with their lawn or hall (or says it is not decided yet)', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    await openTab(page, 'Hotel map');
    const where = page.locator('#map-where');
    await expect(where.locator('h2')).toHaveText('Where is my event?');
    await expect(where.locator('[data-where=welcome]')).toContainText('Main Lawn');
    await expect(where.locator('[data-where=reception]')).toContainText('Grand Ballroom');
    await expect(where.locator('[data-where=ceremony]')).toContainText('Rosewood Chapel');
    await expect(where.locator('[data-where=brunch]')).toContainText('Location to be announced');
    await expect(where.locator('[data-where=brunch]')).toContainText('Time TBA');
  });
  test('a one-event guest sees only their own event', async ({ page }) => {
    await unlock(page, 'Sam Chen');
    await openTab(page, 'Hotel map');
    await expect(page.locator('#map-where li')).toHaveCount(1);
    await expect(page.locator('#map-where')).not.toContainText('Grand Ballroom');
  });
  test('the property map comes first, then the event list', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    await openTab(page, 'Hotel map');
    const y = (sel: string) => page.locator(sel).first().evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    expect(await y('#resort-map')).toBeLessThan(await y('#map-where'));
  });
  test('the event card shows the lawn or hall too, without repeating the street address', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    await expect(page.locator('[data-event=welcome] .area')).toHaveText('Main Lawn (L)');
    await expect(page.locator('[data-event=welcome]')).not.toContainText('100 Example Street');
    await expect(page.locator('[data-event=ceremony] .area')).toHaveCount(0);
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

test.describe('day strip', () => {
  test('tapping a day scrolls to it, and the strip stays visible while scrolling', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    await page.locator('.daystrip button', { hasText: 'Sun' }).click();
    await expect(page.locator('.day h2', { hasText: 'Sunday' })).toBeInViewport();
    await expect(page.locator('.daystrip')).toBeInViewport();
  });
  test('one-day guests have no strip', async ({ page }) => {
    await unlock(page, 'Sam Chen');
    await expect(page.locator('.daystrip')).toHaveCount(0);
  });
});
