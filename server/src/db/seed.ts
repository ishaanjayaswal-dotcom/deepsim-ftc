import { count } from "drizzle-orm";
import { deriveFromSource } from "../../../src/repo/derive.js";
import { SEED_PATHS } from "../../../src/repo/seed.js";
import type { Db } from "./client.js";
import { searchText } from "../lib/search.js";
import { paths } from "./schema.js";

export async function seedIfEmpty(db: Db, seedEnabled: boolean): Promise<void> {
  if (!seedEnabled) return;

  await db.transaction(async (tx) => {
    const [{ value }] = await tx.select({ value: count() }).from(paths);
    if (value > 0) return;

    const now = Date.now();
    for (const seed of SEED_PATHS) {
      const { thumbnail, stats } = deriveFromSource(seed.data);
      const createdAt = new Date(now - seed.daysAgo * 86_400_000).toISOString();

      await tx.insert(paths).values({
        id: crypto.randomUUID(),
        name: seed.name,
        searchText: searchText(seed),
        teamNumber: seed.teamNumber,
        category: seed.category,
        description: seed.description,
        data: seed.data,
        thumbnail,
        stats: JSON.stringify(stats),
        upvotes: seed.upvotes,
        editKeyHash: null,
        createdAt,
        updatedAt: createdAt,
    });
  }
  });
}
