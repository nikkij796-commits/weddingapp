import { expect, test, type Page } from '@playwright/test';

const unlock = async (page: Page, name: string, code = 'FOREVER') => {
  await page.goto('/');
  await page.fill('#name', name);
  await page.fill('#code', code);
  await page.click('button[type=submit]');
};

test.describe('gate', () => {
  test('shows only the gate before unlocking (no event details in the page)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Unlock my weekend' })).toBeVisible();
    const html = await page.content();
    for (const s of ['Rosewood', 'Grand Ballroom', 'Garden Terrace', 'Alex Rivera', 'FOREVER']) expect(html).not.toContain(s);
  });

  test('empty submit shows a friendly message', async ({ page }) => {
    await page.goto('/');
    await page.click('button[type=submit]');
    await expect(page.locator('#gate-error')).toContainText('both your name and the wedding code');
  });

  test('wrong code and unknown name show the same generic error', async ({ page }) => {
    await unlock(page, 'Alex Rivera', 'WRONG');
    await expect(page.locator('#gate-error')).toContainText("couldn't find that name and code");
    const a = await page.locator('#gate-error').innerText();
    await page.reload();
    await unlock(page, 'Nobody Here');
    await expect(page.locator('#gate-error')).toContainText("couldn't find that name and code");
    expect(await page.locator('#gate-error').innerText()).toBe(a);
  });

  test('event data is never fetched without a valid unlock', async ({ page }) => {
    const bodies: string[] = [];
    page.on('response', async (r) => {
      if (r.url().includes('/api/unlock')) bodies.push(await r.text());
    });
    await unlock(page, 'Alex Rivera', 'WRONG');
    await expect(page.locator('#gate-error')).toBeVisible();
    expect(bodies.join()).not.toMatch(/Ceremony|events/);
  });
});

test.describe('personalized experience', () => {
  test('Sam Chen sees only the ceremony', async ({ page }) => {
    await unlock(page, 'Sam Chen');
    await expect(page.getByText('Welcome, Sam')).toBeVisible();
    await expect(page.locator('[data-event]')).toHaveCount(1);
    await expect(page.locator('[data-event=ceremony]')).toContainText('Rosewood Chapel');
    await expect(page.getByText('Welcome Drinks')).toHaveCount(0);
    await expect(page.getByText('Farewell Brunch')).toHaveCount(0);
  });

  test('forgiving match: accents, case, nickname and typo', async ({ page }) => {
    await unlock(page, 'maria garcia');
    await expect(page.getByText('Welcome, María')).toBeVisible();
    await page.getByRole('button', { name: 'Not you? Sign out' }).click();
    await unlock(page, "tay o'brien");
    await expect(page.getByText('Welcome, Taylor')).toBeVisible();
    await page.getByRole('button', { name: 'Not you? Sign out' }).click();
    await unlock(page, 'Alex Riveraa');
    await expect(page.getByText('Welcome, Alex')).toBeVisible();
  });

  test('household sees shared itinerary and members', async ({ page }) => {
    await unlock(page, 'Jordan Rivera');
    await expect(page.locator('[data-event]')).toHaveCount(4);
    await expect(page.getByText('Also on your invitation: Alex Rivera')).toBeVisible();
  });

  test('event card has attire, maps and calendar actions', async ({ page }) => {
    await unlock(page, 'Sam Chen');
    const card = page.locator('[data-event=ceremony]');
    await expect(card).toContainText('Black Tie Optional');
    await expect(card.getByRole('link', { name: 'Google Maps' })).toHaveAttribute('href', /google\.com\/maps.*Rosewood/);
    await expect(card.getByRole('link', { name: 'Apple Maps' })).toHaveAttribute('href', /maps\.apple\.com/);
    await expect(card.getByRole('link', { name: 'Add to Google Calendar' })).toHaveAttribute('href', /calendar\.google\.com/);
  });

  test('.ics download works', async ({ page }) => {
    await unlock(page, 'Sam Chen');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download .ics' }).click()]);
    expect(dl.suggestedFilename()).toBe('ceremony.ics');
    const fs = await import('node:fs');
    const text = fs.readFileSync((await dl.path())!, 'utf8');
    expect(text).toContain('BEGIN:VEVENT');
    expect(text).toContain('SUMMARY:Ceremony');
  });

  test('tabs navigate and FAQ expands', async ({ page }) => {
    await unlock(page, 'Sam Chen');
    await page.getByRole('button', { name: 'Travel' }).click();
    await expect(page.getByText('Flying in')).toBeVisible();
    await page.getByRole('button', { name: 'FAQ' }).click();
    await page.getByText('What if it rains?').click();
    await expect(page.getByText('indoor backup')).toBeVisible();
    await page.getByRole('button', { name: 'Updates' }).click();
    await expect(page.getByText('Shuttle schedule will be posted')).toBeVisible();
  });

  test('session persists across reload and sign out clears it', async ({ page }) => {
    await unlock(page, 'Sam Chen');
    await expect(page.getByText('Welcome, Sam')).toBeVisible(); // session is saved once unlock completes
    await page.reload();
    await expect(page.getByText('Welcome, Sam')).toBeVisible();
    await page.getByRole('button', { name: 'Not you? Sign out' }).click();
    await page.reload();
    await expect(page.locator('#gate-form')).toBeVisible();
  });
});

test.describe('quality', () => {
  test('no horizontal scroll', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    await expect(page.locator('.hero')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('tap targets are at least 40px tall', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    await expect(page.locator('.hero')).toBeVisible();
    const small = await page.$$eval('.chip, .tabs button', (els) => els.filter((e) => e.getBoundingClientRect().height < 40).length);
    expect(small).toBe(0);
  });

  test('rate limiting kicks in after repeated failures', async ({ page, request }) => {
    void page;
    let last = 0;
    const ip = `test-${Date.now()}`;
    for (let i = 0; i < 12; i++) {
      const r = await request.post('/api/unlock', { data: { name: 'Bad Guess', code: 'nope' }, headers: { 'x-forwarded-for': ip } });
      last = r.status();
    }
    expect(last).toBe(429);
  });
});
