import type { EventInfo } from './types';

function details(e: Pick<EventInfo, 'dressCode' | 'description'>): string {
  return [e.dressCode ? `Dress code: ${e.dressCode}.` : '', e.description].filter(Boolean).join(' ');
}

export function googleMapsUrl(e: Pick<EventInfo, 'venue' | 'address'>): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${e.venue}, ${e.address}`)}`;
}

export function appleMapsUrl(e: Pick<EventInfo, 'venue' | 'address'>): string {
  return `https://maps.apple.com/?q=${encodeURIComponent(`${e.venue}, ${e.address}`)}`;
}

function icsDate(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** RFC 5545 line folding: max 75 octets per line, continuation lines start with a space. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = '';
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) {
      parts.push(cur);
      cur = '';
      curBytes = 0;
      limit = 74;
    }
    cur += ch;
    curBytes += b;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

export function buildIcs(events: EventInfo[], calName: string, stamp = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Wedding Weekend//Guest App//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsEscape(calName)}`,
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@wedding-weekend`,
      `DTSTAMP:${icsDate(stamp.toISOString())}`,
      `DTSTART:${icsDate(e.start)}`,
      `DTEND:${icsDate(e.end)}`,
      `SUMMARY:${icsEscape(e.name)}`,
      `LOCATION:${icsEscape(`${e.venue}, ${e.address}`)}`,
      `DESCRIPTION:${icsEscape(details(e))}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

export function googleCalendarUrl(e: EventInfo): string {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.name,
    dates: `${icsDate(e.start)}/${icsDate(e.end)}`,
    location: `${e.venue}, ${e.address}`,
    details: details(e),
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
