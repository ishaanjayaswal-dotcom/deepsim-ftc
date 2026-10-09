import { existsSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { paths } from "./schema.js";
import { searchText } from "../lib/search.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { deriveFromSource } from "../../../src/repo/derive.js";
import type { Db } from "./client.js";

export function migrationsFolder(): string {
  const base = dirname(fileURLToPath(import.meta.url));
  const candidates = process.env.MIGRATIONS_DIR
    ? [process.env.MIGRATIONS_DIR]
    : [join(base, "../drizzle"), join(base, "../../drizzle")];
  const folder = candidates.find((candidate) => existsSync(join(candidate, "meta/_journal.json")));
  if (!folder) throw new Error("Migrations folder must contain meta/_journal.json");
  return folder;
}

export async function runMigrations(db: Db): Promise<void> {
  const migrations = readMigrationFiles({ migrationsFolder: migrationsFolder() });
  // Read the journal while holding the write transaction, so a second process
  // sees the first process's completed migrations instead of replaying stale DDL.
  await db.transaction(async (tx) => {
    await tx.run(sql`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric
    )`);
    const applied = await tx.values<[number, string, number]>(sql`SELECT id, hash, created_at
      FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1`);
    for (const migration of migrations) {
      if (applied[0] && Number(applied[0][2]) >= migration.folderMillis) continue;
      for (const statement of migration.sql) await tx.run(sql.raw(statement));
      await tx.run(sql`INSERT INTO __drizzle_migrations (hash, created_at)
        VALUES (${migration.hash}, ${migration.folderMillis})`);
    }
    // SQLite lower() cannot fold Unicode. Backfill in JS with the same folding
    // as writes, including the final-sigma change for already populated rows.
    const rows = await tx.select().from(paths);
    for (const row of rows) {
      const update: { searchText?: string; stats?: string; thumbnail?: string } = {};
      const normalized = searchText(row);
      if (row.searchText !== normalized) update.searchText = normalized;
      const stats = JSON.parse(row.stats);
      if (stats?.alliance !== "red" && stats?.alliance !== "blue") {
        const derived = deriveFromSource(row.data);
        update.stats = JSON.stringify(derived.stats);
        update.thumbnail = derived.thumbnail;
      }
      if (Object.keys(update).length) await tx.update(paths).set(update).where(eq(paths.id, row.id));
    }
  });
}
