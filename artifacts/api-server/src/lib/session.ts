import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "@workspace/db";

const PgStore = connectPgSimple(session);

// Session middleware configured with PostgreSQL store for persistence
export function createSessionMiddleware() {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) {
    throw new Error("SESSION_SECRET environment variable is required");
  }

  return session({
    store: new PgStore({
      pool,
      tableName: "sessions",
      createTableIfMissing: true,
    }),
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
    name: "saas.sid",
  });
}

// Extend express-session types
declare module "express-session" {
  interface SessionData {
    userId?: string;
    activeOrgId?: string;
    oauthState?: string;
  }
}
