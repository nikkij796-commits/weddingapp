/**
 * Turns the raw exports from Drive into guest-safe data/published.json.
 *
 *   data/raw/guests.csv    Guest sheet exported from Drive (Name, Aliases, Household, one Yes/No column per event)
 *   data/raw/events.json   Events from the invitation
 *   data/raw/content.json  Welcome text, travel, lodging, FAQ, updates
 *   data/raw/cover.jpg     Optional: shown at the top of the guide (encrypted; only unlocked guests can see it)
 *   WEDDING_CODE           The code printed on the invitation (env var)
 *
 * It then encrypts everything guests may see into public/vault, which is safe to commit and deploy.
 * Any private-sounding language or malformed data blocks the publish.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PublishError, buildPublished } from '../src/core/sanitize';
import { writeVault } from './vault-io';

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
    aliases: existsSync(raw('aliases.json')) ? JSON.parse(readFileSync(raw('aliases.json'), 'utf8')) : {},
    onWarn: (m) => console.warn(`WARNING: ${m}`),
  });
  const images: Record<string, string> = {};
  if (existsSync(raw('cover.jpg'))) {
    images.cover = `data:image/jpeg;base64,${readFileSync(raw('cover.jpg')).toString('base64')}`;
    data.content.coverImage = 'cover';
  }
  writeFileSync('data/published.json', JSON.stringify(data, null, 2));
  console.log(`Published ${data.events.length} events and ${data.guests.length} guests -> data/published.json`);
  const n = await writeVault(data, data.code, 'public/vault', undefined, images);
  console.log(`Encrypted vault: ${n} files -> public/vault (commit this folder; it is ciphertext only)`);
} catch (e) {
  console.error(e instanceof PublishError ? e.message : e);
  process.exit(1);
}
