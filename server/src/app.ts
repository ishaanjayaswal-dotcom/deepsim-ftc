import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createRateLimiter, type RateLimiter, rateLimit } from "./lib/rateLimit.js";
import { HTTPException } from "hono/http-exception";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { createPathsRoutes } from "./routes/paths.js";

export type AppDeps = { db: Db; config: Config; limiter?: RateLimiter | false };

export function createApp({ db, config, limiter = createRateLimiter() }: AppDeps): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    const start = performance.now();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("X-Frame-Options", "DENY");
    await next();
    if (!c.req.path.startsWith("/assets/")) {
      // No query string, headers or request/response bodies (credentials live there).
      console.log(`${c.req.method} ${c.req.path.replace(/[\x00-\x1f\x7f]/g, "?")} ${c.res.status} ${(performance.now() - start).toFixed(1)}ms`);
    }
  });

  if (config.corsOrigins.length > 0) {
    app.use("*", async (c, next) => {
      c.header("Vary", "Origin");
      const origin = c.req.header("Origin");
      if (origin && config.corsOrigins.includes(origin)) {
        c.header("Access-Control-Allow-Origin", origin);
        c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
        c.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Edit-Key, X-Voter-Id");
      }
      if (c.req.method === "OPTIONS") {
        return c.body(null, 204);
      }
      await next();
    });
  }

  app.use("/api/*", bodyLimit({
    maxSize: 128 * 1024,
    onError: (c) => c.json({ error: "Request body must be at most 128 KB" }, 413),
  }));

  const api = new Hono();

  api.use("*", async (c, next) => {
    if (c.req.method === "GET" && c.req.path !== "/api/health") return rateLimit(limiter, "read", config.trustProxy)(c, next);
    await next();
  });

  api.get("/health", (c) => c.json({ ok: true, version: config.version }));
  api.route("/paths", createPathsRoutes({ db, config, limiter }));

  api.all("*", (c) => c.json({ error: "Not found" }, 404));

  app.route("/api", api);

  app.use("/assets/*", async (c, next) => {
    await next();
    if (c.res.status < 400) {
      c.header("Cache-Control", "public, max-age=31536000, immutable");
    }
  });

  // API-only when the web app has not been built (dev, tests): nothing to serve, nothing to warn about.
  if (existsSync(config.staticDir)) {
    app.use("*", serveStatic({ root: config.staticDir }));
    app.get("*", serveStatic({ root: config.staticDir, path: "index.html" }));
  }

  app.onError((err, c) => {
    if (err instanceof HTTPException && err.status < 500) {
      return c.json({ error: err.message }, err.status);
    }
    const errorId = randomUUID();
    // Drizzle messages embed SQL and parameters. Log the underlying cause instead.
    const detail = err.cause instanceof Error ? err.cause : err;
    const message = /^Failed query:/i.test(detail.message)
      ? "Database query failed"
      : detail.message.split(/\n(?:Failed query:|params:)/i)[0];
    console.error(JSON.stringify({ errorId, name: detail.name, message }));
    return c.json({ error: "Internal server error" }, err instanceof HTTPException ? err.status : 500);
  });

  return app;
}
