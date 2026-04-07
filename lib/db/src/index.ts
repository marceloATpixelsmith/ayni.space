import { drizzle } from "drizzle-orm/node-postgres";
import pg, { type PoolConfig } from "pg";
import * as schema from "./schema";

function shouldSkipCertificateValidation(databaseUrl: string, env: NodeJS.ProcessEnv): boolean
{
  try
  {
    const parsed = new URL(databaseUrl);
    const sslMode = parsed.searchParams.get("sslmode")?.toLowerCase();

    if (sslMode === "require" || sslMode === "no-verify")
    {
      return true;
    }

    if (sslMode === "verify-ca" || sslMode === "verify-full")
    {
      return false;
    }

    // Render-managed Postgres commonly presents a private/self-signed chain
    // at runtime even when DATABASE_URL omits sslmode, so we default to
    // encrypted/no-verify in that environment to prevent startup failures.
    const isRenderRuntime = env.RENDER === "true" || env.RENDER_SERVICE_ID !== undefined;

    return isRenderRuntime;
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
  const productionSslConfig = shouldSkipCertificateValidation(databaseUrl, env)
    ? { rejectUnauthorized: false }
    : { rejectUnauthorized: true };

  return {
    connectionString: databaseUrl,
    // Production keeps certificate validation enabled by default. We downgrade
    // to encrypted/no-verify for explicit sslmode=require|no-verify or when
    // running on Render-managed runtime where private/self-signed chains are
    // expected unless sslmode explicitly opts into certificate verification.
    ssl: isProduction ? productionSslConfig : false,
  };
}

export const pool = new Pool(buildDbPoolConfig());

export const db = drizzle(pool, { schema });

export * from "./schema";
export { runMigrations } from "./migrate";
