import { readFileSync } from 'node:fs';
import { normalizeName } from '../src/core/matching';
import { sortEvents } from '../src/core/time';
import type { GuestPayload, PublishedData } from '../src/core/types';

export const sample = (): PublishedData =>
  JSON.parse(readFileSync(new URL('../data/published.sample.json', import.meta.url), 'utf8'));

/** What one unlocked household sees, built directly from the data (for UI tests). */
export function payloadFor(name: string, data = sample()): GuestPayload {
  const g = data.guests.find((x) => normalizeName(x.name) === normalizeName(name) || x.aliases.some((a) => normalizeName(a) === normalizeName(name)));
  if (!g) throw new Error(`no guest ${name}`);
  const household = data.guests.filter((x) => x.householdId === g.householdId);
  const ids = new Set(household.flatMap((x) => x.invited));
  return {
    guestName: g.name,
    householdNames: household.map((x) => x.name),
    events: sortEvents(data.events.filter((e) => ids.has(e.id))),
    content: data.content,
  };
}
