import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveFromSource } from "../../src/repo/derive.js";
import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { paths } from "../src/db/schema.js";
import { logSafeError } from "../src/lib/errors.js";
import { canonicalIp } from "../src/lib/rateLimit.js";
import { searchText } from "../src/lib/search.js";
import { createTestContext, createTinyLimiter, nodeBindings, validDraft } from "./helpers.js";

const post = (app: Awaited<ReturnType<typeof createTestContext>>["app"], draft = validDraft()) => app.request("/api/paths", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft),
});

describe("F3 completion regressions", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects the audit's billion-inch path over HTTP in under 200 ms", async () => {
    const ctx = await createTestContext();
    try {
      const start = performance.now();
      const response = await post(ctx.app, validDraft({ data: '{"path":[{"x":0,"y":0},{"x":1000000000,"y":0}]}' }));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/off the field/);
      expect(performance.now() - start).toBeLessThan(200);
      expect((await ctx.app.request("/api/health")).status).toBe(200);
      expect(await ctx.db.select().from(paths)).toEqual([]);
    } finally { ctx.close(); }
  });

  it("backfills missing alliance and old final-sigma search text at boot", async () => {
    const ctx = await createTestContext();
    try {
      const data = validDraft().data.replace('"red"', '"blue"');
      const created = await (await post(ctx.app, validDraft({ name: "ΟΣΑ", data }))).json();
      const legacy = { ...created.stats };
      delete legacy.alliance;
      await ctx.db.update(paths).set({ stats: JSON.stringify(legacy), searchText: "οςα", thumbnail: "old" }).where(eq(paths.id, created.id));
      await runMigrations(ctx.db);
      const [row] = await ctx.db.select().from(paths);
      expect(JSON.parse(row.stats)).toEqual(deriveFromSource(data).stats);
      expect(row.thumbnail).toBe(deriveFromSource(data).thumbnail);
      expect(row.searchText).toBe(searchText(row));
      expect(await (await ctx.app.request("/api/paths?q=" + encodeURIComponent("ΟΣ"))).json()).toHaveLength(1);
      expect(await (await ctx.app.request("/api/paths?q=" + encodeURIComponent("ος"))).json()).toHaveLength(1);
      await runMigrations(ctx.db);
      expect(await ctx.db.select().from(paths)).toEqual([row]);
    } finally { ctx.close(); }
  });

  it("shares HEAD and GET read buckets", async () => {
    const ctx = await createTestContext({ limiter: createTinyLimiter() });
    try {
      expect((await ctx.app.request("/api/paths", { method: "HEAD" })).status).toBe(200);
      const blocked = await ctx.app.request("/api/paths");
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("Retry-After")).toBe("42");
      expect((await ctx.app.request("/api/health", { method: "HEAD" })).status).toBe(200);
    } finally { ctx.close(); }
  });

  it("strips IPv6 zones for both socket and forwarded addresses", async () => {
    expect(canonicalIp("fe80::1%en0")).toBe("fe80::1");
    for (const address of ["garbage", "[::1]", "fe80::zz%en0", "", "::ffff:192.0.2.1%eth0"]) {
      expect(() => canonicalIp(address)).not.toThrow();
    }
    for (const trustProxy of [false, true]) {
      const ctx = await createTestContext({ trustProxy, limiter: createTinyLimiter() });
      try {
        const request = (ip: string) => ctx.app.request("/api/paths", { headers: { "X-Forwarded-For": ip } }, nodeBindings(ip));
        expect((await request("fe80:0:0:0:0:0:0:1%en0")).status).toBe(200);
        expect((await request("fe80::1%eth0")).status).toBe(429);
      } finally { ctx.close(); }
    }
  });

  it("keeps search synchronized with concurrent metadata patches", async () => {
    const ctx = await createTestContext();
    try {
      const row = await (await post(ctx.app)).json();
      const responses = await Promise.all([{ name: "Concurrent title" }, { description: "Concurrent note" }, { category: "Concurrent category" }].map((body) =>
        ctx.app.request(`/api/paths/${row.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json", "X-Edit-Key": row.editKey }, body: JSON.stringify(body),
        })));
      expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
      const [stored] = await ctx.db.select().from(paths);
      expect(stored).toMatchObject({ name: "Concurrent title", description: "Concurrent note", category: "Concurrent category" });
      expect(stored.searchText).toBe(searchText(stored));
      for (const q of ["Concurrent title", "Concurrent note", "Concurrent category"]) {
        expect(await (await ctx.app.request(`/api/paths?q=${encodeURIComponent(q)}`)).json()).toHaveLength(1);
      }
    } finally { ctx.close(); }
  });

  it("rejects controls before trimming metadata, allowing only description newlines", async () => {
    const ctx = await createTestContext();
    try {
      const row = await (await post(ctx.app)).json();
      for (const field of ["name", "category", "description"]) {
        for (const control of ["\0", "\t", "\r", "\x7f", "\x85", "\u2028", "\u2029", ...(field === "description" ? [] : ["\n"])]) {
          const patch = { [field]: `before${control}after` };
          expect((await post(ctx.app, validDraft(patch))).status).toBe(400);
          expect((await ctx.app.request(`/api/paths/${row.id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json", "X-Edit-Key": row.editKey }, body: JSON.stringify(patch),
          })).status).toBe(400);
        }
      }
      expect((await post(ctx.app, validDraft({ description: "first\nsecond" }))).status).toBe(201);
    } finally { ctx.close(); }
  });

  it("returns JSON, headers and a sanitized log for newline routes that skip middleware", async () => {
    const ctx = await createTestContext();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const response = await ctx.app.request("/api/paths/zz%0Ax/y%C2%85%E2%80%A8%E2%80%A9");
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
      expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      expect(log).toHaveBeenCalled();
      for (const [line] of log.mock.calls) expect(line).not.toMatch(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/);
    } finally { ctx.close(); }
  });

  it("defaults an empty PORT and sanitizes boot errors using the same formatter", () => {
    expect(loadConfig({ PORT: "" }).port).toBe(8787);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const errorId = logSafeError(new Error("Failed query: secret SQL\nparams: secret parameters"));
    const entry = log.mock.calls.map(([line]) => JSON.parse(line)).find((entry) => entry.errorId === errorId);
    expect(entry).toEqual({ errorId, name: "Error", message: "Database query failed" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });

  it("sets file pragmas and safely migrates from two simultaneous processes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deepsim-f3-migrate-"));
    const url = `file:${join(dir, "test.sqlite")}`;
    const source = `import {createDb} from ${JSON.stringify(pathToFileURL(resolve("server/src/db/client.ts")).href)};
      import {runMigrations} from ${JSON.stringify(pathToFileURL(resolve("server/src/db/migrate.ts")).href)};
      const db=await createDb(${JSON.stringify(url)});
      await runMigrations(db); console.log('migrated'); db.$client.close();`;
    try {
      const run = () => promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source]);
      const results = await Promise.all([run(), run()]);
      expect(results.map((result) => result.stdout.trim())).toEqual(["migrated", "migrated"]);
      const db = await createDb(url);
      try {
        expect((await db.$client.execute("PRAGMA busy_timeout")).rows[0][0]).toBe(5000);
        expect((await db.$client.execute("PRAGMA journal_mode")).rows[0][0]).toBe("wal");
        expect((await db.$client.execute("SELECT * FROM __drizzle_migrations")).rows).toHaveLength(2);
      } finally { db.$client.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
