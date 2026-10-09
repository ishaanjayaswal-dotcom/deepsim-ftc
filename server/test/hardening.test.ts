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
      const ok = await post("198.51.100.10");
      expect(ok.status).toBe(201);
      const limited = await post("198.51.100.10");
      expect(limited.status).toBe(429);
      expect(limited.headers.get("Retry-After")).toBe("42");
      expect(await limited.json()).toEqual({ error: "Too many requests" });
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
      const db = createDb("file::memory:");
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
