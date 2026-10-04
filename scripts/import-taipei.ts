import { DISTRICTS, TAIPEI_BOUNDS } from "../lib/geo";
import { getDb, rememberPlaces } from "../lib/db";
import { googleRequest } from "../lib/places";

const args = process.argv.slice(2);
const districtArg = args
  .find((arg) => arg.startsWith("--district="))
  ?.split("=")[1];
if (args.some((arg) => arg !== "--execute" && !arg.startsWith("--district="))) {
  throw new Error(
    "Usage: npm run places:import -- [--district=大安區] [--execute]",
  );
}
if (districtArg && !DISTRICTS.includes(districtArg))
  throw new Error("Unknown Taipei district.");
const districts = districtArg ? [districtArg] : DISTRICTS;
const terms = ["早餐店", "豆漿早餐"];
const maximumRequests = districts.length * terms.length * 3;
console.log(
  `Discovery: ${districts.join(", ")}; at most ${maximumRequests} IDs-only Text Search calls.`,
);
console.log(
  "This discovers candidate IDs, not a complete restaurant census. Names/addresses are not stored.",
);

if (!args.includes("--execute")) {
  console.log(
    "Preview only. Add --execute after configuring your key and database.",
  );
} else {
  const db = getDb();
  let calls = 0;
  const seen = new Set<string>();
  try {
    for (const district of districts) {
      for (const term of terms) {
        let pageToken: string | undefined;
        for (let page = 0; page < 3; page++) {
          const response = await googleRequest<{
            places?: { id: string }[];
            nextPageToken?: string;
          }>("places:searchText", "places.id,nextPageToken", {
            textQuery: `台北市${district} ${term}`,
            languageCode: "zh-TW",
            regionCode: "TW",
            locationRestriction: { rectangle: TAIPEI_BOUNDS },
            pageSize: 20,
            ...(pageToken ? { pageToken } : {}),
          });
          calls++;
          const ids = (response.places ?? []).map((place) => place.id);
          await rememberPlaces(ids, db);
          ids.forEach((id) => seen.add(id));
          console.log(
            `${district} ${term}: page ${page + 1}, ${ids.length} candidates`,
          );
          pageToken = response.nextPageToken;
          if (!pageToken) break;
        }
      }
    }
    console.log(
      `Done: ${seen.size} distinct candidate IDs seen in ${calls} calls. Re-running is safe.`,
    );
  } finally {
    await db.end();
  }
}
