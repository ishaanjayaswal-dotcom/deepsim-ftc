import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default("127.0.0.1"),
  DATABASE_URL: z.string().default("file:./data/deepsim.db"),
  DATABASE_AUTH_TOKEN: z.string().optional(),
  ADMIN_KEY: z.string().min(16, "must be at least 16 characters when set").optional(),
  CORS_ORIGIN: z.string().refine((v) => !v.split(",").some((origin) => origin.trim() === "*"), "wildcard * is unsupported; specify explicit origins").optional(),
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) => ["true", "1", "yes"].includes(v?.toLowerCase() ?? "")),
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
    const raw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"), "utf8");
    return (JSON.parse(raw) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

export class ConfigError extends Error {
  constructor(public readonly lines: string[]) {
    super(lines.join("\n"));
    this.name = "ConfigError";
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((issue) => `Invalid config: ${issue.path.join(".")}: ${issue.message}`));
  }
  const parsed = result.data;
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
    staticDir: parsed.STATIC_DIR ?? "dist",
    version: readVersion(),
  };
}
