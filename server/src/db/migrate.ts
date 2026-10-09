import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { Db } from "./client.js";

export function migrationsFolder(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../drizzle");
}

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: migrationsFolder() });
}
