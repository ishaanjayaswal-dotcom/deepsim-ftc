import { getConnInfo } from "@hono/node-server/conninfo";
import { isIP } from "node:net";
import type { Context, MiddlewareHandler } from "hono";

export type RateBucket = "create" | "edit" | "upvote";
export type RateLimiter = {
  consume(ip: string, bucket: RateBucket): { allowed: boolean; retryAfter: number };
};

const limits: Record<RateBucket, number> = { create: 20, edit: 60, upvote: 120 };

export function createRateLimiter({
  windowMs = 10 * 60 * 1000,
  now = Date.now,
  maxEntries = 10_000,
}: { windowMs?: number; now?: () => number; maxEntries?: number } = {}): RateLimiter {
  if (!Number.isFinite(windowMs) || windowMs <= 0 || !Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error("Rate limiter requires a positive window and entry capacity");
  }
  const windows = new Map<string, { count: number; expires: number }>();
  return {
    consume(ip, bucket) {
      const time = now();
      // All windows have the same duration and insertion order is expiry order.
      for (const [key, entry] of windows) {
        if (entry.expires > time) break;
        windows.delete(key);
      }
      const key = `${bucket}:${ip}`;
      let entry = windows.get(key);
      if (!entry) {
        // Do not evict active windows: doing so would let clients bypass limits.
        if (windows.size >= maxEntries) {
          const oldest = windows.values().next().value!;
          return { allowed: false, retryAfter: Math.max(1, Math.ceil((oldest.expires - time) / 1000)) };
        }
        entry = { count: 0, expires: time + windowMs };
        windows.set(key, entry);
      }
      const allowed = entry.count < limits[bucket];
      if (allowed) entry.count += 1;
      return { allowed, retryAfter: Math.max(1, Math.ceil((entry.expires - time) / 1000)) };
    },
  };
}

export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header("X-Forwarded-For")?.split(",", 1)[0]?.trim();
    if (forwarded && isIP(forwarded)) return forwarded;
  }
  // app.request() has no Node socket; all such requests share a test identity.
  if (!c.env?.incoming && !c.env?.server?.incoming) return "unknown";
  return getConnInfo(c).remote.address ?? "unknown";
}

export function rateLimit(limiter: RateLimiter | false, bucket: RateBucket, trustProxy: boolean): MiddlewareHandler {
  return async (c, next) => {
    if (limiter) {
      const result = limiter.consume(clientIp(c, trustProxy), bucket);
      if (!result.allowed) {
        c.header("Retry-After", String(result.retryAfter));
        return c.json({ error: "Too many requests" }, 429);
      }
    }
    await next();
  };
}
