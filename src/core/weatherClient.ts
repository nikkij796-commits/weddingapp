import {
  forecastUrl,
  parseArchive,
  parseForecast,
  planDays,
  typicalFromRows,
  typicalRequests,
  ymdInTimezone,
  type ArchiveRow,
  type DayWeather,
  type WeatherConfig,
} from './weather';

export interface WeatherDeps {
  fetchJson?: (url: string) => Promise<unknown>;
  now?: () => Date;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

export type WeatherResult =
  | {
      phase: 'ready';
      days: DayWeather[];
      updatedAt: number;
      /** True when the network failed and older saved data is being shown. */
      stale: boolean;
      /** Days that could not be loaded or found. */
      missing: string[];
    }
  | { phase: 'error' };

const FORECAST_TTL_MS = 30 * 60 * 1000;
const TYPICAL_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const defaultFetch = async (url: string): Promise<unknown> => {
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`weather request failed (${res.status})`);
  return res.json();
};

function defaultStorage(): WeatherDeps['storage'] {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

interface Cached {
  at: number;
  days: DayWeather[];
}

function readCache(storage: WeatherDeps['storage'], key: string): Cached | null {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const c = JSON.parse(raw) as Cached;
    return typeof c.at === 'number' && Array.isArray(c.days) ? c : null;
  } catch {
    return null;
  }
}

function writeCache(storage: WeatherDeps['storage'], key: string, value: Cached) {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: just skip caching */
  }
}

/**
 * Loads weather for the guest's event days. Days inside the forecast window get the real forecast;
 * later days get "typical for these dates" averaged from past years. Falls back to saved data offline.
 */
export async function loadWeather(cfg: WeatherConfig, days: string[], tz: string, deps: WeatherDeps = {}): Promise<WeatherResult> {
  const fetchJson = deps.fetchJson ?? defaultFetch;
  const now = (deps.now?.() ?? new Date()).getTime();
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  const today = ymdInTimezone(new Date(now), tz);
  const plan = planDays(days, today);
  const where = `${cfg.latitude},${cfg.longitude}`;

  const results: DayWeather[] = [];
  let updatedAt = 0;
  let stale = false;
  const missing: string[] = [];

  if (plan.forecast.length) {
    const key = `wedding.weather.v1|fc|${where}|${plan.forecast.join(',')}`;
    const cached = readCache(storage, key);
    if (cached && now - cached.at < FORECAST_TTL_MS) {
      results.push(...cached.days);
      updatedAt = Math.max(updatedAt, cached.at);
    } else {
      try {
        const json = await fetchJson(forecastUrl(cfg, plan.forecast[0], plan.forecast[plan.forecast.length - 1], tz));
        const parsed = parseForecast(json, plan.forecast);
        if (!parsed.length) throw new Error('empty forecast');
        writeCache(storage, key, { at: now, days: parsed });
        results.push(...parsed);
        updatedAt = Math.max(updatedAt, now);
      } catch {
        if (cached) {
          results.push(...cached.days);
          updatedAt = Math.max(updatedAt, cached.at);
          stale = true;
        }
      }
    }
  }

  if (plan.typical.length) {
    const key = `wedding.weather.v1|ty|${where}|${plan.typical.join(',')}`;
    const cached = readCache(storage, key);
    if (cached && now - cached.at < TYPICAL_TTL_MS) {
      results.push(...cached.days);
      updatedAt = Math.max(updatedAt, cached.at);
    } else {
      const settled = await Promise.allSettled(typicalRequests(plan.typical, cfg, tz).map((u) => fetchJson(u)));
      const rows: ArchiveRow[] = settled.flatMap((s) => (s.status === 'fulfilled' ? parseArchive(s.value) : []));
      const typical = typicalFromRows(plan.typical, rows);
      if (typical.length) {
        writeCache(storage, key, { at: now, days: typical });
        results.push(...typical);
        updatedAt = Math.max(updatedAt, now);
      } else if (cached) {
        results.push(...cached.days);
        updatedAt = Math.max(updatedAt, cached.at);
        stale = true;
      }
    }
  }

  const have = new Set(results.map((d) => d.date));
  for (const d of days) if (!have.has(d)) missing.push(d);
  if (!results.length) return { phase: 'error' };
  return { phase: 'ready', days: results.sort((a, b) => a.date.localeCompare(b.date)), updatedAt, stale, missing };
}

