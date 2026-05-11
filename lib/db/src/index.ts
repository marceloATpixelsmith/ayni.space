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

  if (isProductionLike)
  {
    return true;
  }

  if (!sslMode)
  {
    return false;
  }

  return sslMode !== "disable";
}

//FIX: SUPPORT RENDER/SELF-SIGNED POSTGRES CERTIFICATES
//WHEN DATABASE_URL CONTAINS sslmode=no-verify
//WE MUST ALLOW SELF-SIGNED CERTIFICATES.
function buildSslConfig(sslMode: string | null): PoolConfig["ssl"]
{
  if (!sslMode || sslMode === "disable")
  {
    return false;
  }

  //STRICT SSL VALIDATION
  if (
    sslMode === "require" ||
    sslMode === "verify-ca" ||
    sslMode === "verify-full"
  )
  {
    return {
      rejectUnauthorized: true,
    };
  }

  //ALLOW SELF-SIGNED CERTIFICATES
  if (sslMode === "no-verify")
  {
    return {
      rejectUnauthorized: false,
    };
  }

  //SAFE DEFAULT FOR PRODUCTION-LIKE ENVIRONMENTS
  return {
    rejectUnauthorized: true,
  };
}

export function buildDbPoolConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig
{
  const databaseUrl = env.DATABASE_URL ?? "";
  const sslMode = parseSslMode(databaseUrl);
  const useSsl = shouldUseSsl(env, sslMode);

  return {
    connectionString: databaseUrl,
    ssl: useSsl
      ? buildSslConfig(sslMode)
      : false,
  };
}

export const pool = new Pool(buildDbPoolConfig());

export const db = drizzle(pool, { schema });

export * from "./schema";
export { runMigrations } from "./migrate";
