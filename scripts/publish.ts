/**
 * Turns the raw exports from Drive into guest-safe data/published.json.
 *
 *   data/raw/guests.csv    Guest sheet exported from Drive (Name, Aliases, Household, one Yes/No column per event)
 *   data/raw/events.json   Events from the invitation
 *   data/raw/content.json  Welcome text, travel, lodging, FAQ, updates
 *   WEDDING_CODE           The code printed on the invitation (env var)
 *
 * Any private-sounding language or malformed data blocks the publish.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PublishError, buildPublished } from '../src/core/sanitize';

const raw = (f: string) => `data/raw/${f}`;
const missing = ['guests.csv', 'events.json', 'content.json'].filter((f) => !existsSync(raw(f)));
if (missing.length || !process.env.WEDDING_CODE) {
  console.error(
    `Cannot publish.${missing.length ? `\n Missing: ${missing.map(raw).join(', ')}` : ''}${
      process.env.WEDDING_CODE ? '' : '\n Set WEDDING_CODE=<code on the invitation>'
    }`,
  );
  process.exit(1);
}

try {
  const data = buildPublished({
    code: process.env.WEDDING_CODE,
    events: JSON.parse(readFileSync(raw('events.json'), 'utf8')),
    content: JSON.parse(readFileSync(raw('content.json'), 'utf8')),
    guestsCsv: readFileSync(raw('guests.csv'), 'utf8'),
  });
  writeFileSync('data/published.json', JSON.stringify(data, null, 2));
  console.log(`Published ${data.events.length} events and ${data.guests.length} guests -> data/published.json`);
} catch (e) {
  console.error(e instanceof PublishError ? e.message : e);
  process.exit(1);
}
