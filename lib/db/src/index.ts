import { drizzle } from "drizzle-orm/node-postgres";
import pg, { type PoolConfig } from "pg";
import * as schema from "./schema";

function shouldSkipCertificateValidation(databaseUrl: string): boolean
{
  try
  {
    const parsed = new URL(databaseUrl);
    const sslMode = parsed.searchParams.get("sslmode")?.toLowerCase();

    return sslMode === "require" || sslMode === "no-verify";
  }
  catch
  {
    return false;
  }
}
const { Pool } = pg;

if (!process.env.DATABASE_URL)
{
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export function buildDbPoolConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig
{
  const nodeEnv = env.NODE_ENV ?? "development";
  const isProduction = nodeEnv === "production";

  const databaseUrl = env.DATABASE_URL ?? "";
  const productionSslConfig = shouldSkipCertificateValidation(databaseUrl)
    ? { rejectUnauthorized: false }
    : { rejectUnauthorized: true };

  return {
    connectionString: databaseUrl,
    // Production keeps certificate validation enabled by default. We only
    // downgrade to encrypted/no-verify mode when DATABASE_URL explicitly
    // requests sslmode=require or sslmode=no-verify (managed providers with
    // private/self-signed certificate chains).
    ssl: isProduction ? productionSslConfig : false,
  };
}

export const pool = new Pool(buildDbPoolConfig());

export const db = drizzle(pool, { schema });

export * from "./schema";
export { runMigrations } from "./migrate";
