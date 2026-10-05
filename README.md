# 早餐被稱讚地圖

A Next.js + PostgreSQL app for finding Taipei breakfast shops and recording the small joy of being called 帥哥、美女、妹妹.

## What it does

- Every visit opens a full-screen Google map with a top search bar, favourites and a map/list toggle. Closing a list returns to the map; the previous view is not restored on reload. The top-left sun logo is removed; there are no settings or language controls.
- Searches when submitted, when a visitor presses the GPS button, or when an empty voting list needs results. The GPS button centers the map on the visitor and automatically loads nearby restaurants as map pins, zooming in to at least level 16. Opening the app, panning, zooming, and typing make no Places calls. Blank searches require zoom 16 or closer; their radius shrinks from 500 metres as the user zooms in. Named searches cover Taipei City.
- Searches two halves of the area for up to 120 unique shops across at most six Text Search pages (three per half). Each page consumes one separate search request; pagination stops when Google has no next page or 120 usable shops are found. Invalid, duplicate or out-of-radius results can leave fewer than 120 shops. A 10-second cooldown and duplicate-submit guard reduce repeated searches.
- The centred **搜尋這個範圍** button shows results as map pins and keeps the map open. The top text search and explicit list toggle can still show a list.
- Voting requires Google login but no GPS or distance check. The voting list reuses loaded search results, or searches around the current map centre when none are loaded. GPS is optional and only requested through the location button.
- Saves favourites on this device using place IDs and user-written nicknames. Recent search terms are also local. Google names, addresses and coordinates are not saved to local storage or PostgreSQL.
- Remembers live results in the current page, so selecting an already-loaded restaurant makes no additional Google call. Opening an unknown favourite or leaderboard entry makes one Place Details request.
- Allows one vote total per Google account per Taipei calendar day. PostgreSQL enforces this across browsers, devices and simultaneous clicks. Signing in never submits a vote automatically.
- Loads the leaderboard only when opened, using the app's own counts and place IDs with zero Google calls. Unknown names appear as ranked entries until selected. Historical entries can include closed shops; opening them checks current details.
- Voting updates the displayed count without searching or refreshing Google data. A short-lived signed receipt lets the server verify the selected restaurant without another Places lookup; voting sends no GPS coordinates.

## Start locally

Requirements: Node.js 20.9+ (a current LTS is recommended), npm, Docker Compose or an existing PostgreSQL instance.

```sh
cd breakfast-compliment-map
npm install
cp .env.example .env.local
docker compose up -d
```

**Apply for your API keys now, before testing real map and restaurant data.** Edit `.env.local` with your keys and database connection, then:

```sh
npm run db:setup
npm run dev
```

Open http://127.0.0.1:3050, matching `BETTER_AUTH_URL`. Missing map settings show a simple temporary-unavailability message. Missing login credentials affect voting only. Setup instructions live only in this README; there is no public setup page. Database setup creates the Better Auth tables and upgrades the vote table while preserving old and demo votes. Stop the local container with `docker compose stop`; do not remove its volume if you need to preserve compliments.

## Google login setup (Better Auth)

Better Auth's open-source library runs inside this app using the existing PostgreSQL database. No Better Auth dashboard, paid infrastructure plan, or separate authentication subscription is required. Hosting, PostgreSQL and Google Maps have their own costs. This app supports Google login only; email/password registration is disabled.

The OAuth credentials below are **different from your Maps API keys**:

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview) in your Google Cloud project. Complete **Branding** and **Audience**. For an external app in Testing mode, add your own Google email under **Test users**. Configure your real homepage, privacy policy and terms when publishing.
2. Under **Clients**, create an **OAuth client ID**, application type **Web application**.
3. Add `http://127.0.0.1:3050` as an authorized JavaScript origin, and add this exact **Authorized redirect URI**: `http://127.0.0.1:3050/api/auth/callback/google`.
4. Copy the client ID and client secret into `.env.local`:

```dotenv
BETTER_AUTH_URL=http://127.0.0.1:3050
BETTER_AUTH_SECRET=your-long-random-secret
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

Generate the secret once with `openssl rand -base64 32` if it is blank. Keep the same secret across restarts and server instances. All four values belong on the server; never add `NEXT_PUBLIC_` to them. Login asks for basic Google profile and email access, not Gmail or Drive permissions. See [Better Auth's Google guide](https://www.better-auth.com/docs/authentication/google).

Run `npm run db:setup`, then restart `npm run dev`. Test with an allowed Google test user: browse without logging in, press **投票**, sign in, select a shop and vote. A second vote at any shop should be blocked until midnight in Taipei. The map remains available if you close the login prompt.

For ngrok or production, set `BETTER_AUTH_URL` to the **exact HTTPS origin you browse**, for example `https://ranged-thong-scored.ngrok-free.dev`, and add `https://ranged-thong-scored.ngrok-free.dev/api/auth/callback/google` as an authorized redirect URI in Google. OAuth redirect URIs do **not** use wildcards. The Maps API key's website restriction separately uses `https://ranged-thong-scored.ngrok-free.dev/*`. Restart after changing server environment variables. Publish the Google consent configuration before letting the public sign in.

### Optional Better Auth dashboard

The app includes the `@better-auth/infra` dashboard plugin. To connect your project, copy its API key from [Better Auth Infrastructure](https://dash.better-auth.com) into the server-only `BETTER_AUTH_API_KEY` variable in `.env.local`. The plugin is enabled only when this key is set; Google login does not require a dashboard key.

For local testing, run `ngrok http 3050`, set `BETTER_AUTH_URL` to your ngrok HTTPS origin, and restart `npm run dev`. In dashboard onboarding, enter the same HTTPS origin as the Base URL and `/api/auth` as the Base Path, then retry the connection. The dashboard can manage auth users and sessions and receive auth activity; keep its API key private. The dashboard key does not replace `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET`.

## Google Cloud setup

For a populated local demo, run `npm run db:demo`. It fetches live restaurant IDs
and adds varied synthetic votes over the previous 30 days. Re-running replaces
only demo votes. Before launch, run `npm run db:demo -- --clear` to remove them;
real votes are preserved. The script refuses remote databases.

1. Create a [Google Cloud project](https://console.cloud.google.com/google/maps-apis/overview) and attach a billing account.
2. Enable **Maps JavaScript API** and **Places API (New)**.
3. Create two separate API keys:

| Environment variable                   | Where used                       | Restrictions                                                                                                                                                                                                             |
| -------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`      | Browser                          | Restrict API to Maps JavaScript API; use website restrictions for `http://localhost:3050/*`, `http://127.0.0.1:3050/*`, and your eventual HTTPS domain. This key is intentionally visible to browsers.                   |
| `GOOGLE_PLACES_API_KEY`                | Next.js server and import script | Restrict API to Places API (New). Restrict to your server's outbound IP when it has a stable IP. Website/referrer restrictions do **not** work for server-side calls. Never expose this key using a `NEXT_PUBLIC_` name. |
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`       | Browser                          | `DEMO_MAP_ID` works for development. Create a JavaScript map ID in Google Maps Management for production. A map ID is not an API key.                                                                                    |
| `DATABASE_URL`                         | Next.js server and scripts       | PostgreSQL connection string. Local Compose uses port **55432**, database `breakfast`. For hosted PostgreSQL, follow your provider's TLS requirements; do not disable certificate verification.                          |
| `MAX_GOOGLE_MAP_LOADS_PER_MONTH`       | Server                           | Default 10,000 map reservations per Google billing month. Set 0 to stop new maps.                                                                                                                                        |
| `MAX_GOOGLE_PLACES_SEARCHES_PER_MONTH` | Server and scripts               | Default 5,000 Text Search requests per Google billing month. Set 0 to stop searches.                                                                                                                                     |
| `MAX_GOOGLE_PLACES_DETAILS_PER_MONTH`  | Server                           | Default 5,000 Place Details requests per Google billing month. Set 0 to stop detail lookups.                                                                                                                             |

Restart `npm run dev` after editing environment variables. `NEXT_PUBLIC_` values are embedded at build time, so set them **before `npm run build`** in production. Set server variables in your host's private environment settings.

Follow [Google's key-security guidance](https://developers.google.com/maps/api-security-best-practices). Set provider API quotas and billing alerts as well. Alerts alone do not stop billing. A restaurant search costs up to six Text Search Pro calls (two areas, up to three pages each, stopping at 120 unique usable shops or when pages run out). Opening the leaderboard costs zero Google calls; selecting an entry whose details are not already loaded costs one Place Details Pro call. No Google ratings, photos, reviews, or opening hours are requested.

## Separate monthly Google limits

Run `npm run db:setup` after upgrading, then restart the app. The previous `MAX_GOOGLE_REQUESTS_PER_DAY` setting is retired. PostgreSQL stores three independent counters in `google_monthly_usage`: `maps-dynamic`, `places-search`, and `places-details`. Places has two limits because Google bills searches and detail lookups under separate SKUs, each with its own free allowance.

| Operation                           | Default monthly app limit | First paid tier, USD per 1,000 events |
| ----------------------------------- | ------------------------: | ------------------------------------: |
| Maps JavaScript API: Dynamic Maps   |                    10,000 |                                    $7 |
| Places API (New): Text Search Pro   |                     5,000 |                                   $32 |
| Places API (New): Place Details Pro |                     5,000 |                                   $17 |

The defaults match the [global free allowances](https://developers.google.com/maps/billing-and-pricing/pricing). Google shares allowances across projects on the same billing account, so reduce these app limits if other projects consume them. Counters switch to a new month at midnight on the first in `America/Los_Angeles`, matching [Google's reset time](https://developers.google.com/maps/billing-and-pricing/overview); that is 3pm or 4pm in Taipei depending on daylight saving. No scheduled reset job is needed.

Before creating a Google map, the browser sends a same-origin POST to `/api/map-usage`. The server atomically reserves one map load before the browser loads Google libraries. Panning, zooming, moving markers and selecting a restaurant reuse the existing map and do not reserve another load. Refreshing a page in map mode creates a new map and needs another reservation. List mode is remembered on this device; starting in list mode does not initialize Google Maps until the user switches to map mode. Switching an already-open map to list mode and back reuses that map. React's cancelled development mount does not request a reservation. Cancelled or failed initialization after reservation still consumes that slot conservatively.

Every outbound Places request also reserves a slot before contacting Google, including each search page, failed provider calls, and IDs-only discovery calls (even though the latter have a free Google SKU). When a counter reaches its limit, that operation returns HTTP 429 with a monthly message. Database or invalid configuration errors stop calls too. Limits are shared by all app processes using this database, survive restarts, and can be lowered at any time; `0` immediately stops new calls for that operation.

The migration preserves the previous daily Places rows. Because they combined searches and detail lookups, their current-month total is conservatively charged to **both** new Places counters. Both Taipei dates at the Pacific month boundaries are included. Re-running setup does not reset active counters. Map loads before this change were never tracked, so the initial Maps counter cannot include them automatically.

Inspect counters in PostgreSQL:

```sql
SELECT usage_key, usage_month, requests FROM google_monthly_usage
WHERE usage_month = date_trunc('month', now() AT TIME ZONE 'America/Los_Angeles')::date
ORDER BY usage_key;
```

For the first month, read the actual Dynamic Maps month-to-date usage in Google Cloud and reconcile the counter before relying on its full allowance. Replace `1234` below with that total; `greatest` prevents lowering an existing counter:

```sql
INSERT INTO google_monthly_usage (usage_key, requests) VALUES ('maps-dynamic', 1234)
ON CONFLICT (usage_key, usage_month) DO UPDATE
SET requests = greatest(google_monthly_usage.requests, excluded.requests);
```

These are app request limits, **not an absolute Google billing ceiling**. Browser keys are public, so someone can bypass this app's reservation endpoint by reusing the Maps key. Other applications, old browser bundles already open before this change, and direct API calls also bypass these counters. Restrict the Maps key to Maps JavaScript API and your exact website origins; keep the Places key private and restrict its allowed API and server IP where possible. Set the adjustable provider quotas in [Google Cloud](https://console.cloud.google.com/google/maps-apis/quotas) as a second layer. A per-minute provider quota only limits request speed, not total monthly spend. Billing alerts are notifications and do not stop requests.

## Taipei discovery: broad coverage, not “all restaurants”

Google Text Search caps each query at 60 results and does not provide a complete census. The script searches two breakfast-related terms in all twelve districts, follows pagination, deduplicates IDs, and stores candidate place IDs. Candidate IDs do not guarantee that a shop is currently open or serves breakfast. The website separately verifies live data when it searches, and its UI never claims complete coverage.

Preview queries first (no Google calls and no writes):

```sh
npm run places:import
```

Start with one district:

```sh
npm run places:import -- --district=大安區 --execute
```

Or discover across Taipei (at most **72** IDs-only Text Search requests):

```sh
npm run places:import -- --execute
```

Re-running deduplicates IDs and never resets compliments. The script stops on provider or database failure and retains previously imported IDs. The registry is optional: the website works without an import, registering live nearby results automatically. Importing IDs does not eliminate subsequent live search/detail calls.

## Why Google Maps and why not “store everything”?

Google Places content cannot generally be displayed in conjunction with an OpenStreetMap map, and restaurant names/addresses cannot be permanently copied into our own database under the standard terms. Place IDs may be stored indefinitely. Google permits temporary coordinate caching for up to 30 days; this app instead keeps all location details live and uncached to avoid a cleanup job. API responses are `private, no-store`.

See [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies), [service-specific terms §14](https://cloud.google.com/maps-platform/terms/maps-service-terms), and [Text Search limits](https://developers.google.com/maps/documentation/places/web-service/text-search). OSM can be used in a later version if its restaurant data comes from a separately licensed source.

## Checks

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

The installed Next.js lint configuration currently pulls in an unpatched `braces` development-tool advisory. `npm audit --omit=dev` reports no runtime dependency advisories. Do not run the linter against untrusted generated glob patterns; update the lint dependency when an upstream fix becomes available.

Integration tests use a **separate database** and a random disposable schema, never the application tables. For the local Compose setup:

```sh
docker compose exec postgres createdb -U breakfast breakfast_test
# TEST_DATABASE_URL is already shown in .env.example
npm run test:db
```

They exercise real PostgreSQL concurrency, account-wide daily uniqueness, validated server sessions, anonymous voting rejection, count aggregation, API validation, same-origin writes, request throttles, the 10-second search cooldown, 120-shop deduplication and six-page search limits and stopping pagination before a monthly budget is exceeded, Google-free leaderboard and vote submission, voting without GPS, signed receipt tampering/expiry, independent monthly Google budgets, month rollover, migration preservation, and preventing Places calls after exhaustion. Sessions are test fixtures and Places HTTP responses are mocked; these tests do **not** verify a live Google OAuth login, your real Google account, search coverage, or map rendering.

## Before publishing

- Serve over HTTPS; browser GPS works on HTTPS or localhost.
- Provide a persistent PostgreSQL database and run `npm run db:setup` against it; provision `DATABASE_URL` for scripts as well as the web host.
- Create a production map ID, restrict both API keys, and set provider quotas. The PostgreSQL call cap is a backstop, not a total billing cap.
- Replace local database credentials. Keep `.env.local` private and outside Git.
- Update the privacy/terms pages with the operator's contact and data-retention/deletion arrangements.
- Configure Google OAuth credentials and the exact HTTPS callback URI. The daily rule uses the authenticated account, not a browser cookie, and cannot be reset by logging out or switching devices. Multiple Google accounts can still cast separate votes. Voting does not require GPS or prove a visit. The optional location button helps users find nearby shops. The signed restaurant receipt expires after 15 minutes; the user can explicitly reload it.
- Restaurant search is keyword-based; brunch shops and traditional soy-milk shops can be missed or misclassified. Google may omit or change results. The map/list shows actual returned results rather than promising an exhaustive directory.
- Leaderboard counts preserve historical votes without resolving every restaurant through Google. Selecting a closed or no-longer-Taipei entry reports that it is unavailable; a failed Details lookup shows an error.

The project uses Better Auth's free library and PostgreSQL directly, with no ORM, paid auth service or scheduled importer.
