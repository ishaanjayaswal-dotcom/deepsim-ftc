import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { paths } from "./schema.js";
import { searchText } from "../lib/search.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/libsql/migrator";
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
  await migrate(db, { migrationsFolder: migrationsFolder() });
  // SQLite lower() cannot fold Unicode. Complete the search migration in JS,
  // using the same Unicode folding as creates/patches/seeds for existing rows.
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(paths).where(eq(paths.searchText, ""));
    for (const row of rows) {
      await tx.update(paths).set({ searchText: searchText(row) }).where(eq(paths.id, row.id));
    }
  });
}
