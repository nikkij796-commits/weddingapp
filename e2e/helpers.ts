import type { Locator, Page } from '@playwright/test';

export const unlock = async (page: Page, name: string, code = 'FOREVER') => {
  await page.goto('./');
  await page.fill('#name', name);
  await page.fill('#code', code);
  await page.click('button[type=submit]');
};

/** Opens a page by its bottom-bar or More-menu label. */
export async function openTab(page: Page, label: 'Weekend' | 'Program' | 'Meals' | 'Rides' | 'Weather' | 'Hotel map' | 'FAQ' | 'Updates') {
  if (['Weather', 'Hotel map', 'FAQ', 'Updates'].includes(label)) {
    await page.locator('.tabs button', { hasText: 'More' }).click();
    await page.locator('.menu-card', { hasText: label }).click();
  } else {
    await page.locator('.tabs button', { hasText: label }).click();
  }
}

// ---- fake external services (no real network in tests) ----

const range = (start: string, end: string): string[] => {
  const out: string[] = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

/** Same shape as the real forecast API. Highs 72.4, lows 48.6; the hourly temperature equals 40 + the hour. */
export function fakeForecast(url: URL) {
  const days = range(url.searchParams.get('start_date')!, url.searchParams.get('end_date')!);
  const hourly = days.flatMap((d) => Array.from({ length: 24 }, (_, h) => ({ t: `${d}T${String(h).padStart(2, '0')}:00`, temp: 40 + h })));
  return {
    daily: {
      time: days,
      temperature_2m_max: days.map(() => 72.4),
      temperature_2m_min: days.map(() => 48.6),
      weather_code: days.map(() => 1),
      precipitation_probability_max: days.map(() => 20),
      sunrise: days.map((d) => `${d}T05:27`),
      sunset: days.map((d) => `${d}T20:31`),
      wind_speed_10m_max: days.map(() => 9.4),
    },
    hourly: { time: hourly.map((x) => x.t), temperature_2m: hourly.map((x) => x.temp), weather_code: hourly.map(() => 1) },
  };
}

export function fakeArchive(url: URL) {
  const days = range(url.searchParams.get('start_date')!, url.searchParams.get('end_date')!);
  return {
    daily: {
      time: days,
      temperature_2m_max: days.map(() => 70),
      temperature_2m_min: days.map(() => 50),
      precipitation_sum: days.map(() => 0),
      weather_code: days.map(() => 1),
    },
  };
}

export interface External {
  forecast: URL[];
  archive: URL[];
  /** Make the weather services fail (true) or work (false). */
  failWeather: (v: boolean) => void;
}

const CORS = { 'access-control-allow-origin': '*' };

export async function mockExternal(page: Page): Promise<External> {
  const ext: External = { forecast: [], archive: [], failWeather: () => undefined };
  let fail = false;
  ext.failWeather = (v) => (fail = v);
  await page.route('**://api.open-meteo.com/**', (route) => {
    const url = new URL(route.request().url());
    ext.forecast.push(url);
    return fail ? route.abort() : route.fulfill({ json: fakeForecast(url), headers: CORS });
  });
  await page.route('**://archive-api.open-meteo.com/**', (route) => {
    const url = new URL(route.request().url());
    ext.archive.push(url);
    return fail ? route.abort() : route.fulfill({ json: fakeArchive(url), headers: CORS });
  });
  await page.route('**://maps.google.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<html><body>map</body></html>' }));
  await page.route('**://www.google.com/**', (route) => route.abort());
  return ext;
}

/** WCAG contrast of an element's text against its effective (blended) background. */
export const contrast = (loc: Locator) =>
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
