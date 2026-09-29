# Wedding Weekend Guest App

Mobile-first, installable (PWA) guest site. Guests enter their **name + wedding code** and see only the events they are invited to.

## Commands
| Command | What it does |
| --- | --- |
| `npm run dev` | Local dev server (uses `data/published.json`, else the sample data) |
| `npm test` | Unit tests (matching, unlock, privacy sanitizer, time, calendar, rendering, publish CLI) |
| `npm run e2e` | Browser tests at iPhone, small Android and desktop sizes |
| `npm run build && npm run scan:bundle` | Production build, then fail if any guest name, code, venue or private term is in the client bundle |
| `WEDDING_CODE=xxxx npm run publish:data` | Build guest-safe `data/published.json` from `data/raw/` |

## Updating content (publish step)
1. Export from Drive into `data/raw/`: `guests.csv`, `events.json`, `content.json`, and optionally `aliases.json` (see `data/published.sample.json` for shapes).
   - Guest sheet: either one guest per row (`Name`, `Aliases`, `Household`) or one household per row (`Guest 1 name` ... `Guest N name`), then one TRUE/FALSE or Yes/No column per event (header = event id or name). Everyone on a row shares an itinerary. Email, phone, hotel, RSVP odds, notes and every other column are ignored and never published.
   - Events with `"everyone": true` are given to every guest (no sheet column needed). Events with `"timeTbd": true` show "Time to be announced" with no calendar buttons or countdown. An empty `dressCode` hides the attire line.
   - `aliases.json` maps a name exactly as written in the sheet to extra names a guest may type, e.g. `{ "Ms. Nikita Jain": ["Nikki Jain"] }`.
2. Run `WEDDING_CODE=<code> npm run publish:data`. It is **blocked** if copy mentions budget, contract, vendor, invoice, deposit, payment, large dollar amounts, etc.
3. Deploy.

## Privacy model
- If the same name appears in more than one party, guests who enter the correct code are asked to **select their party**. Near-miss typos never trigger this, so it can't be used to probe the list.
- The guest list never ships to the browser. `POST /api/unlock` (`src/server/unlock.ts`) checks the code first, matches the name, and returns only that household's events plus shared content. Failures return one identical message, and repeated failures are rate limited.
- Only allowlisted fields are ever published (`src/core/sanitize.ts`).
- `functions/api/unlock.ts` is a Cloudflare Pages Function wrapper. Any host that can run a small server function works.

## Later: downloadable app
The site is a standard PWA, so it can be wrapped with Capacitor for App Store / Play Store builds.
