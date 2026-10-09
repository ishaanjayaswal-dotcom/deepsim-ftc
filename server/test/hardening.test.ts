import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db/client.js";
import { migrate } from "drizzle-orm/libsql/migrator";
import {
  createTestContext,
  createTinyLimiter,
  nodeBindings,
  validDraft,
  withFailingSelect,
  type TestContext,
} from "./helpers.js";

describe("server hardening", () => {
  describe("rate limits", () => {
    let ctx: TestContext;

    beforeEach(async () => {
      ctx = await createTestContext({ limiter: createTinyLimiter(1) });
    });
    afterEach(() => ctx.close());

    const post = (ip: string) =>
      ctx.app.request(
        "/api/paths",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validDraft({ name: `Rate ${ip} ${Math.random()}` })),
        },
        nodeBindings(ip),
      );

    it("returns 429 with Retry-After per bucket", async () => {
      const assertLimited = async (res: Response) => {
        expect(res.status).toBe(429);
        expect(res.headers.get("Retry-After")).toBe("42");
        expect(await res.json()).toEqual({ error: "Too many requests" });
      };

      const ok = await post("198.51.100.10");
      expect(ok.status).toBe(201);
      await assertLimited(await post("198.51.100.10"));

      const created = await post("198.51.100.11");
      expect(created.status).toBe(201);
      const { id, editKey } = (await created.json()) as { id: string; editKey: string };
      const patchOk = await ctx.app.request(
        `/api/paths/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "X-Edit-Key": editKey },
          body: JSON.stringify({ name: "Patched once" }),
        },
        nodeBindings("198.51.100.11"),
      );
      expect(patchOk.status).toBe(200);
      await assertLimited(
        await ctx.app.request(
          `/api/paths/${id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "X-Edit-Key": editKey },
            body: JSON.stringify({ name: "Patched twice" }),
          },
          nodeBindings("198.51.100.11"),
        ),
      );

      const upvoteOk = await ctx.app.request(
        `/api/paths/${id}/upvote`,
        { method: "POST", headers: { "X-Voter-Id": "rate-limit-voter-a" } },
        nodeBindings("198.51.100.12"),
      );
      expect(upvoteOk.status).toBe(200);
      await assertLimited(await ctx.app.request(`/api/paths/${id}`, {
        method: "DELETE", headers: { "X-Edit-Key": editKey },
      }, nodeBindings("198.51.100.11")));
      expect((await ctx.app.request(`/api/paths/${id}`, {}, nodeBindings("198.51.100.13"))).status).toBe(200);
      expect((await ctx.app.request(`/api/paths/${id}`, {
        method: "DELETE", headers: { "X-Edit-Key": editKey },
      }, nodeBindings("198.51.100.14"))).status).toBe(204);
      expect((await ctx.app.request(`/api/paths/${id}`, {}, nodeBindings("198.51.100.15"))).status).toBe(404);
      await assertLimited(
        await ctx.app.request(
          `/api/paths/${id}/upvote`,
          { method: "POST", headers: { "X-Voter-Id": "rate-limit-voter-b" } },
          nodeBindings("198.51.100.12"),
        ),
      );
    });

    it("ignores X-Forwarded-For unless trustProxy is enabled", async () => {
      const noTrust = await createTestContext({ limiter: createTinyLimiter(1) });
      try {
        await noTrust.app.request(
          "/api/paths",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Forwarded-For": "203.0.113.9",
            },
            body: JSON.stringify(validDraft({ name: "Proxy spoof 1" })),
          },
          nodeBindings("198.51.100.20"),
        );
        const second = await noTrust.app.request(
          "/api/paths",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Forwarded-For": "203.0.113.10",
            },
            body: JSON.stringify(validDraft({ name: "Proxy spoof 2" })),
          },
          nodeBindings("198.51.100.20"),
        );
        expect(second.status).toBe(429);
      } finally {
        noTrust.close();
      }

      const withTrust = await createTestContext({ limiter: createTinyLimiter(1), trustProxy: true });
      try {
        const a = await withTrust.app.request(
          "/api/paths",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Forwarded-For": "203.0.113.50",
            },
            body: JSON.stringify(validDraft({ name: "Trusted A" })),
          },
          nodeBindings("198.51.100.30"),
        );
        expect(a.status).toBe(201);
        const b = await withTrust.app.request(
          "/api/paths",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Forwarded-For": "203.0.113.51",
            },
            body: JSON.stringify(validDraft({ name: "Trusted B" })),
          },
          nodeBindings("198.51.100.30"),
        );
        expect(b.status).toBe(201);

        const sharedLast = "203.0.113.77";
        const sameLastCtx = await createTestContext({ limiter: createTinyLimiter(1), trustProxy: true });
        try {
          const warm = await sameLastCtx.app.request(
            "/api/paths",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Forwarded-For": `203.0.113.1, ${sharedLast}`,
              },
              body: JSON.stringify(validDraft({ name: "Shared last warm" })),
            },
            nodeBindings("198.51.100.41"),
          );
          expect(warm.status).toBe(201);
          const limited = await sameLastCtx.app.request(
            "/api/paths",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Forwarded-For": `203.0.113.2, ${sharedLast}`,
              },
              body: JSON.stringify(validDraft({ name: "Shared last B" })),
            },
            nodeBindings("198.51.100.41"),
          );
          expect(limited.status).toBe(429);
          expect(limited.headers.get("Retry-After")).toBe("42");
        } finally {
          sameLastCtx.close();
        }
      } finally {
        withTrust.close();
      }
    });
  });

  describe("security headers and CORS", () => {
    it("sets security headers and omits CSP by default", async () => {
      const ctx = await createTestContext();
      try {
        const res = await ctx.app.request("/api/health");
        expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
        expect(res.headers.get("X-Frame-Options")).toBe("DENY");
        expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
        expect(res.headers.get("Content-Security-Policy")).toBeNull();
        expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
      } finally {
        ctx.close();
      }
    });

    it("enables CORS only for configured origins", async () => {
      const ctx = await createTestContext({ corsOrigin: "http://example.test" });
      try {
        const preflight = await ctx.app.request("/api/health", {
          method: "OPTIONS",
          headers: { Origin: "http://example.test" },
        });
        expect(preflight.status).toBe(204);
        expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("http://example.test");
        expect(preflight.headers.get("Access-Control-Allow-Methods")).toContain("PATCH");

        const denied = await ctx.app.request("/api/health", {
          headers: { Origin: "http://evil.test" },
        });
        expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
      } finally {
        ctx.close();
      }
    });
  });

  describe("generic 500 responses", () => {
    it("hides internal errors from clients", async () => {
      const db = await createDb("file::memory:");
      await migrate(db, { migrationsFolder: "server/drizzle" });
      const config = loadConfig({ SEED: "false" });
      let fail = true;
      const app = createApp({ db: withFailingSelect(db, () => fail), config, limiter: false });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await app.request("/api/paths/00000000-0000-0000-0000-000000000000");
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Internal server error" });
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
      fail = false;
      db.$client.close();
    });
  });
});

describe("F1 audit regressions", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("evicts the oldest rate window and admits fresh identities at capacity", async () => {
    const { createRateLimiter } = await import("../src/lib/rateLimit.js");
    const limiter = createRateLimiter({ maxEntries: 2 });
    for (let i = 0; i < 20; i++) expect(limiter.consume("a", "create").allowed).toBe(true);
    expect(limiter.consume("a", "create").allowed).toBe(false);
    limiter.consume("b", "upvote");
    expect(limiter.consume("c", "create").allowed).toBe(true);
    expect(limiter.consume("a", "create").allowed).toBe(true);
  });

  it("uses the last forwarded IP and canonicalizes IPv6 and mapped IPv4", async () => {
    const ctx = await createTestContext({ trustProxy: true, limiter: createTinyLimiter() });
    try {
      const request = (xff: string) => ctx.app.request("/api/paths/x/upvote", { method: "POST", headers: { "X-Forwarded-For": xff } });
      expect((await request("1.2.3.4, 2001:DB8:0:0:0:0:0:1")).status).toBe(400);
      expect((await request("5.6.7.8, 2001:db8::1")).status).toBe(429);
      expect((await request("::ffff:192.0.2.1")).status).toBe(400);
      expect((await request("192.0.2.1")).status).toBe(429);
    } finally { ctx.close(); }
  });

  it("strips control characters from request log paths", async () => {
    const ctx = await createTestContext();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await ctx.app.request("/api/paths/a%0Ab%0Dc%00d%7F");
      expect(log).toHaveBeenCalled();
      for (const [line] of log.mock.calls) expect(line).not.toMatch(/[\x00-\x1f\x7f]/);
    } finally { ctx.close(); }
  });

  it("limits all API reads to 600 per window and exempts health", async () => {
    const { createRateLimiter } = await import("../src/lib/rateLimit.js");
    const ctx = await createTestContext({ limiter: createRateLimiter() });
    vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      for (let i = 0; i < 600; i++) {
        const route = ["/api/paths", "/api/paths/missing", "/api/unknown"][i % 3];
        expect((await ctx.app.request(route)).status).not.toBe(429);
      }
      const blocked = await ctx.app.request("/api/paths");
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("Retry-After")).toBeTruthy();
      expect((await ctx.app.request("/api/paths", { method: "HEAD" })).status).toBe(429);
      expect((await ctx.app.request("/api/health")).status).toBe(200);
    } finally { ctx.close(); }
  });

  it("logs a 5xx error id, name and safe cause message without SQL parameters", async () => {
    const ctx = await createTestContext();
    const failure = Object.assign(new Error("Failed query: insert secret\nparams: secret-edit-hash"), {
      cause: new Error("SQLITE_BUSY: database is locked"), params: ["secret-edit-hash"],
    });
    const db = withFailingSelect(ctx.db, () => { throw failure; });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const errors = await import("../src/lib/errors.js");
    const format = vi.spyOn(errors, "logSafeError");
    try {
      console.error("unrelated setup warning");
      const app = createApp({ db, config: { ...ctx.config, staticDir: "server/test/no-built-static" }, limiter: false });
      const res = await app.request("/api/paths");
      expect(await res.json()).toEqual({ error: "Internal server error" });
      const entries = () => log.mock.calls.flatMap(([line]) => {
        try { const entry = JSON.parse(String(line)); return entry.errorId ? [entry] : []; }
        catch { return []; }
      });
      const loggedIds = () => new Set(format.mock.results.filter((result) => result.type === "return").map((result) => result.value));
      const entry = entries().find((entry) => loggedIds().has(entry.errorId));
      expect(entry).toEqual({ errorId: expect.stringMatching(/^[a-f0-9-]{36}$/), name: "Error", message: "SQLITE_BUSY: database is locked" });
      expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
      const noCause = withFailingSelect(ctx.db, () => { throw new Error("Failed query: insert secret\nparams: secret-edit-hash"); });
      const fallback = createApp({ db: noCause, config: ctx.config, limiter: false });
      expect((await fallback.request("/api/paths")).status).toBe(500);
      const fallbackEntry = entries().find((candidate) => loggedIds().has(candidate.errorId) && candidate.errorId !== entry.errorId);
      expect(fallbackEntry?.message).toBe("Database query failed");
      expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
    } finally { ctx.close(); }
  });

  it("reports config issues individually without a Zod stack", async () => {
    const { ConfigError } = await import("../src/config.js");
    try { loadConfig({ ADMIN_KEY: "short", PORT: "abc" }); throw new Error("expected failure"); }
    catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as InstanceType<typeof ConfigError>).lines).toHaveLength(2);
      expect((error as Error).message).toContain("Invalid config: ADMIN_KEY: must be at least 16 characters when set");
    }
  });

  it("accepts proxy booleans, rejects wildcard CORS and reads version outside cwd", () => {
    for (const value of ["true", "TRUE", "1", "yes", "YeS"]) expect(loadConfig({ TRUST_PROXY: value }).trustProxy).toBe(true);
    expect(() => loadConfig({ CORS_ORIGIN: "https://example.test, *" })).toThrow("Invalid config: CORS_ORIGIN: wildcard * is unsupported");
    vi.spyOn(process, "cwd").mockReturnValue("/tmp");
    expect(loadConfig({}).version).toBe("0.1.0");
    expect(loadConfig({}).staticDir).toBe("dist");
  });

  it("makes shutdown idempotent and forces exit after ten seconds", async () => {
    const { createShutdown } = await import("../src/lib/shutdown.js");
    vi.useFakeTimers();
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const close = vi.fn();
    const closeDb = vi.fn();
    const shutdown = createShutdown({ close }, closeDb);
    shutdown(); shutdown();
    expect(close).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(9999);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("closes the database and cancels the forced exit on graceful shutdown", async () => {
    const { createShutdown } = await import("../src/lib/shutdown.js");
    vi.useFakeTimers();
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const closeDb = vi.fn();
    const shutdown = createShutdown({ close: (callback) => callback() }, closeDb);
    shutdown(); shutdown();
    vi.advanceTimersByTime(10_000);
    expect(closeDb).toHaveBeenCalledTimes(1);
    expect(exit.mock.calls).toEqual([[0]]);
  });
});

describe("F1 boot and seed regressions", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("runs the real migrate module through tsx against a temporary database", async () => {
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { resolve, join } = await import("node:path");
    const { pathToFileURL } = await import("node:url");
    const dir = mkdtempSync(join(tmpdir(), "deepsim-f1-test-"));
    try {
      const source = `import {createDb} from ${JSON.stringify(pathToFileURL(resolve("server/src/db/client.ts")).href)};
        import {runMigrations} from ${JSON.stringify(pathToFileURL(resolve("server/src/db/migrate.ts")).href)};
        const db=await createDb(${JSON.stringify(`file:${join(dir, "test.sqlite")}`)});
        await runMigrations(db);
        const result=await db.$client.execute("select name from sqlite_master where type='table' order by name");
        console.log(JSON.stringify(result.rows)); db.$client.close();`;
      const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], { encoding: "utf8" });
      expect(output).toContain('"paths"'); expect(output).toContain('"votes"');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("honors MIGRATIONS_DIR and rejects directories without the journal", async () => {
    const { migrationsFolder } = await import("../src/db/migrate.js");
    vi.stubEnv("MIGRATIONS_DIR", "server/drizzle");
    expect(migrationsFolder()).toBe("server/drizzle");
    vi.stubEnv("MIGRATIONS_DIR", "server/src");
    expect(() => migrationsFolder()).toThrow("meta/_journal.json");
  });

  it("backfills Unicode search for rows from the old schema at migration time", async () => {
    const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { runMigrations } = await import("../src/db/migrate.js");
    const { paths } = await import("../src/db/schema.js");
    const dir = mkdtempSync(join(tmpdir(), "deepsim-old-schema-"));
    const db = await createDb("file::memory:");
    try {
      mkdirSync(join(dir, "meta"));
      const journal = JSON.parse(readFileSync("server/drizzle/meta/_journal.json", "utf8"));
      journal.entries = journal.entries.slice(0, 1);
      writeFileSync(join(dir, "meta/_journal.json"), JSON.stringify(journal));
      copyFileSync(`server/drizzle/${journal.entries[0].tag}.sql`, join(dir, `${journal.entries[0].tag}.sql`));
      await migrate(db, { migrationsFolder: dir });
      await db.$client.execute({ sql: "INSERT INTO paths (id,name,team_number,category,description,data,thumbnail,stats,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", args: ["old", "ÜNÏCODE", 12345, "Élite", "ΩMEGA", validDraft().data, "thumb", "{}", "2026-01-01", "2026-01-01"] });
      await runMigrations(db);
      const [row] = await db.select().from(paths);
      expect(row.searchText).toBe("ünïcode\nωmega\nélite\n12345");
      await runMigrations(db);
      expect((await db.select().from(paths))[0].searchText).toBe(row.searchText);
    } finally { db.$client.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  it("rolls back all seed inserts on failure and retries an empty database", async () => {
    const { seedIfEmpty } = await import("../src/db/seed.js");
    const { paths } = await import("../src/db/schema.js");
    const ctx = await createTestContext();
    try {
      await ctx.db.$client.execute("CREATE TRIGGER fail_seed BEFORE INSERT ON paths WHEN (SELECT count(*) FROM paths) >= 1 BEGIN SELECT RAISE(ABORT, 'injected seed failure'); END");
      await expect(seedIfEmpty(ctx.db, true)).rejects.toThrow();
      expect(await ctx.db.select().from(paths)).toHaveLength(0);
      await ctx.db.$client.execute("DROP TRIGGER fail_seed");
      await seedIfEmpty(ctx.db, true);
      const rows = await ctx.db.select().from(paths);
      expect(rows).toHaveLength(5);
      for (const row of rows) expect(row.searchText).toBe([row.name, row.description, row.category, row.teamNumber].join("\n").toLocaleLowerCase("und"));
      await seedIfEmpty(ctx.db, true);
      expect(await ctx.db.select().from(paths)).toHaveLength(5);
    } finally { ctx.close(); }
  });

  it("invalid config exits the real tsx entrypoint with exactly one line and no stack", async () => {
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(process.execPath, ["--import", "tsx", "server/src/index.ts"], {
      encoding: "utf8", env: { ...process.env, ADMIN_KEY: "short" },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Invalid config: ADMIN_KEY: must be at least 16 characters when set\n");
  });
});
