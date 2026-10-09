import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";

export type AppDeps = { db: Db; config: Config };

export function createApp({ db: _db, config }: AppDeps): Hono {
  const app = new Hono();

  if (config.corsOrigins.length > 0) {
    app.use("*", async (c, next) => {
      const origin = c.req.header("Origin");
      if (origin && config.corsOrigins.includes(origin)) {
        c.header("Access-Control-Allow-Origin", origin);
        c.header("Vary", "Origin");
        c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
        c.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Edit-Key, X-Voter-Id");
      }
      if (c.req.method === "OPTIONS") {
        return c.body(null, 204);
      }
      await next();
    });
  }

  const api = new Hono();

  api.get("/health", (c) => c.json({ ok: true, version: config.version }));

  api.all("*", (c) => c.json({ error: "Not found" }, 404));

  app.route("/api", api);

  app.use("/assets/*", async (c, next) => {
    await next();
    if (c.res.status < 400) {
      c.header("Cache-Control", "public, max-age=31536000, immutable");
    }
  });

  app.use("*", serveStatic({ root: config.staticDir }));
  app.get("*", serveStatic({ root: config.staticDir, path: "index.html" }));

  app.onError((err, c) => {
    const message = err instanceof Error ? err.message : "Internal server error";
    const rawStatus =
      typeof err === "object" && err !== null && "status" in err && typeof err.status === "number"
        ? err.status
        : 500;
    const status = rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500;
    return c.json({ error: message }, status as 500);
  });

  return app;
}
