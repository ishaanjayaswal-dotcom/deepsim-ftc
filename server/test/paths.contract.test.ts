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
    rows.forEach((row: { stats: { alliance: string } }) => {
      assertNoEditKeyLeak(row);
      expect(row).not.toHaveProperty("data");
      expect(["red", "blue"]).toContain(row.stats.alliance);
    });
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

    const descOnly = "qsearch-desc-unique-xyzzy";
    const catOnly = "QsearchCatUniqueWombat";
    await ctx.app.request("/api/paths", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validDraft({ description: descOnly, category: "Park Only" })),
    });
    await ctx.app.request("/api/paths", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validDraft({ description: "plain", category: catOnly })),
    });

    const byDescription = await (await ctx.app.request(`/api/paths?q=${encodeURIComponent(descOnly)}`)).json();
    expect(byDescription).toHaveLength(1);
    expect(byDescription[0].description).toBe(descOnly);

    const byCategoryQ = await (await ctx.app.request(`/api/paths?q=${encodeURIComponent(catOnly)}`)).json();
    expect(byCategoryQ).toHaveLength(1);
    expect(byCategoryQ[0].category).toBe(catOnly);
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

    const badLimit = await ctx.app.request("/api/paths?limit=101");
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
      [{ teamNumber: 1.5 }, /teamNumber/i],
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

    const invalidChar = await ctx.app.request(`/api/paths/${id}/upvote`, {
      method: "POST",
      headers: { "X-Voter-Id": "bad!chars" },
    });
    expect(invalidChar.status).toBe(400);
    expect((await invalidChar.json()).error).toMatch(/X-Voter-Id/i);

    const tooLong = await ctx.app.request(`/api/paths/${id}/upvote`, {
      method: "POST",
      headers: { "X-Voter-Id": "a".repeat(65) },
    });
    expect(tooLong.status).toBe(400);

    const { id: boundaryId } = await (
      await ctx.app.request("/api/paths", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validDraft({ name: "Voter boundary path" })),
      })
    ).json();
    for (const voterId of ["12345678", "a".repeat(64)]) {
      expect(
        (await ctx.app.request(`/api/paths/${boundaryId}/upvote`, {
          method: "POST",
          headers: { "X-Voter-Id": voterId },
        })).status,
      ).toBe(200);
    }

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
    expect(one.data).toBeTruthy();
  });
});

describe("F1 data regressions", () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestContext(); });
  afterEach(() => ctx.close());
  const create = async (draft = validDraft()) => (await ctx.app.request("/api/paths", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft),
  })).json();
  const patch = (row: { id: string; editKey: string }, body: unknown) => ctx.app.request(`/api/paths/${row.id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json", "X-Edit-Key": row.editKey }, body: JSON.stringify(body),
  });

  it("folds Unicode search on create and maintains it on metadata patch", async () => {
    const row = await create(validDraft({ name: "Ünïcode", description: "ΩMEGA", category: "Élite" }));
    for (const q of ["ÜNÏCODE", "ünïcode", "ωmega", "élite", "12345"]) {
      expect(await (await ctx.app.request(`/api/paths?q=${encodeURIComponent(q)}`)).json()).toHaveLength(1);
    }
    await patch(row, { name: "Änderung", description: "Δelta", category: "Öther", teamNumber: 999 });
    for (const q of ["änderung", "δELTA", "öther", "999"]) {
      expect(await (await ctx.app.request(`/api/paths?q=${encodeURIComponent(q)}`)).json()).toHaveLength(1);
    }
    expect(await (await ctx.app.request("/api/paths?q=ünïcode")).json()).toHaveLength(0);
  });

  it("rederives when the patch resends unchanged data", async () => {
    const { paths } = await import("../src/db/schema.js");
    const row = await create();
    await ctx.db.update(paths).set({ thumbnail: "stale", stats: "{}" }).where(eq(paths.id, row.id));
    const response = await (await patch(row, { data: PARK_SOURCE })).json();
    expect(response.thumbnail).toBe(deriveFromSource(PARK_SOURCE).thumbnail);
    expect(response.stats).toEqual(deriveFromSource(PARK_SOURCE).stats);
  });

  it("uses descending ids to break ties on both paginated sorts", async () => {
    const { paths } = await import("../src/db/schema.js");
    const rows = [await create(), await create(), await create()];
    await ctx.db.update(paths).set({ createdAt: "2026-01-01T00:00:00.000Z", upvotes: 0 });
    const ids = rows.map((row) => row.id).sort().reverse();
    for (const sort of ["new", "top"]) {
      const actual = [];
      for (let offset = 0; offset < 3; offset++) {
        const page = await (await ctx.app.request(`/api/paths?sort=${sort}&limit=1&offset=${offset}`)).json();
        actual.push(page[0].id);
      }
      expect(actual).toEqual(ids);
    }
  });

  it("defaults list limit to 50 and caps it at 100", async () => {
    const { paths } = await import("../src/db/schema.js");
    const row = await create();
    const [stored] = await ctx.db.select().from(paths).where(eq(paths.id, row.id));
    await ctx.db.insert(paths).values(Array.from({ length: 100 }, (_, i) => ({ ...stored, id: `limit-${i}` })));
    expect(await (await ctx.app.request("/api/paths")).json()).toHaveLength(50);
    expect(await (await ctx.app.request("/api/paths?limit=")).json()).toHaveLength(50);
    expect(await (await ctx.app.request("/api/paths?limit=100")).json()).toHaveLength(100);
    expect((await ctx.app.request("/api/paths?limit=101")).status).toBe(400);
  });

  it("trims category and description before validation on create and patch", async () => {
    const bad = await ctx.app.request("/api/paths", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(validDraft({ category: "   " })) });
    expect(bad.status).toBe(400);
    const row = await create(validDraft({ category: "  Park  ", description: "  note  " }));
    expect(row.category).toBe("Park"); expect(row.description).toBe("note");
    expect((await patch(row, { category: "  " })).status).toBe(400);
    const updated = await (await patch(row, { description: " new ", category: " Next " })).json();
    expect(updated.category).toBe("Next"); expect(updated.description).toBe("new");
  });
});
