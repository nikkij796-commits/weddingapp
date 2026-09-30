export interface EventInfo {
  id: string;
  name: string;
  /** ISO 8601 with UTC offset, e.g. 2027-06-11T17:30:00-04:00 */
  start: string;
  end: string;
  venue: string;
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

export interface Content {
  coupleNames: string;
  tagline: string;
  timezone: string;
  welcome: string;
  faq: { q: string; a: string }[];
  contact: { label: string; detail: string };
  updates: { id: string; at: string; message: string }[];
  /** Virtual wedding program. Empty sections show a "coming soon" placeholder. */
  program: { intro: string; sections: { title: string; body: string }[] };
  /** Meals are tied to events, so times and places come from the event and only invited guests see them. */
  meals: { intro: string; items: { eventId: string; label: string; time?: string; menu?: string; notes?: string }[] };
  rides: { intro: string; steps: string[]; voucher: { code: string; note: string }; tips: string[] };
  /** Hotel / resort map: an embedded map of the first place, an optional property map image, and a list of places. */
  map: { intro: string; imagePath?: string; imageAlt?: string; places: { name: string; address: string; note?: string }[] };
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
}
