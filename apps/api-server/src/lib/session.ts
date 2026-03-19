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
    rolling: true, // Reset maxAge on every response (idle timeout)
    cookie: {
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      // OAuth returns from google.com are cross-site navigations, so strict would drop session cookie
      sameSite: "lax",
      maxAge: 60 * 60 * 1000, // 1 hour absolute timeout
      path: "/",
      // Optionally set domain from env
      ...(process.env["SESSION_COOKIE_DOMAIN"] ? { domain: process.env["SESSION_COOKIE_DOMAIN"] } : {}),
    },
    name: "saas.sid",
  });
}

// Helper to rotate session on privilege/org changes
export function rotateSession(req, cb) {
  req.session.regenerate((err) => {
    if (err) return cb(err);
    cb();
  });
}

// Extend express-session types
declare module "express-session" {
  interface SessionData {
    userId?: string;
    activeOrgId?: string;
    oauthState?: string;
    oauthReturnTo?: string;
  }
}
