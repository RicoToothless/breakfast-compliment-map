import BreakfastMap from "@/components/breakfast-map";

// Read private server settings at request time, not only during the build.
export const dynamic = "force-dynamic";

export default function Home() {
  const configured = Boolean(
    process.env.DATABASE_URL &&
    process.env.GOOGLE_PLACES_API_KEY &&
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
  );
  return <BreakfastMap configured={configured} />;
}
