export interface EventInfo {
  id: string;
  name: string;
  /** ISO 8601 with UTC offset, e.g. 2027-06-11T17:30:00-04:00 */
  start: string;
  end: string;
  venue: string;
  /** Where on the property, e.g. "Sonoran Lawn" or "Grand Ballroom". Shown on the event and the property map page. */
  area?: string;
  address: string;
  dressCode: string;
  dressNotes: string;
  description: string;
  /** Optional run-of-show lines shown on the card, e.g. { time: "9:00 AM", label: "Baraat" }. */
  moments?: { time: string; label: string }[];
  /** Date is known but the time isn't: shown as "Time to be announced", no calendar buttons, no countdown. */
  timeTbd?: boolean;
  /** Publish-time rule: every guest is invited (used for events with no column in the guest sheet). */
  everyone?: boolean;
}

export interface Guest {
  id: string;
  name: string;
  aliases: string[];
  householdId: string;
  /** ids of events this guest is invited to */
  invited: string[];
}

/**
 * One meal or snack on the Meals page. It is shown either to everyone invited to `eventId`, or (with `date`,
 * YYYY-MM-DD) to anyone who has an event that day. Only names, times, places and dietary labels are
 * published: never menus.
 */
export interface MealItem {
  eventId?: string;
  date?: string;
  label: string;
  /** Local times, HH:MM (24h). Used for ordering and display. */
  start?: string;
  end?: string;
  /** Free text that replaces the time, e.g. "During Haldi" or "Afternoon". */
  time?: string;
  /** Where, if different from the event's own place. */
  place?: string;
  /** 'full' = every dish is Jain; 'options' = Jain dishes are available. */
  jain?: 'full' | 'options';
  notes?: string;
}

export interface Content {
  coupleNames: string;
  /** Name of an encrypted image in the vault (img/<name>.json) shown at the top of the guide, e.g. the invitation cover. */
  coverImage?: string;
  tagline: string;
  timezone: string;
  welcome: string;
  faq: { q: string; a: string }[];
  contact: { label: string; detail: string };
  updates: { id: string; at: string; message: string }[];
  /** Virtual wedding program. Empty sections show a "coming soon" placeholder. */
  program: { intro: string; sections: { title: string; body: string }[] };
  /** Meals are tied to events, so times and places come from the event and only invited guests see them. */
  meals: { intro: string; items: MealItem[] };
  rides: { intro: string; steps: string[]; voucher: { code: string; note: string }; tips: string[] };
  /** Hotel / resort map: an embedded map of the first place, an optional property map image, and a list of places. */
  map: {
    intro: string;
    imagePath?: string;
    imageAlt?: string;
    /** Where each lettered spot sits on the map image, in percent of its width/height. Events whose area says "(D)" get a pin there. */
    spots?: { letter: string; x: number; y: number }[];
    places: { name: string; address: string; note?: string }[] };
  /** Where to get the live weather from. Null hides the forecast and shows "coming soon". */
  weather: { place: string; latitude: number; longitude: number } | null;
}

/** Server-side only. Never shipped to the browser bundle. */
export interface PublishedData {
  code: string;
  events: EventInfo[];
  guests: Guest[];
  content: Content;
}

/** What one unlocked household is allowed to see. */
export interface GuestPayload {
  guestName: string;
  householdNames: string[];
  events: EventInfo[];
  content: Content;
  /** The decrypted cover image (data: URL), fetched at unlock when content.coverImage is set. */
  cover?: string;
}
