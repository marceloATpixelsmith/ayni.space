import { drizzle } from "drizzle-orm/node-postgres";
import pg, { type PoolConfig } from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL)
{
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

function parseSslMode(databaseUrl: string): string | null
{
  try
  {
    return new URL(databaseUrl).searchParams.get("sslmode")?.toLowerCase() ?? null;
  }
  catch
  {
    return null;
  }
}

function shouldUseSsl(env: NodeJS.ProcessEnv, sslMode: string | null): boolean
{
  const nodeEnv = env.NODE_ENV ?? "development";
  const isProductionLike = nodeEnv === "production" || env.CI === "true";
  if (isProductionLike) return true;

  if (!sslMode) return false;
  return sslMode !== "disable";
}

export function buildDbPoolConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig
{
  const databaseUrl = env.DATABASE_URL ?? "";
  const sslMode = parseSslMode(databaseUrl);
  const useSsl = shouldUseSsl(env, sslMode);

  return {
    connectionString: databaseUrl,
    ssl: useSsl ? { rejectUnauthorized: true } : false,
  };
}

export const pool = new Pool(buildDbPoolConfig());

export const db = drizzle(pool, { schema });

export * from "./schema";
export { runMigrations } from "./migrate";
