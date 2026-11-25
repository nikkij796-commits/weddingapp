import { expect, test, type Page } from '@playwright/test';
import { mockExternal, openTab, unlock } from './helpers';

test.use({ serviceWorkers: 'block' });

/** Five days, like the real wedding (Wed-Sun): adds two earlier days to the sample guest's saved guide. */
async function fiveDayGuest(page: Page) {
  await unlock(page, 'Alex Rivera');
  await expect(page.locator('.daystrip')).toBeVisible();
  await page.evaluate(() => {
    const key = 'wedding.session.v2';
    const s = JSON.parse(localStorage.getItem(key)!);
    const base = s.payload.events[0];
    s.payload.events.unshift(
      { ...base, id: 'mehendi', name: 'Mehendi', start: '2027-06-09T09:00:00-04:00', end: '2027-06-09T12:00:00-04:00', area: undefined },
      { ...base, id: 'haldi', name: 'Haldi', start: '2027-06-10T09:00:00-04:00', end: '2027-06-10T12:00:00-04:00', area: undefined },
    );
    localStorage.setItem(key, JSON.stringify(s));
  });
  await page.route('**/vault/**', (r) => r.abort()); // keep the edited saved copy
  await page.reload();
  await expect(page.locator('.daystrip [data-jump]')).toHaveCount(5);
}

for (const when of [
  { label: 'live forecast', time: '2027-06-08T12:00:00-04:00' },
  { label: 'typical weather (far ahead)', time: '2027-05-01T12:00:00-04:00' },
]) {
  test(`Weather (${when.label}): all five days fit on one screen with no scrolling`, async ({ page }) => {
    await mockExternal(page);
    await page.clock.install({ time: new Date(when.time) });
    await fiveDayGuest(page);
    await openTab(page, 'Weather');
    await expect(page.locator('.wx-day')).toHaveCount(5);
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => {
      const tabs = document.querySelector('.tabs')!.getBoundingClientRect().top;
      const last = [...document.querySelectorAll('.wx-day')].pop()!.getBoundingClientRect().bottom;
      const credit = document.querySelector('.wx-credit')!.getBoundingClientRect().bottom;
      return { tabs, last, credit, scroll: document.documentElement.scrollHeight - innerHeight };
    });
    expect(r.last, 'last day is above the tab bar').toBeLessThanOrEqual(r.tabs);
    expect(r.credit, 'credit line is above the tab bar').toBeLessThanOrEqual(r.tabs);
    expect(r.scroll, 'page does not scroll').toBeLessThanOrEqual(0);
    // each row is a comfortable tap target and shows the essentials
    for (const row of await page.locator('.wx-day summary').all()) expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.locator('.wx-day summary').first()).toContainText('Wed');
    await expect(page.locator('.wx-day summary').first()).toContainText('°');
  });
}

test('tapping a day shows its details (events with temperatures, sunrise/sunset, tips) and tapping again hides them', async ({ page }) => {
  await mockExternal(page);
  await page.clock.install({ time: new Date('2027-06-08T12:00:00-04:00') });
  await fiveDayGuest(page);
  await openTab(page, 'Weather');
  const sat = page.locator('[data-day="2027-06-12"]');
  await expect(sat.locator('.wx-more')).toBeHidden();
  await sat.locator('summary').click();
  await expect(sat.locator('.wx-more')).toBeVisible();
  await expect(sat.locator('.wx-events li').first()).toContainText('4:00 PM Ceremony 56°');
  await expect(sat.locator('.wx-more')).toContainText('Sunset 8:31 PM');
  await sat.locator('summary').click();
  await expect(sat.locator('.wx-more')).toBeHidden();
});

test('the day rows are read out sensibly by screen readers', async ({ page }) => {
  await mockExternal(page);
  await page.clock.install({ time: new Date('2027-06-08T12:00:00-04:00') });
  await fiveDayGuest(page);
  await openTab(page, 'Weather');
  const label = await page.locator('[data-day="2027-06-12"] summary').getAttribute('aria-label');
  expect(label).toMatch(/^Saturday, June 12: .+, high 72, low 49, 20% rain\. Show details$/);
});
