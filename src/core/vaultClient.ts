import { unlockVault, type Fetcher, type Outcome } from './vault';

/** Fetches vault files from the site itself. A missing file (or the dev server's HTML fallback) is null. */
export const httpFetcher: Fetcher = async (path) => {
  const res = await fetch(`${import.meta.env.BASE_URL}vault/${path}`, { cache: 'no-cache' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Guest data request failed (${res.status})`);
  const text = await res.text();
  return text.trimStart().startsWith('<') ? null : text;
};

export const unlock = (name: string, code: string): Promise<Outcome> => unlockVault(httpFetcher, name, code);

/** There is no server to lock guessers out, so slow repeated wrong attempts down instead. */
export function failureDelayMs(consecutiveFailures: number): number {
  return consecutiveFailures < 3 ? 0 : Math.min(8000, 1000 * 2 ** (consecutiveFailures - 3));
}
