import { pickContent, pickEvents } from './content';
import type { GuestPayload } from './types';

/** Only plain base64 image data URLs are kept, so a saved copy can never inject markup or load another site. */
export const isImageDataUrl = (v: unknown): v is string => typeof v === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v);

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function validTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Makes any saved or downloaded copy of a guest's data safe to render.
 * A copy saved by an older version of the app may lack newer fields (program, meals, rides, map,
 * weather...); those are filled with empty defaults so pages show "Coming soon" instead of crashing.
 * Returns null when the data is unusable (not an object, or no valid timezone), so the guest is
 * asked to sign in again rather than shown a broken page.
 */
export function normalizePayload(raw: unknown): GuestPayload | null {
  if (!isObject(raw) || !isObject(raw.content) || !validTimezone(raw.content.timezone)) return null;
  const events = pickEvents(Array.isArray(raw.events) ? raw.events.filter(isObject) : []).filter((e) => e.id && e.name && e.start && e.end);
  return {
    guestName: typeof raw.guestName === 'string' ? raw.guestName : '',
    householdNames: Array.isArray(raw.householdNames) ? raw.householdNames.filter((n): n is string => typeof n === 'string') : [],
    events,
    content: pickContent(raw.content),
    ...(isImageDataUrl(raw.cover) ? { cover: raw.cover } : {}),
  };
}
