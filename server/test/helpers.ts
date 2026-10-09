import { migrate } from "drizzle-orm/libsql/migrator";
import { expect } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";
import { createDb, type Db } from "../src/db/client.js";
import { seedIfEmpty } from "../src/db/seed.js";
import type { RateBucket, RateLimiter } from "../src/lib/rateLimit.js";
import { createRateLimiter } from "../src/lib/rateLimit.js";
import type { PathDraft } from "../../src/repo/types.js";

/** POST /api/paths body (server ignores thumbnail and stats). */
export type ApiPathDraft = Pick<PathDraft, "name" | "teamNumber" | "category" | "description" | "data">;

export const ADMIN_KEY = "test-admin-secret-00";
export const VOTER_A = "voter-aaaa1111";
export const VOTER_B = "voter-bbbb2222";

/** Valid path source (Safe Park seed) for create/patch bodies. */
export const PARK_SOURCE = `{
  "name": "Safe Park · Red",
  "alliance": "red",
  "preload": "none",
  "path": [
    { "x": 9, "y": 40, "heading": 0 },
    { "x": 12, "y": 13, "heading": 0, "type": "bezier", "controlPoints": [[24, 30]], "action": "park" }
  ]
}`;

export function validDraft(overrides: Partial<ApiPathDraft> = {}): ApiPathDraft {
  return {
    name: "Contract Test Path",
    teamNumber: 12345,
    category: "Park Only",
    description: "integration test",
    data: PARK_SOURCE,
    ...overrides,
  };
}

export type TestContextOptions = {
  seed?: boolean;
  adminKey?: string;
  limiter?: RateLimiter | false;
  trustProxy?: boolean;
  corsOrigin?: string;
};

export type TestContext = {
  app: Hono;
  db: Db;
  config: Config;
  close: () => void;
};

export async function createTestContext(options: TestContextOptions = {}): Promise<TestContext> {
  const db = createDb("file::memory:");
  await migrate(db, { migrationsFolder: "server/drizzle" });

  const env: NodeJS.ProcessEnv = {
    SEED: options.seed ? "true" : "false",
    TRUST_PROXY: options.trustProxy ? "true" : "false",
  };
  if (options.adminKey !== undefined) env.ADMIN_KEY = options.adminKey;
  else if (options.seed) env.ADMIN_KEY = ADMIN_KEY;
  if (options.corsOrigin) env.CORS_ORIGIN = options.corsOrigin;

  const config = loadConfig(env);
  await seedIfEmpty(db, config.seed);

  const app = createApp({
    db,
    config,
    limiter: options.limiter === undefined ? false : options.limiter,
  });

  return {
    app,
    db,
    config,
    close: () => db.$client.close(),
  };
}

/** Per-bucket counter limiter for hardening tests (default production thresholds are too large). */
export function createTinyLimiter(maxPerBucket = 1): RateLimiter {
  const counts = new Map<string, number>();
  return {
    consume(ip: string, bucket: RateBucket) {
      const key = `${bucket}:${ip}`;
      const n = counts.get(key) ?? 0;
      if (n >= maxPerBucket) return { allowed: false, retryAfter: 42 };
      counts.set(key, n + 1);
      return { allowed: true, retryAfter: 42 };
    },
  };
}

export function createTimedLimiter(windowMs: number, now: () => number): RateLimiter {
  return createRateLimiter({ windowMs, now });
}

export function nodeBindings(ip: string) {
  return { incoming: { socket: { remoteAddress: ip } } };
}

export function assertNoEditKeyLeak(body: unknown) {
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/editKeyHash/i);
  expect(text).not.toMatch(/edit_key_hash/i);
}

export function withFailingSelect(db: Db, fail: () => boolean): Db {
  return new Proxy(db, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "select" && typeof value === "function") {
        return (...args: unknown[]) => {
          if (fail()) throw new Error("injected database failure");
          return value.apply(target, args);
        };
      }
      if (typeof value === "function") return value.bind(target);
      return value;
    },
  }) as Db;
}
