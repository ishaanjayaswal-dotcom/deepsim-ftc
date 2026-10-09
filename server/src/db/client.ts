import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema.js";

export async function createDb(url: string, authToken?: string) {
  const local = url.startsWith("file:");
  // timeout also applies to any additional connections opened by the local pool.
  const client = createClient({ url, authToken, ...(local ? { timeout: 5_000 } : {}) });
  try {
    if (local) {
      await client.execute("PRAGMA busy_timeout = 5000");
      await client.execute("PRAGMA journal_mode = WAL");
    }
    const db = drizzle(client, { schema });
    if (local) {
      // Local transactions hold a connection across awaits. Serialize writers so
      // SQLite's synchronous busy wait cannot block the writer that must release it.
      const transaction = db.transaction.bind(db);
      let pending = Promise.resolve();
      db.transaction = ((...args: Parameters<typeof transaction>) => {
        const result = pending.then(() => transaction(...args));
        pending = result.then(() => {}, () => {});
        return result;
      }) as typeof db.transaction;
    }
    return db;
  } catch (error) {
    client.close();
    throw error;
  }
}

export type Db = Awaited<ReturnType<typeof createDb>>;
