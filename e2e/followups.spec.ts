import { expect, test, type Page } from '@playwright/test';
import { mockExternal, openTab, unlock } from './helpers';

test.beforeEach(async ({ page }) => {
  await mockExternal(page);
});

/** Waits for scrolling to stop. */
async function settle(page: Page) {
  let last = -1;
  for (let i = 0; i < 40; i++) {
    const y = await page.evaluate(() => window.scrollY);
    if (y === last) return;
    last = y;
    await page.waitForTimeout(80);
  }
}

/** The tapped day's heading lands just under the sticky strip (or as high as the page can scroll). */
async function expectDayAtTop(page: Page, sectionId: string) {
  const r = await page.evaluate((id) => {
    const strip = document.querySelector('.daystrip')!.getBoundingClientRect();
    const h = document.querySelector(`#${id} h2`)!.getBoundingClientRect();
    const atBottom = innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
    return { gap: h.top - strip.bottom, atBottom, visible: h.top >= strip.bottom && h.bottom <= innerHeight };
  }, sectionId);
  expect(r.visible).toBe(true);
  if (!r.atBottom) {
    expect(r.gap).toBeGreaterThanOrEqual(0);
    expect(r.gap).toBeLessThanOrEqual(24);
  }
}

const chips = (page: Page) => page.locator('.daystrip [data-jump]');

test.describe('day strip: tapping a date goes to that date and highlights it', () => {
  for (const where of ['Weekend', 'Meals'] as const) {
    test(`${where}: every date, in any order, scrolls to its own day and lights only that chip`, async ({ page }) => {
      await unlock(page, 'Alex Rivera');
      if (where === 'Meals') await openTab(page, 'Meals');
      await expect(chips(page).first()).toBeVisible();
      const n = await chips(page).count();
      expect(n).toBeGreaterThan(1);
      const order = [...Array(n).keys(), ...[...Array(n).keys()].reverse(), 0, n - 1, 1];
      for (const i of order) {
        const chip = chips(page).nth(i);
        const id = (await chip.getAttribute('data-jump'))!;
        await chip.click();
        // Lit straight away, and still lit (not a neighbouring day) once the scrolling ends.
        await expect(chip).toHaveAttribute('aria-current', 'date');
        await settle(page);
        await expect(chip).toHaveAttribute('aria-current', 'date');
        await expect(page.locator('.daystrip [aria-current]')).toHaveCount(1);
        await expectDayAtTop(page, id);
      }
    });
  }

  test('the highlight follows the day you scroll to by hand', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    await expect(chips(page).first()).toBeVisible();
    const ids = await chips(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.jump!));
    for (const [i, id] of ids.entries()) {
      await page.evaluate((sid) => {
        const strip = document.querySelector('.daystrip') as HTMLElement;
        const h = document.querySelector(`#${sid} h2`)!;
        window.scrollTo({ top: h.getBoundingClientRect().top + scrollY - strip.offsetHeight - 8, behavior: 'instant' as ScrollBehavior });
      }, id);
      await expect(chips(page).nth(i)).toHaveAttribute('aria-current', 'date');
    }
  });

  test('with reduced motion the jump is instant', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await unlock(page, 'Alex Rivera');
    const last = chips(page).last();
    await last.click();
    // No animation: already at the destination on the next frame.
    const id = (await last.getAttribute('data-jump'))!;
    await page.waitForTimeout(50);
    await expectDayAtTop(page, id);
  });
});

test.describe('event cards', () => {
  test('swipe rows: every card has the same width and height, with the buttons along the bottom', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    await expect(page.locator('.swipe > .event').first()).toBeVisible();
    const measure = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.swipe > .event')].map((c) => {
          const r = c.getBoundingClientRect();
          const a = c.querySelector('.actions')?.getBoundingClientRect();
          const panel = c.querySelector('.panel')!.getBoundingClientRect();
          return { w: r.width, h: r.height, actionsGap: a ? panel.bottom - a.bottom : null };
        }),
      );
    const check = async () => {
      const cards = await measure();
      expect(cards.length).toBeGreaterThan(2);
      for (const c of cards) {
        expect(Math.abs(c.w - cards[0].w)).toBeLessThanOrEqual(1);
        expect(Math.abs(c.h - cards[0].h)).toBeLessThanOrEqual(1);
      }
      const gaps = cards.map((c) => c.actionsGap).filter((g): g is number => g !== null);
      for (const g of gaps) expect(Math.abs(g - gaps[0])).toBeLessThanOrEqual(1);
    };
    await check();
    // Still even after the screen size changes (e.g. turning the phone).
    const vp = page.viewportSize()!;
    await page.setViewportSize({ width: Math.round(vp.width * 0.9), height: vp.height });
    await page.waitForTimeout(250);
    await check();
  });

  test('a day with several events swipes sideways one card at a time; the page itself never scrolls sideways', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    const row = page.locator('.swipe').filter({ has: page.locator('.event:nth-child(2)') }).first();
    await expect(row).toBeVisible();
    await row.scrollIntoViewIfNeeded();
    const before = await row.evaluate((el) => el.scrollLeft);
    await row.evaluate((el) => el.scrollBy({ left: el.clientWidth, behavior: 'instant' as ScrollBehavior }));
    await page.waitForTimeout(300);
    expect(await row.evaluate((el) => el.scrollLeft)).toBeGreaterThan(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });

  test('Uber on an off-site event sends the map pin, so the destination is filled in', async ({ page }) => {
    await unlock(page, 'Sam Chen');
    const href = (await page.locator('[data-event=ceremony]').getByRole('link', { name: 'Uber' }).getAttribute('href'))!;
    const u = new URL(href);
    expect(u.searchParams.get('dropoff[latitude]')).toBe('40.7411');
    expect(u.searchParams.get('dropoff[longitude]')).toBe('-73.9897');
    expect(u.searchParams.get('dropoff[nickname]')).toBe('Rosewood Chapel');
    expect(u.searchParams.get('dropoff[formatted_address]')).toBe('200 Example Avenue, Sampleville, NY 10001');
  });
});

test.describe('Meals: tapping where a meal is', () => {
  test('opens the hotel map with that spot highlighted', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    await openTab(page, 'Meals');
    const where = page.locator('.meal').filter({ hasText: 'Welcome drinks' }).locator('button.meal-where');
    await expect(where).toHaveText('Main Lawn (L)');
    await where.click();
    await expect(page.locator('.tabs [aria-current=page]')).toContainText('More');
    await expect(page.locator('#resort-map .pin.active[data-pin=L]')).toBeVisible();
    await expect(page.locator('.pin-info[data-info=L]')).toBeVisible();
  });
  test('the Sunday brunch says Jain options', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    await openTab(page, 'Meals');
    await expect(page.locator('.meal').filter({ hasText: 'Farewell brunch' }).locator('.pill.options')).toHaveText('Jain options');
  });
});

test.describe('Hotel map: full size', () => {
  const open = async (page: Page) => {
    await unlock(page, 'Alex Rivera');
    await openTab(page, 'Hotel map');
    await page.getByRole('button', { name: 'Full size' }).click();
    const dlg = page.getByRole('dialog', { name: 'Property map, full size' });
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('img')).toBeVisible();
    return dlg;
  };

  test('opens inside the app with a big, visible Close button that returns to the map', async ({ page }) => {
    const dlg = await open(page);
    const close = dlg.getByRole('button', { name: 'Close full-size map' });
    await expect(close).toBeInViewport({ ratio: 1 });
    const b = (await close.boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect(b.width).toBeGreaterThanOrEqual(44);
    await expect(close).toBeFocused();
    await close.click();
    await expect(dlg).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Full size' })).toBeFocused();
    await expect(page.locator('#resort-map')).toBeVisible();
    expect(page.url()).not.toContain('resort-map.jpg');
  });

  test('Escape closes it', async ({ page }) => {
    const dlg = await open(page);
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(page.locator('#resort-map')).toBeVisible();
  });

  test("the phone's Back gesture closes it and stays in the app", async ({ page }) => {
    const dlg = await open(page);
    await page.goBack();
    await expect(dlg).toHaveCount(0);
    await expect(page.locator('#resort-map')).toBeVisible();
    // and it can be opened again
    await page.getByRole('button', { name: 'Full size' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('zoom toggles and the page behind does not scroll', async ({ page }) => {
    const dlg = await open(page);
    const zoom = dlg.getByRole('button', { name: 'Zoom in' });
    await zoom.click();
    await expect(dlg.getByRole('button', { name: 'Zoom out' })).toHaveAttribute('aria-pressed', 'true');
    const scroller = dlg.locator('.map-full-scroll');
    expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe('hidden');
    await dlg.getByRole('button', { name: 'Close full-size map' }).click();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe('hidden');
  });
});

test.describe('accessibility basics', () => {
  test('Skip to content is the first thing a keyboard reaches and moves focus to the page', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard navigation');
    await unlock(page, 'Alex Rivera');
    await expect(page.locator('.daystrip')).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page.locator('#content')).toBeFocused();
  });
});
