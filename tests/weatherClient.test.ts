import { describe, expect, it } from 'vitest';
import { loadWeather } from '../src/core/weatherClient';
import { forecastUrl, typicalRequests, type WeatherConfig } from '../src/core/weather';

const cfg: WeatherConfig = { place: 'Scottsdale, AZ', latitude: 33.53, longitude: -111.93 };
const TZ = 'America/Phoenix';
const at = (iso: string) => () => new Date(iso);

function memory(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), all: m };
}

const fcJson = (days: string[]) => ({
  daily: {
    time: days,
    temperature_2m_max: days.map(() => 70.4),
    temperature_2m_min: days.map(() => 48.2),
    weather_code: days.map(() => 1),
    precipitation_probability_max: days.map(() => 10),
    sunrise: days.map((d) => `${d}T07:22`),
    sunset: days.map((d) => `${d}T17:24`),
    wind_speed_10m_max: days.map(() => 9),
  },
  hourly: { time: days.map((d) => `${d}T18:00`), temperature_2m: days.map(() => 57.1), weather_code: days.map(() => 0) },
});
const archiveJson = (year: number) => ({
  daily: {
    time: [`${year}-12-15`, `${year}-12-16`, `${year}-12-17`],
    temperature_2m_max: [64, 66, 62],
    temperature_2m_min: [42, 44, 40],
    precipitation_sum: [0, 0, 0.5],
    weather_code: [1, 1, 3],
  },
});

const archiveFull = (year: number) => ({
  daily: {
    time: [15, 16, 17, 18, 19, 20, 21].map((d) => `${year}-12-${d}`),
    temperature_2m_max: Array(7).fill(65),
    temperature_2m_min: Array(7).fill(45),
    precipitation_sum: Array(7).fill(0),
    weather_code: Array(7).fill(1),
  },
});

const DAYS = ['2026-12-16', '2026-12-17', '2026-12-18', '2026-12-19', '2026-12-20'];

describe('forecast window', () => {
  it('fetches one forecast for all days when they are in range', async () => {
    const calls: string[] = [];
    const r = await loadWeather(cfg, DAYS, TZ, {
      now: at('2026-12-15T15:00:00Z'), storage: memory(),
      fetchJson: async (u) => (calls.push(u), fcJson(DAYS)),
    });
    expect(calls).toEqual([forecastUrl(cfg, '2026-12-16', '2026-12-20', TZ)]);
    if (r.phase !== 'ready') throw new Error('expected ready');
    expect(r.days).toHaveLength(5);
    expect(r.days.every((d) => d.kind === 'forecast')).toBe(true);
    expect(r).toMatchObject({ stale: false, missing: [] });
    expect(r.days[0]).toMatchObject({ high: 70, low: 48 });
  });
  it('reuses a fresh saved copy instead of refetching (30 minutes)', async () => {
    const storage = memory();
    let n = 0;
    const deps = { storage, fetchJson: async () => (n++, fcJson(DAYS)) };
    await loadWeather(cfg, DAYS, TZ, { ...deps, now: at('2026-12-15T15:00:00Z') });
    await loadWeather(cfg, DAYS, TZ, { ...deps, now: at('2026-12-15T15:20:00Z') });
    expect(n).toBe(1);
    await loadWeather(cfg, DAYS, TZ, { ...deps, now: at('2026-12-15T15:31:00Z') });
    expect(n).toBe(2);
  });
  it('falls back to the saved copy (marked stale) when the network fails', async () => {
    const storage = memory();
    await loadWeather(cfg, DAYS, TZ, { storage, now: at('2026-12-15T15:00:00Z'), fetchJson: async () => fcJson(DAYS) });
    const r = await loadWeather(cfg, DAYS, TZ, { storage, now: at('2026-12-15T18:00:00Z'), fetchJson: async () => { throw new TypeError('offline'); } });
    expect(r).toMatchObject({ phase: 'ready', stale: true });
  });
  it('is an error with no network and nothing saved', async () => {
    const r = await loadWeather(cfg, DAYS, TZ, { storage: memory(), now: at('2026-12-15T15:00:00Z'), fetchJson: async () => { throw new Error('x'); } });
    expect(r).toEqual({ phase: 'error' });
  });
  it('treats an empty or malformed response as a failure', async () => {
    for (const bad of [{}, null, { daily: { time: [] } }, 'oops']) {
      const r = await loadWeather(cfg, DAYS, TZ, { storage: memory(), now: at('2026-12-15T15:00:00Z'), fetchJson: async () => bad });
      expect(r).toEqual({ phase: 'error' });
    }
  });
  it('ignores corrupt saved data', async () => {
    const storage = memory({ 'wedding.weather.v1|fc|33.53,-111.93|2026-12-16,2026-12-17,2026-12-18,2026-12-19,2026-12-20': '{not json' });
    const r = await loadWeather(cfg, DAYS, TZ, { storage, now: at('2026-12-15T15:00:00Z'), fetchJson: async () => fcJson(DAYS) });
    expect(r.phase).toBe('ready');
  });
  it('works with no storage at all', async () => {
    const r = await loadWeather(cfg, DAYS, TZ, { storage: null, now: at('2026-12-15T15:00:00Z'), fetchJson: async () => fcJson(DAYS) });
    expect(r.phase).toBe('ready');
  });
  it('reports days the API did not return', async () => {
    const r = await loadWeather(cfg, DAYS, TZ, { storage: memory(), now: at('2026-12-15T15:00:00Z'), fetchJson: async () => fcJson(DAYS.slice(0, 3)) });
    if (r.phase !== 'ready') throw new Error('expected ready');
    expect(r.missing).toEqual(['2026-12-19', '2026-12-20']);
  });
});

describe('typical weather (too early for a forecast)', () => {
  const now = at('2026-09-30T15:00:00Z');
  it('makes one request per past year and averages them', async () => {
    const calls: string[] = [];
    const r = await loadWeather(cfg, DAYS, TZ, {
      now, storage: memory(),
      fetchJson: async (u) => (calls.push(u), archiveJson(Number(new URL(u).searchParams.get('start_date')!.slice(0, 4)))),
    });
    expect(calls).toHaveLength(8);
    expect(calls.sort()).toEqual(typicalRequests(DAYS, cfg, TZ).sort());
    if (r.phase !== 'ready') throw new Error('expected ready');
    expect(r.days.every((d) => d.kind === 'typical')).toBe(true);
    expect(r.days[0]).toMatchObject({ date: '2026-12-16', high: 64, low: 42 });
  });
  it('survives some past-year requests failing', async () => {
    let i = 0;
    const r = await loadWeather(cfg, ['2026-12-16'], TZ, {
      now, storage: memory(),
      fetchJson: async (u) => { if (i++ % 2) throw new Error('flaky'); return archiveJson(Number(new URL(u).searchParams.get('start_date')!.slice(0, 4))); },
    });
    expect(r.phase).toBe('ready');
  });
  it('is an error if every request fails and nothing is saved', async () => {
    const r = await loadWeather(cfg, DAYS, TZ, { now, storage: memory(), fetchJson: async () => { throw new Error('down'); } });
    expect(r).toEqual({ phase: 'error' });
  });
  it('caches for two weeks', async () => {
    const storage = memory();
    let n = 0;
    const fetchJson = async (u: string) => (n++, archiveJson(Number(new URL(u).searchParams.get('start_date')!.slice(0, 4))));
    await loadWeather(cfg, DAYS, TZ, { now, storage, fetchJson });
    await loadWeather(cfg, DAYS, TZ, { now: at('2026-10-10T15:00:00Z'), storage, fetchJson });
    expect(n).toBe(8);
    await loadWeather(cfg, DAYS, TZ, { now: at('2026-10-20T15:00:00Z'), storage, fetchJson });
    expect(n).toBe(16);
  });
});

describe('mixed: the first day is in range, later days are not', () => {
  it('combines forecast and typical, sorted by date', async () => {
    const r = await loadWeather(cfg, DAYS, TZ, {
      now: at('2026-12-01T15:00:00Z'), storage: memory(),
      fetchJson: async (u) => (u.includes('archive-api') ? archiveFull(Number(new URL(u).searchParams.get('start_date')!.slice(0, 4))) : fcJson(['2026-12-16'])),
    });
    if (r.phase !== 'ready') throw new Error('expected ready');
    expect(r.days.map((d) => `${d.date}:${d.kind}`)).toEqual([
      '2026-12-16:forecast', '2026-12-17:typical', '2026-12-18:typical', '2026-12-19:typical', '2026-12-20:typical',
    ]);
    expect(r.missing).toEqual([]);
  });
  it('shows what it has when only one half loads', async () => {
    const r = await loadWeather(cfg, DAYS, TZ, {
      now: at('2026-12-01T15:00:00Z'), storage: memory(),
      fetchJson: async (u) => { if (u.includes('archive-api')) throw new Error('nope'); return fcJson(['2026-12-16']); },
    });
    if (r.phase !== 'ready') throw new Error('expected ready');
    expect(r.days).toHaveLength(1);
    expect(r.missing).toEqual(['2026-12-17', '2026-12-18', '2026-12-19', '2026-12-20']);
  });
});
