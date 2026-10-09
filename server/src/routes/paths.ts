import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { deriveFromSource } from "../../../src/repo/derive.js";
import type { PathRecord } from "../../../src/repo/types.js";
import type { AppDeps } from "../app.js";
import { paths, votes } from "../db/schema.js";
import { canEdit, createEditKey, EDIT_FORBIDDEN, hashEditKey } from "../lib/auth.js";
import { createRateLimiter, rateLimit } from "../lib/rateLimit.js";
import { searchText } from "../lib/search.js";
import { draftSchema, patchSchema, querySchema, validate, validationMessage, voterSchema } from "../lib/validation.js";

type PathRow = typeof paths.$inferSelect;

export function toRecord(row: PathRow): PathRecord {
  return {
    id: row.id, name: row.name, teamNumber: row.teamNumber, category: row.category,
    description: row.description, data: row.data, thumbnail: row.thumbnail,
    stats: JSON.parse(row.stats) as PathRecord["stats"], upvotes: row.upvotes,
    createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function derive(data: string) {
  try {
    const result = deriveFromSource(data);
    return { thumbnail: result.thumbnail, stats: JSON.stringify(result.stats) };
  } catch (error) {
    throw new HTTPException(400, { message: error instanceof Error ? error.message : "Path does not parse" });
  }
}

export function createPathsRoutes({ db, config, limiter = createRateLimiter() }: AppDeps): Hono {
  const routes = new Hono();
  const find = async (id: string) => {
    const [row] = await db.select().from(paths).where(eq(paths.id, id));
    if (!row) throw new HTTPException(404, { message: "Not found" });
    return row;
  };
  const authorize = (row: PathRow, key?: string, bearer?: string) => {
    if (!canEdit(row.editKeyHash, key, bearer, config.adminKey)) {
      throw new HTTPException(403, { message: EDIT_FORBIDDEN });
    }
  };

  routes.get("/", validate("query", querySchema), async (c) => {
    const { q, category, sort, limit, offset } = c.req.valid("query");
    const conditions = [];
    if (category) conditions.push(eq(paths.category, category));
    if (q) {
      const pattern = `%${q.toLocaleLowerCase("und").replace(/[\\%_]/g, "\\$&")}%`;
      conditions.push(sql`${paths.searchText} like ${pattern} escape '\\'`);
    }
    const rows = await db.select().from(paths).where(and(...conditions))
      .orderBy(...(sort === "top" ? [desc(paths.upvotes), desc(paths.createdAt), desc(paths.id)] : [desc(paths.createdAt), desc(paths.id)]))
      .limit(limit).offset(offset);
    return c.json(rows.map(toRecord));
  });

  routes.get("/:id", async (c) => c.json(toRecord(await find(c.req.param("id")))));

  routes.post("/", rateLimit(limiter, "create", config.trustProxy), validate("json", draftSchema), async (c) => {
    const draft = c.req.valid("json");
    const editKey = createEditKey();
    const now = new Date().toISOString();
    const [row] = await db.insert(paths).values({
      ...draft, searchText: searchText(draft), ...derive(draft.data), id: randomUUID(), editKeyHash: hashEditKey(editKey),
      createdAt: now, updatedAt: now,
    }).returning();
    return c.json({ ...toRecord(row), editKey }, 201);
  });

  routes.patch("/:id", rateLimit(limiter, "edit", config.trustProxy), validate("json", patchSchema), async (c) => {
    const row = await find(c.req.param("id"));
    authorize(row, c.req.header("X-Edit-Key"), c.req.header("Authorization"));
    const patch = c.req.valid("json");
    const derived = patch.data !== undefined ? derive(patch.data) : {};
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(row.updatedAt) + 1)).toISOString();
    const [updated] = await db.update(paths).set({ ...patch, ...derived, searchText: searchText({ ...row, ...patch }), updatedAt }).where(eq(paths.id, row.id)).returning();
    if (!updated) throw new HTTPException(404, { message: "Not found" });
    return c.json(toRecord(updated));
  });

  routes.delete("/:id", rateLimit(limiter, "edit", config.trustProxy), async (c) => {
    const row = await find(c.req.param("id"));
    authorize(row, c.req.header("X-Edit-Key"), c.req.header("Authorization"));
    await db.delete(paths).where(eq(paths.id, row.id));
    return c.body(null, 204);
  });

  routes.post("/:id/upvote", rateLimit(limiter, "upvote", config.trustProxy), async (c) => {
    const voter = voterSchema.safeParse(c.req.header("X-Voter-Id") ?? "");
    if (!voter.success) return c.json({ error: validationMessage(voter.error) }, 400);
    const id = c.req.param("id");
    const row = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(paths).where(eq(paths.id, id));
      if (!existing) throw new HTTPException(404, { message: "Not found" });
      const inserted = await tx.insert(votes).values({ pathId: id, voterId: voter.data, createdAt: new Date().toISOString() })
        .onConflictDoNothing().returning();
      if (!inserted.length) return existing;
      const [updated] = await tx.update(paths).set({ upvotes: sql`${paths.upvotes} + 1` }).where(eq(paths.id, id)).returning();
      return updated;
    });
    return c.json(toRecord(row));
  });

  return routes;
}
