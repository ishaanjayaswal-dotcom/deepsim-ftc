import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default("127.0.0.1"),
  DATABASE_URL: z.string().default("file:./data/deepsim.db"),
  DATABASE_AUTH_TOKEN: z.string().optional(),
  ADMIN_KEY: z.string().min(16, "ADMIN_KEY must be at least 16 characters when set").optional(),
  CORS_ORIGIN: z.string().optional(),
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  SEED: z
    .string()
    .optional()
    .transform((v) => v !== "false" && v !== "0"),
  STATIC_DIR: z.string().optional(),
});

export type Config = {
  port: number;
  host: string;
  databaseUrl: string;
  databaseAuthToken?: string;
  adminKey?: string;
  corsOrigins: string[];
  trustProxy: boolean;
  seed: boolean;
  staticDir: string;
  version: string;
};

function readVersion(): string {
  try {
    const raw = readFileSync(join(process.cwd(), "package.json"), "utf8");
    return (JSON.parse(raw) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

function defaultStaticDir(): string {
  const dist = join(process.cwd(), "dist");
  return existsSync(dist) ? "dist" : "dist";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env);
  const corsOrigins = parsed.CORS_ORIGIN
    ? parsed.CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  return {
    port: parsed.PORT,
    host: parsed.HOST,
    databaseUrl: parsed.DATABASE_URL,
    databaseAuthToken: parsed.DATABASE_AUTH_TOKEN,
    adminKey: parsed.ADMIN_KEY,
    corsOrigins,
    trustProxy: parsed.TRUST_PROXY,
    seed: parsed.SEED,
    staticDir: parsed.STATIC_DIR ?? defaultStaticDir(),
    version: readVersion(),
  };
}
