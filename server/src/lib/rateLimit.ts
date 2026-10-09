import { getConnInfo } from "@hono/node-server/conninfo";
import { isIP } from "node:net";
import type { Context, MiddlewareHandler } from "hono";

export type RateBucket = "create" | "edit" | "upvote" | "read";
export type RateLimiter = {
  consume(ip: string, bucket: RateBucket): { allowed: boolean; retryAfter: number };
};

const limits: Record<RateBucket, number> = { create: 20, edit: 60, upvote: 120, read: 600 };

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
        // Admit new identities by evicting the oldest fixed window at capacity.
        if (windows.size >= maxEntries) {
          windows.delete(windows.keys().next().value!);
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

export function canonicalIp(ip: string): string {
  ip = ip.replace(/%.*$/, "");
  if (isIP(ip) !== 6) return ip;
  let canonical: string;
  try { canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1); }
  catch { return ip; }
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1], 16);
  const low = parseInt(mapped[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header("X-Forwarded-For")?.split(",").at(-1)?.trim();
    // The trusted proxy must append a bare IP, rather than ip:port.
    if (forwarded && isIP(forwarded.replace(/%.*$/, ""))) return canonicalIp(forwarded);
  }
  // app.request() has no Node socket; all such requests share a test identity.
  if (!c.env?.incoming && !c.env?.server?.incoming) return "unknown";
  return canonicalIp(getConnInfo(c).remote.address ?? "unknown");
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
