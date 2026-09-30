# Wedding Weekend Guest App

Mobile-first, installable (PWA) guest site. Guests enter their **name + wedding code** and see only the events they are invited to.

## Commands
| Command | What it does |
| --- | --- |
| `npm run dev` | Local dev server (uses `data/published.json`, else the sample data) |
| `npm test` | Unit tests (matching, unlock, privacy sanitizer, time, calendar, rendering, publish CLI) |
| `npm run e2e` | Browser tests at iPhone, small Android and desktop sizes, plus a production build under `/weddingapp/` |
| `npm run build:pages && npm run scan:bundle` | Production build for `/weddingapp/`, then fail if anything readable is in the vault or the site |
| `WEDDING_CODE=xxxx npm run publish:data` | Build guest-safe `data/published.json` from `data/raw/`, then encrypt it into `public/vault/` |

## Updating content (publish step)
1. Export from Drive into `data/raw/`: `guests.csv`, `events.json`, `content.json`, and optionally `aliases.json` (see `data/published.sample.json` for shapes).
   - Guest sheet: either one guest per row (`Name`, `Aliases`, `Household`) or one household per row (`Guest 1 name` ... `Guest N name`), then one TRUE/FALSE or Yes/No column per event (header = event id or name). Everyone on a row shares an itinerary. Email, phone, hotel, RSVP odds, notes and every other column are ignored and never published.
   - Events with `"everyone": true` are given to every guest (no sheet column needed). Events with `"timeTbd": true` show "Time to be announced" with no calendar buttons or countdown. An empty `dressCode` hides the attire line. `address` may be empty (shows "Address to be announced", no map or Uber buttons). `area` is where on the property, e.g. `Cholla Lawn (D)`; letters in brackets match the resort map and a caption explains them.
   - `aliases.json` maps a name exactly as written in the sheet to extra names a guest may type, e.g. `{ "Ms. Nikita Jain": ["Nikki Jain"] }`.
2. Run `WEDDING_CODE=<code> npm run publish:data`. It is **blocked** if copy mentions budget, contract, vendor, invoice, deposit, payment, large dollar amounts, etc.
3. Commit `public/vault/` and push (see Hosting).

## Pages and what feeds them
Bottom bar: **Weekend, Program, Meals, Rides, More**. More opens **Weather, Hotel map, FAQ, Updates**. Everything comes from `data/raw/content.json` (plus events) and is optional; an empty section shows a "Coming soon" placeholder.

| Field in `content.json` | Page | Notes |
| --- | --- | --- |
| `program: { intro, sections: [{title, body}] }` | Program | Empty = placeholder. Blank lines in `body` make paragraphs. |
| `meals: { intro, items: [{eventId or date, label, start?, end?, time?, place?, jain?, notes?}] }` | Meals | Names, times, places and dietary labels only (no menus). Use `eventId` to show a meal to everyone invited to that event, or `date` (`YYYY-MM-DD`) to show it to anyone with an event that day. `start`/`end` are local `HH:MM`; `time` is free text that replaces them (e.g. "During Haldi"). `place` overrides the event's place. `jain` is `full` ("Fully Jain") or `options` ("Jain options"). |
| `rides: { intro, steps[], voucher: {code, note}, tips[] }` | Rides | Empty voucher = placeholder. Ride buttons open Uber with the destination filled in (every event venue and every map place). Dollar amounts are allowed here only. |
| `map: { intro, imagePath?, imageAlt?, places: [{name, address, note?}] }` | Hotel map | Embeds a Google map of the first place. The property-map image lives in `public/` (currently `resort-map.jpg`); set `imagePath` to its filename. It scrolls sideways on phones and opens full size on tap. |
| `weather: { place, latitude, longitude }` | Weather | Live from Open-Meteo. Within 15 days: the real forecast, with the temperature at each event's start. Earlier: "typical weather" averaged from the past 8 years, with the date the live forecast starts. Only the guest's own event days are shown. Needs internet; falls back to a saved copy. |

## Hosting: GitHub Pages
The site is static and deploys with `.github/workflows/deploy.yml` on every push to `main` or `claude/wedding-guest-app` (typecheck, unit tests, build, privacy scan, then publish). Live at `https://nikkij796-commits.github.io/weddingapp/`.

One-time setup: GitHub > Settings > Pages > **Source: GitHub Actions**. If the `github-pages` environment restricts branches, allow the deploy branch.

To publish an update: put the new exports in `data/raw/`, run `WEDDING_CODE=<code> npm run publish:data`, commit `public/vault/`, and push. It goes live in about a minute.

## Privacy model
- There is no server. Everything guests can see is published as **ciphertext** in `public/vault/` (safe to commit and deploy). The wedding code is the key: it is stretched with PBKDF2 and used to look up a typed name and to open that one household's file. One household can never read another's.
- Names match forgivingly: case, accents, titles, aliases, middle names, and **one** typo. A first name alone never matches.
- If the same name appears in more than one party, guests who enter the correct code are asked to **select their party**. Near-miss typos never trigger this, so it can't be used to probe the list.
- After signing in, the guest's phone keeps their name, the code and a copy of their guide (60 days), so the guide opens instantly and works offline. Each time the app opens (and when it is reopened after 10+ minutes) it quietly re-downloads the guide with those saved credentials, so announcements, vouchers, menus and app updates arrive without signing in again. A saved copy from an older app version is filled in with empty defaults (never crashes), and if a page ever fails to draw the guest gets a "Refresh my guide" screen. Signing out clears everything. The code is shared with every guest, and nothing else is stored.
- Every failure shows the same message. With no server there is no lockout, so repeated misses are slowed down in the browser instead.
- **The code is the only lock.** The ciphertext is public, so someone could guess codes offline; a longer code makes that impractical. What is protected is guest names and which events each household attends (no emails, phones, hotels or budget are ever included).
- Only allowlisted fields are ever published (`src/core/sanitize.ts`), and the publish is blocked if copy mentions budget, contracts, vendors, etc.
- `npm run scan:bundle` fails the build if any vault file contains readable text, or if any guest name, code or venue appears in the site.
- Later option: a small Cloudflare Worker could restore lockouts without changing the matching code.

## Later: downloadable app
The site is a standard PWA, so it can be wrapped with Capacitor for App Store / Play Store builds.
