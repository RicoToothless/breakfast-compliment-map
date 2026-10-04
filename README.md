# 早餐被稱讚地圖

A Next.js + PostgreSQL app for finding Taipei breakfast shops and recording the small joy of being called 帥哥、美女、妹妹.

## What it does

- Asks for browser GPS permission when the user presses **使用我的位置**. Without permission, users can select a Taipei district or search around the map center.
- Searches up to three Google Text Search pages, filters for Taipei City addresses, and sorts nearby results within 3 km by straight-line distance. District search shows matching results from that district.
- Shows restaurant names and the app's compliment counts together on Google Maps pins.
- Selecting a restaurant opens its compliment card with **我被稱讚了** and **我被稱讚為帥哥、美女、妹妹等等**.
- Counts one compliment per restaurant, browser, and Taipei calendar day. A database unique constraint prevents simultaneous clicks from adding duplicates.
- Shows the top ten restaurants by all-time compliment count; ties prefer the earliest first compliment. These are raw reports, not a measured probability or Google rating.
- Fetches Google names, addresses, coordinates and status live. PostgreSQL permanently stores only place IDs, discovery timestamps, app-owned compliment events, and request counters. GPS is not stored in the database.

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

Open http://localhost:3000. Without all three required settings, visitors see a simple temporary-unavailability message. Setup instructions live only in this README; there is no public setup page. The database setup is idempotent and preserves existing data. Stop the local container with `docker compose stop`; do not remove its volume if you need to preserve compliments.

## Google Cloud setup

For a populated local demo, run `npm run db:demo`. It fetches live restaurant IDs
and adds varied synthetic votes over the previous 30 days. Re-running replaces
only demo votes. Before launch, run `npm run db:demo -- --clear` to remove them;
real votes are preserved. The script refuses remote databases.

1. Create a [Google Cloud project](https://console.cloud.google.com/google/maps-apis/overview) and attach a billing account.
2. Enable **Maps JavaScript API** and **Places API (New)**.
3. Create two separate API keys:

| Environment variable              | Where used                       | Restrictions                                                                                                                                                                                                             |
| --------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Browser                          | Restrict API to Maps JavaScript API; use website restrictions for `http://localhost:3000/*`, `http://127.0.0.1:3000/*`, and your eventual HTTPS domain. This key is intentionally visible to browsers.                   |
| `GOOGLE_PLACES_API_KEY`           | Next.js server and import script | Restrict API to Places API (New). Restrict to your server's outbound IP when it has a stable IP. Website/referrer restrictions do **not** work for server-side calls. Never expose this key using a `NEXT_PUBLIC_` name. |
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`  | Browser                          | `DEMO_MAP_ID` works for development. Create a JavaScript map ID in Google Maps Management for production. A map ID is not an API key.                                                                                    |
| `DATABASE_URL`                    | Next.js server and scripts       | PostgreSQL connection string. Local Compose uses port **55432**, database `breakfast`. For hosted PostgreSQL, follow your provider's TLS requirements; do not disable certificate verification.                          |
| `MAX_GOOGLE_REQUESTS_PER_DAY`     | Server                           | Default 500 outbound Places calls per Taipei day, shared atomically through PostgreSQL. Includes importer calls and failed provider calls. Does not cover browser map loads.                                             |

Restart `npm run dev` after editing environment variables. `NEXT_PUBLIC_` values are embedded at build time, so set them **before `npm run build`** in production. Set server variables in your host's private environment settings.

Follow [Google's key-security guidance](https://developers.google.com/maps/api-security-best-practices). Set provider API quotas and billing alerts as well. Alerts alone do not stop billing. Nearby search costs up to three Text Search Pro calls per search. A leaderboard load costs up to ten Place Details Pro calls. No Google ratings, photos, reviews, or opening hours are requested.

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

They exercise real PostgreSQL concurrency, daily uniqueness, count aggregation, API validation, same-origin writes, request throttles and the global Google-call budget. Google HTTP responses in these tests are explicit fixtures; they do **not** verify your real Google account, search coverage, or map rendering.

## Before publishing

- Serve over HTTPS; browser GPS works on HTTPS or localhost.
- Provide a persistent PostgreSQL database and run `npm run db:setup` against it; provision `DATABASE_URL` for scripts as well as the web host.
- Create a production map ID, restrict both API keys, and set provider quotas. The PostgreSQL call cap is a backstop, not a total billing cap.
- Replace local database credentials. Keep `.env.local` private and outside Git.
- Update the privacy/terms pages with the operator's contact and data-retention/deletion arrangements.
- Anonymous browser cookies provide convenience, not strong identity. Clearing cookies or using another browser can bypass the daily compliment rule. Add identity verification or bot protection if public abuse becomes a problem; GPS is not required for voting and does not prove a visit.
- Restaurant search is keyword-based; brunch shops and traditional soy-milk shops can be missed or misclassified. Google may omit or change results. The map/list shows actual returned results rather than promising an exhaustive directory.
- Closed or no-longer-Taipei restaurants are omitted from the visible leaderboard, while their historical compliment records are preserved. A failed Details request surfaces a leaderboard error rather than displaying invented data.

The project intentionally has no authentication provider, ORM, scheduled importer, or paid external service beyond Google and your chosen PostgreSQL/hosting provider.
