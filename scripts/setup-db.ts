import { readFile } from "node:fs/promises";
import { getDb } from "../lib/db";

const db = getDb();
try {
  const schema = await readFile(
    new URL("../db/schema.sql", import.meta.url),
    "utf8",
  );
  await db.query(schema);
  console.log(
    "PostgreSQL tables are ready. Existing compliments are preserved.",
  );
} finally {
  await db.end();
}
