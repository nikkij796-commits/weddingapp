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
    await expect(page.getByText('Your party: Alex Rivera')).toBeVisible();
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

  test('has three tabs (no Travel) and FAQ expands', async ({ page }) => {
    await unlock(page, 'Sam Chen');
    await expect(page.locator('.tabs button')).toHaveText(['Weekend', 'FAQ', 'Updates']);
    await page.getByRole('button', { name: 'FAQ' }).click();
    await page.getByText("What's the weather like?").click();
    await expect(page.getByText('sunny and mild')).toBeVisible();
    await expect(page.getByText('Uber voucher details')).toBeAttached();
    await page.getByRole('button', { name: 'Updates' }).click();
    await expect(page.getByText('Shuttle schedule will be posted')).toBeVisible();
  });

  test('undecided-time event says "Time to be announced" and has no attire or calendar', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    const brunch = page.locator('[data-event=brunch]');
    await expect(brunch).toContainText('Time to be announced');
    await expect(brunch).not.toContainText('Attire');
    await expect(brunch.getByRole('link', { name: 'Add to Google Calendar' })).toHaveCount(0);
    await expect(brunch.getByRole('link', { name: 'Google Maps' })).toBeVisible();
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

test.describe('select your party', () => {
  test('a shared name asks which party, then shows that party\'s weekend', async ({ page }) => {
    await unlock(page, 'Pat Kim');
    await expect(page.getByRole('heading', { name: 'Select your party' })).toBeVisible();
    await expect(page.locator('[data-pick]')).toHaveText(['Pat Kim & Lee Kim', 'Pat Kim']);
    await page.locator('[data-pick="1"]').click();
    await expect(page.getByText('Welcome, Pat')).toBeVisible();
    await expect(page.locator('[data-event]')).toHaveCount(2); // ceremony + reception only
  });

  test('picking the other party shows its household', async ({ page }) => {
    await unlock(page, 'Pat Kim');
    await page.locator('[data-pick="0"]').click();
    await expect(page.getByText('Your party: Lee Kim')).toBeVisible();
    await expect(page.locator('[data-event]')).toHaveCount(1);
  });

  test('the picker is never shown for a wrong code', async ({ page }) => {
    await unlock(page, 'Pat Kim', 'WRONG');
    await expect(page.locator('#gate-error')).toBeVisible();
    await expect(page.getByText('Select your party')).toHaveCount(0);
    expect(await page.content()).not.toContain('Lee Kim');
  });

  test('Back returns to the gate', async ({ page }) => {
    await unlock(page, 'Pat Kim');
    await page.locator('#picker-back').click();
    await expect(page.locator('#gate-form')).toBeVisible();
  });

  test('the picker fits a phone with large tap targets', async ({ page }) => {
    await unlock(page, 'Pat Kim');
    await expect(page.locator('.party').first()).toBeVisible();
    const small = await page.$$eval('.party', (els) => els.filter((e) => e.getBoundingClientRect().height < 44).length);
    expect(small).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});

test.describe('guide behavior', () => {
  test('run-of-show lines are on the card', async ({ page }) => {
    await unlock(page, 'Sam Chen');
    const card = page.locator('[data-event=ceremony]');
    await expect(card.locator('.moments li')).toHaveText(['3:45 PM Seating', '4:00 PM Ceremony']);
  });

  test('on the weekend, the app opens at today and marks it', async ({ page }) => {
    await page.clock.install({ time: new Date('2027-06-12T12:00:00-04:00') });
    await unlock(page, 'Alex Rivera');
    await expect(page.locator('.today')).toHaveText('Today');
    await expect(page.locator('[data-today] h2')).toContainText('Saturday, June 12');
    await expect(page.locator('[data-today] h2')).toBeInViewport();
    await expect(page.getByRole('heading', { name: /Friday, June 11/ })).not.toBeInViewport();
  });

  test('before the weekend there is no Today marker and the page starts at the top', async ({ page }) => {
    await page.clock.install({ time: new Date('2027-05-01T12:00:00-04:00') });
    await unlock(page, 'Alex Rivera');
    await expect(page.locator('.hero')).toBeVisible();
    await expect(page.locator('.today')).toHaveCount(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('gate reads as a guide, not an invitation', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Wedding weekend guide')).toBeVisible();
    expect((await page.content()).toLowerCase()).not.toContain("you're invited");
  });
});

test.describe('legibility', () => {
  // WCAG contrast of an element's text against its effective (blended) background.
  const contrast = (loc: import('@playwright/test').Locator) =>
    loc.evaluate((el) => {
      const parse = (c: string): [number, number, number, number] => {
        let m = c.match(/rgba?\(([^)]+)\)/);
        if (m) {
          const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
          return [v[0], v[1], v[2], v[3] ?? 1];
        }
        m = c.match(/color\(srgb ([^)]+)\)/);
        if (m) {
          const v = m[1].split(/[ /]+/).filter(Boolean).map(Number);
          return [v[0] * 255, v[1] * 255, v[2] * 255, v[3] ?? 1];
        }
        return [0, 0, 0, 0];
      };
      const over = (top: number[], bot: number[]) => {
        const a = top[3];
        return [0, 1, 2].map((i) => top[i] * a + bot[i] * (1 - a)).concat([1]);
      };
      let bg: number[] = [253, 243, 227, 1];
      const chain: Element[] = [];
      for (let n: Element | null = el; n; n = n.parentElement) chain.push(n);
      for (const n of chain.reverse()) bg = over(parse(getComputedStyle(n).backgroundColor), bg);
      const fg = over(parse(getComputedStyle(el).color), bg);
      const lum = (c: number[]) => {
        const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
      };
      const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      return (hi + 0.05) / (lo + 0.05);
    });

  test('every event button is readable at rest and on hover, in every theme', async ({ page }) => {
    await unlock(page, 'Alex Rivera'); // sample events include the dark "reception" theme
    await expect(page.locator('.hero')).toBeVisible();
    const chips = page.locator('.event .chip');
    const n = await chips.count();
    expect(n).toBeGreaterThan(6);
    for (let i = 0; i < n; i++) {
      const chip = chips.nth(i);
      await chip.scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      const rest = await contrast(chip);
      await chip.hover();
      const hover = await contrast(chip);
      const label = await chip.innerText();
      const theme = await chip.evaluate((el) => el.closest('.event')!.getAttribute('data-event'));
      expect(rest, `${theme} / ${label} at rest`).toBeGreaterThanOrEqual(3);
      expect(hover, `${theme} / ${label} on hover`).toBeGreaterThanOrEqual(3);
    }
  });

  test('body text and titles pass contrast in every event card', async ({ page }) => {
    await unlock(page, 'Alex Rivera');
    await expect(page.locator('.hero')).toBeVisible();
    for (const sel of ['.event h3', '.event .desc', '.event .venue', '.event .time']) {
      const els = page.locator(sel);
      for (let i = 0; i < (await els.count()); i++) {
        const c = await contrast(els.nth(i));
        const theme = await els.nth(i).evaluate((el) => el.closest('.event')!.getAttribute('data-event'));
        expect(c, `${theme} ${sel}`).toBeGreaterThanOrEqual(3);
      }
    }
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
