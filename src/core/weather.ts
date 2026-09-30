/**
 * Weather for the wedding days. Pure functions only (no network), so everything is unit-testable.
 * Data comes from Open-Meteo (free, no key, CORS enabled):
 *   - forecast API for days up to 15 days from today (also serves the recent past)
 *   - historical archive for "typical" weather on days beyond the forecast window
 */
import type { EventInfo } from './types';

export interface WeatherConfig {
  place: string;
  latitude: number;
  longitude: number;
}

export interface HourTemp {
  /** Local time, e.g. 2026-12-19T18:00 */
  time: string;
  temp: number;
  code: number | null;
}

export interface DayWeather {
  date: string; // YYYY-MM-DD in the wedding timezone
  kind: 'forecast' | 'typical';
  high: number;
  low: number;
  /** Percent. For "typical" days: share of past years' days with measurable rain. */
  precipChance: number | null;
  code: number | null;
  sunrise?: string; // HH:MM
  sunset?: string;
  wind?: number | null; // mph
  hours?: HourTemp[];
}

/** The forecast API reaches this many days past today. */
export const FORECAST_HORIZON_DAYS = 15;
/** How many past years feed the "typical weather" averages. */
export const TYPICAL_YEARS = 8;

// ---------- dates ----------

export function ymdInTimezone(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Distinct days (in the wedding timezone) that have at least one of the guest's events. */
export function eventDays(events: EventInfo[], tz: string): string[] {
  return [...new Set(events.map((e) => ymdInTimezone(new Date(e.start), tz)))].sort();
}

export interface Plan {
  forecast: string[];
  typical: string[];
}

/** Days the forecast can cover vs. days that are still too far out. */
export function planDays(days: string[], todayYmd: string): Plan {
  const last = addDays(todayYmd, FORECAST_HORIZON_DAYS);
  return { forecast: days.filter((d) => d <= last), typical: days.filter((d) => d > last) };
}

/** First date on which the forecast will reach `day`. */
export function forecastOpensOn(day: string): string {
  return addDays(day, -FORECAST_HORIZON_DAYS);
}

// ---------- request URLs ----------

const DAILY = 'temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,sunrise,sunset,wind_speed_10m_max';
const HOURLY = 'temperature_2m,weather_code';

export function forecastUrl(cfg: WeatherConfig, start: string, end: string, tz: string): string {
  const p = new URLSearchParams({
    latitude: String(cfg.latitude),
    longitude: String(cfg.longitude),
    daily: DAILY,
    hourly: HOURLY,
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: tz,
    start_date: start,
    end_date: end,
  });
  return `https://api.open-meteo.com/v1/forecast?${p.toString()}`;
}

export function archiveUrl(cfg: WeatherConfig, start: string, end: string, tz: string): string {
  const p = new URLSearchParams({
    latitude: String(cfg.latitude),
    longitude: String(cfg.longitude),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code',
    temperature_unit: 'fahrenheit',
    timezone: tz,
    start_date: start,
    end_date: end,
  });
  return `https://archive-api.open-meteo.com/v1/archive?${p.toString()}`;
}

/** The same calendar day `yearsBack` years earlier (Feb 29 becomes Feb 28). */
export function sameDayYearsBack(ymd: string, yearsBack: number): string {
  const mmdd = ymd.slice(5) === '02-29' ? '02-28' : ymd.slice(5);
  return `${Number(ymd.slice(0, 4)) - yearsBack}-${mmdd}`;
}

/** One archive request per past year, each covering the wanted days plus one day either side. */
export function typicalRequests(days: string[], cfg: WeatherConfig, tz: string): string[] {
  if (!days.length) return [];
  const first = addDays(days[0], -1);
  const last = addDays(days[days.length - 1], 1);
  const urls: string[] = [];
  for (let k = TYPICAL_YEARS; k >= 1; k--) urls.push(archiveUrl(cfg, sameDayYearsBack(first, k), sameDayYearsBack(last, k), tz));
  return urls;
}

// ---------- parsing ----------

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const hhmm = (iso: unknown): string | undefined => (typeof iso === 'string' && /T\d\d:\d\d/.test(iso) ? iso.slice(11, 16) : undefined);

/** Parses a forecast response into the requested days. Days with missing temperatures are dropped. */
export function parseForecast(json: any, wanted: string[]): DayWeather[] {
  const d = json?.daily;
  if (!d) return [];
  const times = arr(d.time) as string[];
  const hourlyTimes = arr(json?.hourly?.time) as string[];
  const out: DayWeather[] = [];
  for (const day of wanted) {
    const i = times.indexOf(day);
    if (i < 0) continue;
    const high = num(arr(d.temperature_2m_max)[i]);
    const low = num(arr(d.temperature_2m_min)[i]);
    if (high == null || low == null) continue;
    const hours: HourTemp[] = [];
    hourlyTimes.forEach((t, hi) => {
      const temp = num(arr(json.hourly.temperature_2m)[hi]);
      if (t.startsWith(day) && temp != null) hours.push({ time: t, temp: Math.round(temp), code: num(arr(json.hourly.weather_code)[hi]) });
    });
    out.push({
      date: day,
      kind: 'forecast',
      high: Math.round(high),
      low: Math.round(low),
      precipChance: num(arr(d.precipitation_probability_max)[i]),
      code: num(arr(d.weather_code)[i]),
      sunrise: hhmm(arr(d.sunrise)[i]),
      sunset: hhmm(arr(d.sunset)[i]),
      wind: num(arr(d.wind_speed_10m_max)[i]) == null ? null : Math.round(num(arr(d.wind_speed_10m_max)[i])!),
      hours,
    });
  }
  return out;
}

export interface ArchiveRow {
  date: string;
  high: number;
  low: number;
  precip: number | null; // mm
  code: number | null;
}

export function parseArchive(json: any): ArchiveRow[] {
  const d = json?.daily;
  if (!d) return [];
  const rows: ArchiveRow[] = [];
  (arr(d.time) as string[]).forEach((date, i) => {
    const high = num(arr(d.temperature_2m_max)[i]);
    const low = num(arr(d.temperature_2m_min)[i]);
    if (high == null || low == null) return;
    rows.push({ date, high, low, precip: num(arr(d.precipitation_sum)[i]), code: num(arr(d.weather_code)[i]) });
  });
  return rows;
}

const mmdd = (ymd: string) => ymd.slice(5);

/** Average of past years' rows within one day either side of each wanted day. */
export function typicalFromRows(days: string[], rows: ArchiveRow[]): DayWeather[] {
  const out: DayWeather[] = [];
  for (const day of days) {
    const near = new Set([addDays(day, -1), day, addDays(day, 1)].map(mmdd));
    const sample = rows.filter((r) => near.has(mmdd(r.date)));
    if (!sample.length) continue;
    const avg = (f: (r: ArchiveRow) => number) => Math.round(sample.reduce((s, r) => s + f(r), 0) / sample.length);
    const withPrecip = sample.filter((r) => r.precip != null);
    const codes = new Map<number, number>();
    for (const r of sample) if (r.code != null) codes.set(r.code, (codes.get(r.code) ?? 0) + 1);
    const top = [...codes.entries()].sort((a, b) => b[1] - a[1])[0];
    out.push({
      date: day,
      kind: 'typical',
      high: avg((r) => r.high),
      low: avg((r) => r.low),
      precipChance: withPrecip.length ? Math.round((withPrecip.filter((r) => r.precip! >= 0.1).length / withPrecip.length) * 100) : null,
      code: top ? top[0] : null,
    });
  }
  return out;
}

// ---------- presentation helpers ----------

/** WMO weather codes as used by Open-Meteo. */
export function weatherCodeInfo(code: number | null): { label: string; icon: string } {
  if (code == null) return { label: 'Conditions unavailable', icon: '🌡️' };
  if (code === 0) return { label: 'Clear', icon: '☀️' };
  if (code === 1) return { label: 'Mostly clear', icon: '🌤️' };
  if (code === 2) return { label: 'Partly cloudy', icon: '⛅' };
  if (code === 3) return { label: 'Overcast', icon: '☁️' };
  if (code === 45 || code === 48) return { label: 'Fog', icon: '🌫️' };
  if (code >= 51 && code <= 57) return { label: 'Drizzle', icon: '🌦️' };
  if (code >= 61 && code <= 67) return { label: 'Rain', icon: '🌧️' };
  if (code >= 71 && code <= 77) return { label: 'Snow', icon: '❄️' };
  if (code >= 80 && code <= 82) return { label: 'Rain showers', icon: '🌦️' };
  if (code === 85 || code === 86) return { label: 'Snow showers', icon: '❄️' };
  if (code === 95) return { label: 'Thunderstorms', icon: '⛈️' };
  if (code === 96 || code === 99) return { label: 'Thunderstorms with hail', icon: '⛈️' };
  return { label: 'Mixed conditions', icon: '🌡️' };
}

/** Temperature at the hour an event starts (forecast days only). */
export function tempAtEvent(day: DayWeather, eventStartIso: string, tz: string): HourTemp | null {
  if (!day.hours?.length) return null;
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date(eventStartIso)).slice(0, 2);
  return day.hours.find((h) => h.time.slice(11, 13) === hour) ?? null;
}

/** Plain-language packing hints derived from the numbers. */
export function tipsFor(day: DayWeather): string[] {
  const tips: string[] = [];
  const typical = day.kind === 'typical';
  if (day.low <= 55) tips.push(typical ? 'Evenings are usually cool: bring a wrap or jacket.' : 'Cool evening: bring a wrap or jacket.');
  if (day.high >= 85) tips.push('Hot afternoon: sunscreen, sunglasses and water.');
  else if (day.high >= 75 && day.kind === 'forecast') tips.push('Warm afternoon: sunscreen and sunglasses help.');
  if ((day.precipChance ?? 0) >= 40) tips.push(typical ? 'Rain is possible on these dates: have an umbrella handy.' : 'Rain is likely: bring an umbrella.');
  return tips;
}

/** "5:24 PM" from "17:24". */
export function clock12(hhmmStr: string): string {
  const [h, m] = hhmmStr.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Official fallback so guests always have somewhere to look. */
export function nwsUrl(cfg: WeatherConfig): string {
  return `https://forecast.weather.gov/MapClick.php?lat=${cfg.latitude}&lon=${cfg.longitude}`;
}

/** "Saturday, December 19" from "2026-12-19" (no timezone maths: the date is already local). */
export function formatYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}
