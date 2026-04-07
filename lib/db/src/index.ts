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

export function buildDbPoolConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig
{
  const nodeEnv = env.NODE_ENV ?? "development";
  const isProduction = nodeEnv === "production";

  return {
    connectionString: env.DATABASE_URL,
    // Production must perform CA/certificate chain validation. Non-production
    // intentionally disables TLS for local ergonomics unless developers opt in
    // via DATABASE_URL parameters.
    ssl: isProduction ? { rejectUnauthorized: true } : false,
  };
}

export const pool = new Pool(buildDbPoolConfig());

export const db = drizzle(pool, { schema });

export * from "./schema";
export { runMigrations } from "./migrate";
