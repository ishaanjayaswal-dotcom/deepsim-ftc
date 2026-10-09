import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TestContext } from "./helpers.js";
import { deriveFromSource } from "../../src/repo/derive.js";
import { presetSource } from "../../src/path/presets.js";
import { votes } from "../src/db/schema.js";
import { EDIT_FORBIDDEN } from "../src/lib/auth.js";
import {
  ADMIN_KEY,
  assertNoEditKeyLeak,
  createTestContext,
  nodeBindings,
  PARK_SOURCE,
  validDraft,
  VOTER_A,
  VOTER_B,
} from "./helpers.js";

describe("paths API contract", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext({ seed: true, adminKey: ADMIN_KEY });
  });

  afterEach(() => {
    ctx.close();
  });

  it("GET /api/health returns ok and version", async () => {
    const res = await ctx.app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, version: ctx.config.version });
    assertNoEditKeyLeak(body);
  });

  it("lists paths with default sort=new (created_at desc)", async () => {
    const res = await ctx.app.request("/api/paths");
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows.length).toBe(5);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].createdAt >= rows[i].createdAt).toBe(true);
    }
    rows.forEach(assertNoEditKeyLeak);
  });

  it("sort=top orders by upvotes then created_at", async () => {
    const res = await ctx.app.request("/api/paths?sort=top");
    const rows = await res.json();
    expect(rows.map((r: { upvotes: number }) => r.upvotes)).toEqual([42, 37, 29, 12, 8]);
  });

  it("search q matches name, description, category, and team number (case-insensitive)", async () => {
    const byName = await (await ctx.app.request("/api/paths?q=specimen")).json();
    expect(byName).toHaveLength(1);
    expect(byName[0].name).toContain("Specimen");

    const byCase = await (await ctx.app.request("/api/paths?q=SPECIMEN")).json();
    expect(byCase).toHaveLength(1);

    const byTeam = await (await ctx.app.request("/api/paths?q=27182")).json();
    expect(byTeam).toHaveLength(1);
    expect(byTeam[0].teamNumber).toBe(27182);

    const byCategory = await (await ctx.app.request("/api/paths?category=Park%20Only")).json();
    expect(byCategory).toHaveLength(1);
    expect(byCategory[0].category).toBe("Park Only");
  });

  it("treats LIKE wildcards in q literally", async () => {
    const percent = await (await ctx.app.request("/api/paths?q=%25")).json();
    expect(percent).toEqual([]);
    const underscore = await (await ctx.app.request("/api/paths?q=%5F")).json();
    expect(underscore).toEqual([]);
  });

  it("paginates with limit and offset bounds", async () => {
    const page = await (await ctx.app.request("/api/paths?limit=1&offset=1")).json();
    expect(page).toHaveLength(1);

    const badLimit = await ctx.app.request("/api/paths?limit=201");
    expect(badLimit.status).toBe(400);
    const err = await badLimit.json();
    expect(err.error).toMatch(/limit/i);
  });

  it("GET /api/paths/:id returns 404 when missing", async () => {
    const res = await ctx.app.request("/api/paths/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("POST creates 201 with editKey and ignores client thumbnail/stats", async () => {
    const draft = {
      ...validDraft(),
      thumbnail: "FAKE THUMBNAIL",
      stats: { lengthIn: 1, durationS: 1, segments: 1, grade: "A+" },
    };
    const res = await ctx.app.request("/api/paths", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.editKey).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(body.thumbnail).not.toBe("FAKE THUMBNAIL");
    expect(body.stats.grade).not.toBe("A+");
    const expected = deriveFromSource(draft.data);
    expect(body.thumbnail).toBe(expected.thumbnail);
    expect(body.stats).toEqual(expected.stats);
    assertNoEditKeyLeak(body);
    expect(body).not.toHaveProperty("editKeyHash");
  });

  it("validates each draft field with 400 naming the field", async () => {
    const cases: [Partial<ReturnType<typeof validDraft>>, RegExp][] = [
      [{ name: "" }, /name/i],
      [{ name: "x".repeat(81) }, /name/i],
      [{ teamNumber: 0 }, /teamNumber/i],
      [{ teamNumber: 100_000 }, /teamNumber/i],
      [{ category: "" }, /category/i],
      [{ category: "c".repeat(41) }, /category/i],
      [{ description: "d".repeat(1001) }, /description/i],
      [{ data: "" }, /data/i],
      [{ data: "x".repeat(65537) }, /data/i],
    ];
    for (const [patch, pattern] of cases) {
      const res = await ctx.app.request("/api/paths", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validDraft(patch)),
      });
      expect(res.status).toBe(400);
      const err = await res.json();
      expect(err.error).toMatch(pattern);
    }
  });

  it("rejects unparseable path data with 400", async () => {
    const res = await ctx.app.request("/api/paths", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validDraft({ data: "{ not a path" })),
    });
    expect(res.status).toBe(400);
    const err = await res.json();
    expect(err.error).toBeTruthy();
  });

  it("PATCH/DELETE auth matrix and seed admin-only", async () => {
    const createRes = await ctx.app.request("/api/paths", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validDraft()),
    });
    const created = await createRes.json();
    const id = created.id as string;
    const editKey = created.editKey as string;

    const seedList = await (await ctx.app.request("/api/paths?sort=top")).json();
    const seedId = seedList[0].id as string;

    for (const method of ["PATCH", "DELETE"] as const) {
      const noKey = await ctx.app.request(`/api/paths/${id}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "PATCH" ? JSON.stringify({ name: "Nope" }) : undefined,
      });
      expect(noKey.status).toBe(403);
      expect(await noKey.json()).toEqual({ error: EDIT_FORBIDDEN });

      const wrongKey = await ctx.app.request(`/api/paths/${id}`, {
        method,
        headers: { "Content-Type": "application/json", "X-Edit-Key": "wrong-key-xxxxxxxx" },
        body: method === "PATCH" ? JSON.stringify({ name: "Nope" }) : undefined,
      });
      expect(wrongKey.status).toBe(403);
    }

    const seedPatch = await ctx.app.request(`/api/paths/${seedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Edit-Key": editKey },
      body: JSON.stringify({ name: "Hacked seed" }),
    });
    expect(seedPatch.status).toBe(403);

    const adminPatch = await ctx.app.request(`/api/paths/${seedId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ADMIN_KEY}`,
      },
      body: JSON.stringify({ name: "Admin rename" }),
    });
    expect(adminPatch.status).toBe(200);

    const goodPatch = await ctx.app.request(`/api/paths/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Edit-Key": editKey },
      body: JSON.stringify({ name: "Updated name" }),
    });
    expect(goodPatch.status).toBe(200);
    const patched = await goodPatch.json();
    expect(patched.name).toBe("Updated name");
    expect(patched.createdAt).toBe(created.createdAt);
    expect(patched.updatedAt).not.toBe(created.updatedAt);

    const newData = presetSource("four-sample");
    const dataPatch = await ctx.app.request(`/api/paths/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Edit-Key": editKey },
      body: JSON.stringify({ data: newData }),
    });
    const withData = await dataPatch.json();
    const derived = deriveFromSource(newData);
    expect(withData.stats).toEqual(derived.stats);
    expect(withData.thumbnail).toBe(derived.thumbnail);
    expect(withData.createdAt).toBe(created.createdAt);
    expect(withData.updatedAt).not.toBe(patched.updatedAt);

    const del = await ctx.app.request(`/api/paths/${id}`, {
      method: "DELETE",
      headers: { "X-Edit-Key": editKey },
    });
    expect(del.status).toBe(204);
    expect((await ctx.app.request(`/api/paths/${id}`)).status).toBe(404);
  });

  it("upvote validates header, is idempotent, and cascades votes on delete", async () => {
    const { id } = await (
      await ctx.app.request("/api/paths", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validDraft()),
      })
    ).json();

    const missing = await ctx.app.request(`/api/paths/${id}/upvote`, { method: "POST" });
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toMatch(/X-Voter-Id/i);

    const badVoter = await ctx.app.request(`/api/paths/${id}/upvote`, {
      method: "POST",
      headers: { "X-Voter-Id": "short" },
    });
    expect(badVoter.status).toBe(400);

    const first = await ctx.app.request(`/api/paths/${id}/upvote`, {
      method: "POST",
      headers: { "X-Voter-Id": VOTER_A },
    });
    expect(first.status).toBe(200);
    const afterFirst = await first.json();
    expect(afterFirst.upvotes).toBe(1);

    const dup = await ctx.app.request(`/api/paths/${id}/upvote`, {
      method: "POST",
      headers: { "X-Voter-Id": VOTER_A },
    });
    expect((await dup.json()).upvotes).toBe(1);

    const second = await ctx.app.request(`/api/paths/${id}/upvote`, {
      method: "POST",
      headers: { "X-Voter-Id": VOTER_B },
    });
    expect((await second.json()).upvotes).toBe(2);

    const voteRows = await ctx.db.select().from(votes).where(eq(votes.pathId, id));
    expect(voteRows).toHaveLength(2);

    await ctx.app.request(`/api/paths/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ADMIN_KEY}` },
    });
    const afterDelete = await ctx.db.select().from(votes).where(eq(votes.pathId, id));
    expect(afterDelete).toHaveLength(0);
  });

  it("rejects malformed JSON, oversized bodies, and unknown /api routes", async () => {
    const badJson = await ctx.app.request("/api/paths", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(badJson.status).toBe(400);
    const badBody = await badJson.json();
    expect(badBody.error).toBeTruthy();

    const huge = "x".repeat(131_073);
    const tooBig = await ctx.app.request("/api/paths", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: huge,
    });
    expect(tooBig.status).toBe(413);
    expect((await tooBig.json()).error).toMatch(/128 KB/i);

    const unknown = await ctx.app.request("/api/no-such-route");
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "Not found" });
  });

  it("never exposes edit key hashes in list or get responses", async () => {
    const list = await (await ctx.app.request("/api/paths")).json();
    list.forEach(assertNoEditKeyLeak);
    const one = await (await ctx.app.request(`/api/paths/${list[0].id}`)).json();
    assertNoEditKeyLeak(one);
  });
});
