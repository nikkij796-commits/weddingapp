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
}

export interface Guest {
  id: string;
  name: string;
  aliases: string[];
  householdId: string;
  /** ids of events this guest is invited to */
  invited: string[];
}

export interface InfoItem {
  title: string;
  body: string;
  url?: string;
}

export interface Content {
  coupleNames: string;
  tagline: string;
  timezone: string;
  welcome: string;
  travel: InfoItem[];
  lodging: InfoItem[];
  faq: { q: string; a: string }[];
  contact: { label: string; detail: string };
  updates: { id: string; at: string; message: string }[];
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
