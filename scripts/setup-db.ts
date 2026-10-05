import { readFile } from "node:fs/promises";
import { getDb } from "../lib/db";
import { getAuthOptions } from "../lib/auth";
import { getMigrations } from "better-auth/db/migration";

const db = getDb();
try {
  const migrations = await getMigrations(getAuthOptions());
  await migrations.runMigrations();
  const schema = await readFile(
    new URL("../db/schema.sql", import.meta.url),
    "utf8",
  );
  await db.query(schema);
  console.log(
    "Auth and application tables are ready. Existing compliments are preserved.",
  );
} finally {
  await db.end();
}
