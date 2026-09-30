import { describe, expect, it } from 'vitest';
import {
  FORECAST_HORIZON_DAYS, TYPICAL_YEARS, addDays, archiveUrl, clock12, eventDays, forecastOpensOn, forecastUrl, formatYmd, nwsUrl,
  parseArchive, parseForecast, planDays, sameDayYearsBack, tempAtEvent, tipsFor, typicalFromRows, typicalRequests, weatherCodeInfo, ymdInTimezone,
  type ArchiveRow, type DayWeather, type WeatherConfig,
} from '../src/core/weather';
import type { EventInfo } from '../src/core/types';

const cfg: WeatherConfig = { place: 'Scottsdale, AZ', latitude: 33.53, longitude: -111.93 };
const TZ = 'America/Phoenix';
const ev = (id: string, start: string): EventInfo => ({ id, name: id, start, end: start, venue: 'v', address: 'a', dressCode: '', dressNotes: '', description: '' });

describe('dates', () => {
  it('ymdInTimezone uses the wedding timezone, not UTC', () => {
    expect(ymdInTimezone(new Date('2026-12-20T03:00:00Z'), TZ)).toBe('2026-12-19'); // 8 PM in Phoenix
    expect(ymdInTimezone(new Date('2026-12-20T07:30:00Z'), TZ)).toBe('2026-12-20');
  });
  it.each([['2026-12-16', 1, '2026-12-17'], ['2026-12-31', 1, '2027-01-01'], ['2026-03-01', -1, '2026-02-28'], ['2028-03-01', -1, '2028-02-29'], ['2026-12-16', -15, '2026-12-01'], ['2026-12-16', 0, '2026-12-16']])(
    'addDays(%s,%i)=%s', (d, n, out) => expect(addDays(d as string, n as number)).toBe(out));
  it('eventDays are distinct, sorted, and local', () => {
    const days = eventDays([ev('b', '2026-12-19T19:00:00-07:00'), ev('a', '2026-12-16T09:00:00-07:00'), ev('c', '2026-12-19T09:00:00-07:00'), ev('late', '2026-12-19T23:30:00-07:00')], TZ);
    expect(days).toEqual(['2026-12-16', '2026-12-19']);
  });
  it('a late event stays on its local day even after UTC midnight', () =>
    expect(eventDays([ev('x', '2026-12-19T23:30:00-07:00')], TZ)).toEqual(['2026-12-19']));
  it('formatYmd', () => expect(formatYmd('2026-12-19')).toBe('Saturday, December 19'));
  it('sameDayYearsBack handles leap days', () => {
    expect(sameDayYearsBack('2026-12-16', 3)).toBe('2023-12-16');
    expect(sameDayYearsBack('2028-02-29', 1)).toBe('2027-02-28');
  });
});

describe('planDays (forecast window)', () => {
  const days = ['2026-12-16', '2026-12-17', '2026-12-18', '2026-12-19', '2026-12-20'];
  it('is all typical months out', () => expect(planDays(days, '2026-09-30')).toEqual({ forecast: [], typical: days }));
  it('the window reaches exactly 15 days ahead', () => {
    expect(FORECAST_HORIZON_DAYS).toBe(15);
    expect(planDays(days, '2026-12-01')).toEqual({ forecast: ['2026-12-16'], typical: days.slice(1) });
  });
  it('is all forecast a week out and during the weekend', () => {
    expect(planDays(days, '2026-12-09').typical).toEqual([]);
    expect(planDays(days, '2026-12-18')).toEqual({ forecast: days, typical: [] });
  });
  it('still forecasts (recent past) after the weekend', () => expect(planDays(days, '2026-12-25').forecast).toEqual(days));
  it('forecastOpensOn says when the first far-off day comes into range', () => {
    expect(forecastOpensOn('2026-12-16')).toBe('2026-12-01');
    expect(planDays(['2026-12-16'], forecastOpensOn('2026-12-16')).forecast).toEqual(['2026-12-16']);
    expect(planDays(['2026-12-16'], addDays(forecastOpensOn('2026-12-16'), -1)).typical).toEqual(['2026-12-16']);
  });
});

describe('request URLs', () => {
  it('forecast asks for °F, mph, the wedding timezone and the exact dates', () => {
    const u = new URL(forecastUrl(cfg, '2026-12-16', '2026-12-19', TZ));
    expect(u.origin + u.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(u.searchParams.get('latitude')).toBe('33.53');
    expect(u.searchParams.get('longitude')).toBe('-111.93');
    expect(u.searchParams.get('temperature_unit')).toBe('fahrenheit');
    expect(u.searchParams.get('wind_speed_unit')).toBe('mph');
    expect(u.searchParams.get('timezone')).toBe(TZ);
    expect(u.searchParams.get('start_date')).toBe('2026-12-16');
    expect(u.searchParams.get('end_date')).toBe('2026-12-19');
    expect(u.searchParams.get('daily')).toContain('precipitation_probability_max');
    expect(u.searchParams.get('hourly')).toContain('temperature_2m');
  });
  it('archive asks for the daily fields the averages need', () => {
    const u = new URL(archiveUrl(cfg, '2025-12-15', '2025-12-21', TZ));
    expect(u.origin).toBe('https://archive-api.open-meteo.com');
    expect(u.searchParams.get('daily')).toBe('temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code');
  });
  it('typicalRequests: one request per past year, each padded by a day', () => {
    const urls = typicalRequests(['2026-12-16', '2026-12-19'], cfg, TZ).map((x) => new URL(x));
    expect(urls).toHaveLength(TYPICAL_YEARS);
    expect(urls[0].searchParams.get('start_date')).toBe('2018-12-15');
    expect(urls[0].searchParams.get('end_date')).toBe('2018-12-20');
    expect(urls[TYPICAL_YEARS - 1].searchParams.get('start_date')).toBe('2025-12-15');
  });
  it('typicalRequests handles a window crossing New Year', () => {
    const urls = typicalRequests(['2027-01-01'], cfg, TZ).map((x) => new URL(x));
    expect(urls[TYPICAL_YEARS - 1].searchParams.get('start_date')).toBe('2025-12-31');
    expect(urls[TYPICAL_YEARS - 1].searchParams.get('end_date')).toBe('2026-01-02');
  });
  it('typicalRequests is empty with no days', () => expect(typicalRequests([], cfg, TZ)).toEqual([]));
  it('nwsUrl', () => expect(nwsUrl(cfg)).toBe('https://forecast.weather.gov/MapClick.php?lat=33.53&lon=-111.93'));
});

const forecastJson = {
  daily: {
    time: ['2026-12-18', '2026-12-19'],
    temperature_2m_max: [68.4, 71.6],
    temperature_2m_min: [44.2, 47.5],
    weather_code: [1, 61],
    precipitation_probability_max: [5, 60],
    sunrise: ['2026-12-18T07:22', '2026-12-19T07:22'],
    sunset: ['2026-12-18T17:24', '2026-12-19T17:25'],
    wind_speed_10m_max: [8.4, 14.6],
  },
  hourly: {
    time: ['2026-12-18T17:00', '2026-12-18T18:00', '2026-12-19T09:00', '2026-12-19T18:00'],
    temperature_2m: [60.2, 56.7, 55.1, 58.9],
    weather_code: [0, 1, 2, 61],
  },
};

describe('parseForecast', () => {
  const days = parseForecast(forecastJson, ['2026-12-18', '2026-12-19']);
  it('reads and rounds the daily numbers', () => {
    expect(days[0]).toMatchObject({ date: '2026-12-18', kind: 'forecast', high: 68, low: 44, precipChance: 5, code: 1, wind: 8, sunrise: '07:22', sunset: '17:24' });
    expect(days[1]).toMatchObject({ high: 72, low: 48, precipChance: 60, code: 61, wind: 15 });
  });
  it('attaches each day\'s own hourly temperatures', () => {
    expect(days[0].hours).toEqual([{ time: '2026-12-18T17:00', temp: 60, code: 0 }, { time: '2026-12-18T18:00', temp: 57, code: 1 }]);
    expect(days[1].hours!.map((h) => h.time.slice(11))).toEqual(['09:00', '18:00']);
  });
  it('returns only the wanted days', () => expect(parseForecast(forecastJson, ['2026-12-19']).map((d) => d.date)).toEqual(['2026-12-19']));
  it('skips days the API did not return', () => expect(parseForecast(forecastJson, ['2026-12-25'])).toEqual([]));
  it('drops days with missing temperatures', () => {
    const bad = { ...forecastJson, daily: { ...forecastJson.daily, temperature_2m_max: [null, 70] } };
    expect(parseForecast(bad, ['2026-12-18', '2026-12-19']).map((d) => d.date)).toEqual(['2026-12-19']);
  });
  it('tolerates missing optional fields', () => {
    const [d] = parseForecast({ daily: { time: ['2026-12-18'], temperature_2m_max: [70], temperature_2m_min: [50] } }, ['2026-12-18']);
    expect(d).toMatchObject({ high: 70, low: 50, precipChance: null, code: null, wind: null, hours: [] });
    expect(d.sunrise).toBeUndefined();
  });
  it.each([null, undefined, {}, { daily: null }, 'nope', 42])('garbage input %j -> no days', (bad) => expect(parseForecast(bad, ['2026-12-18'])).toEqual([]));
});

describe('typical weather from past years', () => {
  const rows: ArchiveRow[] = [];
  for (let y = 2018; y <= 2025; y++)
    for (const d of ['12-15', '12-16', '12-17']) rows.push({ date: `${y}-${d}`, high: 60 + (y - 2018), low: 40, precip: y === 2019 ? 5 : 0, code: y % 2 ? 0 : 3 });
  it('parseArchive keeps rows with temperatures', () => {
    const r = parseArchive({ daily: { time: ['2025-12-16', '2025-12-17'], temperature_2m_max: [65, null], temperature_2m_min: [45, 44], precipitation_sum: [0.4, 0], weather_code: [3, 0] } });
    expect(r).toEqual([{ date: '2025-12-16', high: 65, low: 45, precip: 0.4, code: 3 }]);
  });
  it('averages highs/lows across years and the +-1 day window', () => {
    const [d] = typicalFromRows(['2026-12-16'], rows);
    expect(d.kind).toBe('typical');
    expect(d.high).toBe(64); // mean of 60..67 = 63.5 -> 64
    expect(d.low).toBe(40);
  });
  it('rain chance is the share of sampled days with measurable rain', () => {
    const [d] = typicalFromRows(['2026-12-16'], rows);
    expect(d.precipChance).toBe(13); // 3 of 24 sampled days (one wet year x 3 days)
  });
  it('picks the most common weather code', () => {
    const skewed = rows.map((r) => ({ ...r, code: 2 }));
    expect(typicalFromRows(['2026-12-16'], skewed)[0].code).toBe(2);
  });
  it('ignores rows outside the window and returns nothing without data', () => {
    expect(typicalFromRows(['2026-12-20'], rows)).toEqual([]);
    expect(typicalFromRows(['2026-12-16'], [])).toEqual([]);
  });
  it('treats missing precipitation as unknown, not zero', () => {
    const noPrecip = rows.map((r) => ({ ...r, precip: null }));
    expect(typicalFromRows(['2026-12-16'], noPrecip)[0].precipChance).toBeNull();
  });
  it('handles a window crossing New Year', () => {
    const r = [{ date: '2024-12-31', high: 60, low: 40, precip: 0, code: 0 }, { date: '2025-01-01', high: 62, low: 42, precip: 0, code: 0 }];
    expect(typicalFromRows(['2027-01-01'], r)[0].high).toBe(61);
  });
});

describe('presentation helpers', () => {
  it.each([[0, 'Clear'], [1, 'Mostly clear'], [2, 'Partly cloudy'], [3, 'Overcast'], [45, 'Fog'], [53, 'Drizzle'], [63, 'Rain'], [73, 'Snow'], [81, 'Rain showers'], [86, 'Snow showers'], [95, 'Thunderstorms'], [99, 'Thunderstorms with hail'], [null, 'Conditions unavailable'], [123, 'Mixed conditions']])(
    'code %s -> %s', (code, label) => expect(weatherCodeInfo(code as number | null).label).toBe(label));
  it('every code has an icon', () => {
    for (const c of [0, 1, 2, 3, 45, 51, 61, 71, 80, 85, 95, 96, null]) expect(weatherCodeInfo(c).icon).toBeTruthy();
  });
  it.each([['17:24', '5:24 PM'], ['00:05', '12:05 AM'], ['12:00', '12:00 PM'], ['07:22', '7:22 AM'], ['23:59', '11:59 PM']])('clock12(%s)=%s', (a, b) => expect(clock12(a)).toBe(b));

  const day = (over: Partial<DayWeather> = {}): DayWeather => ({ date: '2026-12-19', kind: 'forecast', high: 70, low: 48, precipChance: 10, code: 0, ...over });
  it('tempAtEvent finds the hour the event starts, in the wedding timezone', () => {
    const d = day({ hours: forecastHours() });
    expect(tempAtEvent(d, '2026-12-19T18:00:00-07:00', TZ)).toMatchObject({ temp: 58 });
    expect(tempAtEvent(d, '2026-12-20T01:00:00Z', TZ)).toMatchObject({ temp: 58 }); // same instant, other offset
    expect(tempAtEvent(d, '2026-12-19T03:00:00-07:00', TZ)).toBeNull();
    expect(tempAtEvent(day(), '2026-12-19T18:00:00-07:00', TZ)).toBeNull();
  });
  function forecastHours() {
    return [{ time: '2026-12-19T09:00', temp: 55, code: 0 }, { time: '2026-12-19T18:00', temp: 58, code: 1 }];
  }
  it('tips: cool evening, heat, rain', () => {
    expect(tipsFor(day({ low: 48 })).join(' ')).toMatch(/wrap or jacket/);
    expect(tipsFor(day({ high: 90, low: 70 })).join(' ')).toMatch(/water/);
    expect(tipsFor(day({ high: 60, low: 60, precipChance: 70 })).join(' ')).toMatch(/umbrella/);
    expect(tipsFor(day({ high: 65, low: 60, precipChance: 10 }))).toEqual([]);
  });
  it('typical days phrase tips as "usually"/"possible"', () => {
    expect(tipsFor(day({ kind: 'typical', low: 45 })).join(' ')).toMatch(/usually/);
    expect(tipsFor(day({ kind: 'typical', low: 60, precipChance: 45 })).join(' ')).toMatch(/possible/);
  });
});
