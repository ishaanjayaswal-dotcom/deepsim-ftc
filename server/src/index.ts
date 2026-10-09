import { serve } from "@hono/node-server";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { seedIfEmpty } from "./db/seed.js";

async function ensureDataDir(databaseUrl: string): Promise<void> {
  if (!databaseUrl.startsWith("file:")) return;
  const filePath = databaseUrl.slice("file:".length);
  await mkdir(dirname(resolve(filePath)), { recursive: true });
}

async function main(): Promise<void> {
  const config = loadConfig();
  await ensureDataDir(config.databaseUrl);

  const db = createDb(config.databaseUrl, config.databaseAuthToken);
  await runMigrations(db);
  await seedIfEmpty(db, config.seed);

  const app = createApp({ db, config });

  const server = serve(
    {
      fetch: app.fetch,
      port: config.port,
      hostname: config.host,
    },
    (info) => {
      console.log(`http://${config.host}:${info.port}`);
    },
  );

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
