import { expect, test, type Page } from '@playwright/test';
import { mockExternal, openTab, unlock } from './helpers';

/** What a phone saved before the Program/Meals/Rides/Weather/Map pages existed. */
const oldPayload = (over: object = {}) => ({
  guestName: 'Alex Rivera',
  householdNames: ['Alex Rivera', 'Jordan Rivera'],
  events: [
    { id: 'welcome', name: 'Welcome Drinks', start: '2027-06-11T18:00:00-04:00', end: '2027-06-11T20:30:00-04:00', venue: 'The Garden Terrace', address: '100 Example Street, Sampleville, NY 10001', dressCode: 'Smart Casual', dressNotes: '', description: '' },
    { id: 'ceremony', name: 'Ceremony', start: '2027-06-12T16:00:00-04:00', end: '2027-06-12T16:45:00-04:00', venue: 'Rosewood Chapel', address: '200 Example Avenue, Sampleville, NY 10001', dressCode: 'Black Tie Optional', dressNotes: '', description: '' },
  ],
  content: { coupleNames: 'N & S', tagline: 'Old tagline', timezone: 'America/New_York', welcome: 'Old welcome text', faq: [{ q: 'Old question?', a: 'Old answer.' }], contact: { label: '', detail: '' }, updates: [] },
  ...over,
});

/** Plants a saved session in localStorage, the way an earlier visit would have left it. */
async function plant(page: Page, key: string, value: unknown) {
  await page.goto('./');
  // "NOW" is stamped with the browser's own clock, so tests that fake the date don't expire the session.
  await page.evaluate(([k, v]) => {
    const o = v as { at?: unknown };
    if (o.at === 'NOW') o.at = Date.now();
    localStorage.setItem(k as string, JSON.stringify(o));
  }, [key, value]);
}
const v2 = (payload: unknown, over: object = {}) => ({ v: 2, at: 'NOW', name: 'Alex Rivera', code: 'FOREVER', payload, ...over });

// The production build registers a service worker whose requests page.route cannot block; turn it off so simulated outages are real.
test.use({ serviceWorkers: 'block' });

const errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  await mockExternal(page);
});
test.afterEach(() => expect(errors, 'no uncaught page errors').toEqual([]));

const ALL = ['Weekend', 'Program', 'Meals', 'Rides', 'Weather', 'Hotel map', 'FAQ', 'Updates'] as const;

test.describe('a phone that unlocked before the update', () => {
  test('the old (version 1) saved copy is dropped: one friendly notice, then a normal sign-in', async ({ page }) => {
    await plant(page, 'wedding.session.v1', { at: 'NOW', payload: oldPayload() });
    await page.reload();
    await expect(page.locator('#gate-form')).toBeVisible();
    await expect(page.getByRole('status')).toContainText('The guide was updated');
    expect(await page.evaluate(() => localStorage.getItem('wedding.session.v1'))).toBeNull();
    await page.reload();
    await expect(page.getByText('The guide was updated')).toHaveCount(0); // shown only once
    await unlock(page, 'Alex Rivera');
    await expect(page.getByText('Welcome, Alex')).toBeVisible();
  });

  test('a saved copy missing the new fields: every tab opens (no dead taps) and then updates itself', async ({ page }) => {
    await page.clock.install({ time: new Date('2027-06-10T12:00:00-04:00') });
    await plant(page, 'wedding.session.v2', v2(oldPayload()));
    await page.reload();
    await expect(page.getByText('Welcome, Alex')).toBeVisible();
    // The background refresh brings the real data, so Rides gets the voucher without signing in again.
    await openTab(page, 'Rides');
    await expect(page.locator('.voucher .code')).toHaveText('SAMPLE-RIDE-50');
    for (const label of ALL) {
      await openTab(page, label);
      await expect(page.locator('#content')).toBeVisible();
      await expect(page.locator('#content h2').first()).toBeVisible();
    }
    await openTab(page, 'Weather');
    await expect(page.locator('.wx-day')).toHaveCount(3);
    await expect(page.getByText('Coming soon')).toHaveCount(0);
  });

  test('offline (guide data unreachable): the old copy still works and tabs show placeholders, not crashes', async ({ page }) => {
    await plant(page, 'wedding.session.v2', v2(oldPayload()));
    await page.route('**/vault/**', (r) => r.abort());
    await page.reload();
    await expect(page.getByText('Welcome, Alex')).toBeVisible();
    for (const label of ALL) {
      await openTab(page, label);
      await expect(page.locator('#content h2').first()).toBeVisible();
    }
    await openTab(page, 'Weather');
    await expect(page.getByText('Coming soon')).toBeVisible();
    await openTab(page, 'Rides');
    await expect(page.getByText('Voucher details')).toBeVisible();
    await expect(page.locator('#gate-form')).toHaveCount(0); // never signed out just because they are offline
    await openTab(page, 'FAQ');
    await expect(page.getByText('Old question?')).toBeVisible();
  });

  test('a changed wedding code never signs the guest out; their saved guide stays usable', async ({ page }) => {
    await plant(page, 'wedding.session.v2', v2(oldPayload(), { code: 'the-old-code' }));
    await page.reload();
    await expect(page.getByText('Welcome, Alex')).toBeVisible();
    await openTab(page, 'Meals');
    await expect(page.locator('#content h2').first()).toBeVisible();
    await expect(page.locator('#gate-form')).toHaveCount(0);
  });

  test('signing out clears the saved copy for good', async ({ page }) => {
    await unlock(page, 'Sam Chen');
    await expect(page.getByText('Welcome, Sam')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('wedding.session.v2'))).not.toBeNull();
    await page.getByRole('button', { name: 'Not you? Sign out' }).click();
    expect(await page.evaluate(() => localStorage.getItem('wedding.session.v2'))).toBeNull();
    await page.reload();
    await expect(page.locator('#gate-form')).toBeVisible();
  });
});

test.describe('updates reach guests who are already signed in', () => {
  test('a fresh sign-in saves the credentials and the guide, so a reload works offline', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    await expect(page.getByText('Welcome, Alex')).toBeVisible();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('wedding.session.v2')!));
    expect(saved).toMatchObject({ v: 2, name: 'Alex Rivera', code: 'FOREVER' });
    expect(saved.payload.content.rides.voucher.code).toBe('SAMPLE-RIDE-50');
    await page.route('**/vault/**', (r) => r.abort());
    await page.reload();
    await expect(page.getByText('Welcome, Alex')).toBeVisible();
    await openTab(page, 'Rides');
    await expect(page.locator('.voucher .code')).toHaveText('SAMPLE-RIDE-50');
  });

  test('the party a guest picked for a shared name is remembered and refreshed', async ({ page }) => {
    await unlock(page, 'Pat Kim');
    await page.locator('[data-pick="1"]').click(); // just "Pat Kim"
    await expect(page.getByText('Welcome, Pat')).toBeVisible();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('wedding.session.v2')!));
    expect(saved.pick).toBe('Pat Kim');
    // stale copy with wrong data -> refresh restores the picked party's own itinerary, not the other Pat Kim's
    await page.evaluate((s) => localStorage.setItem('wedding.session.v2', JSON.stringify({ ...s, payload: { ...s.payload, events: [] } })), saved);
    await page.reload();
    await expect(page.locator('[data-event]')).toHaveCount(2); // ceremony + reception
    await expect(page.getByText('Your party: Lee Kim')).toHaveCount(0);
  });
});

test.describe('a page that fails to draw', () => {
  const broken = () => oldPayload({ events: [{ ...oldPayload().events[0], start: 'not-a-date' }] });

  test('shows a recovery screen instead of dead taps, and recovery restores the guide', async ({ page }) => {
    await plant(page, 'wedding.session.v2', v2(broken()));
    await page.route('**/vault/**', (r) => r.abort()); // cannot self-heal yet
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
    await page.unroute('**/vault/**');
    await page.getByRole('button', { name: 'Refresh my guide' }).click();
    await expect(page.getByText('Welcome, Alex')).toBeVisible();
    await expect(page.locator('[data-event]').first()).toBeVisible();
  });

  test('with nothing to refresh from, recovery ends at a clear sign-in message', async ({ page }) => {
    await plant(page, 'wedding.session.v2', v2(broken()));
    await page.route('**/vault/**', (r) => r.abort());
    await page.reload();
    await page.getByRole('button', { name: 'Refresh my guide' }).click();
    await expect(page.locator('#gate-form')).toBeVisible();
    await expect(page.locator('#gate-error')).toContainText('could not refresh your guide');
  });

  test('when the network is fine the guide heals itself without any tap', async ({ page }) => {
    await plant(page, 'wedding.session.v2', v2(broken()));
    await page.reload();
    await expect(page.getByText('Welcome, Alex')).toBeVisible({ timeout: 10_000 });
  });
});
