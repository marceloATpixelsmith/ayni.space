import session from "express-session";
import type { NextFunction, Request, Response } from "express";
import connectPgSimple from "connect-pg-simple";
import { pool } from "@workspace/db";
import { writeAuditLog } from "./audit.js";

const PgStore = connectPgSimple(session);

const DEFAULT_IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour inactivity timeout
const DEFAULT_ABSOLUTE_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hour absolute cap
const DEFAULT_PRUNE_INTERVAL_SECONDS = 15 * 60; // every 15 minutes

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getSessionPolicy() {
  const idleTimeoutMs = parsePositiveInt(process.env["SESSION_IDLE_TIMEOUT_MS"], DEFAULT_IDLE_TIMEOUT_MS);
  const absoluteTimeoutMs = parsePositiveInt(process.env["SESSION_ABSOLUTE_TIMEOUT_MS"], DEFAULT_ABSOLUTE_TIMEOUT_MS);
  const pruneIntervalSeconds = parsePositiveInt(process.env["SESSION_PRUNE_INTERVAL_SECONDS"], DEFAULT_PRUNE_INTERVAL_SECONDS);

  return {
    idleTimeoutMs,
    absoluteTimeoutMs,
    pruneIntervalSeconds,
    cookieSameSite: "lax" as const,
  };
}

export function buildSessionOptions(secret: string): session.SessionOptions {
  const policy = getSessionPolicy();

  return {
    store: new PgStore({
      pool,
      tableName: "sessions",
      createTableIfMissing: true,
      pruneSessionInterval: policy.pruneIntervalSeconds,
    }),
    secret,
    resave: false,
    saveUninitialized: false,
    rolling: true, // reset cookie idle maxAge on every response
    cookie: {
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      // Keep lax: strict is not safe with OAuth cross-site callback flow.
      sameSite: policy.cookieSameSite,
      maxAge: policy.idleTimeoutMs,
      path: "/",
      ...(process.env["SESSION_COOKIE_DOMAIN"] ? { domain: process.env["SESSION_COOKIE_DOMAIN"] } : {}),
    },
    name: "saas.sid",
  };
}

// Session middleware configured with PostgreSQL store for persistence
export function createSessionMiddleware() {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) {
    throw new Error("SESSION_SECRET environment variable is required");
  }

  return session(buildSessionOptions(secret));
}

export function sessionSecurityMiddleware(deps: { writeAuditLogFn?: typeof writeAuditLog } = {}) {
  const policy = getSessionPolicy();

  return function sessionSecurity(req: Request, res: Response, next: NextFunction) {
    const now = Date.now();

    if (!req.session.sessionCreatedAt) {
      req.session.sessionCreatedAt = now;
    }

    if (req.session.userId && !req.session.sessionAuthenticatedAt) {
      req.session.sessionAuthenticatedAt = now;
    }

    const absoluteStart = req.session.sessionAuthenticatedAt ?? req.session.sessionCreatedAt;
    if (absoluteStart && now - absoluteStart > policy.absoluteTimeoutMs) {
      req.session.destroy(() => {
        res.clearCookie("saas.sid");
        res.status(401).json({ error: "Session expired. Please sign in again." });
      });
      return;
    }

    if (req.session.userId) {
      const currentIp = req.ip || undefined;
      const currentUserAgent = req.get("user-agent") || undefined;

      const lastIp = req.session.lastIp;
      const lastUserAgent = req.session.lastUserAgent;

      const ipChanged = Boolean(lastIp && currentIp && lastIp !== currentIp);
      const userAgentChanged = Boolean(lastUserAgent && currentUserAgent && lastUserAgent !== currentUserAgent);

      if (ipChanged || userAgentChanged) {
        const writeAuditLogFn = deps.writeAuditLogFn ?? writeAuditLog;
        writeAuditLogFn({
          userId: req.session.userId,
          action: "session.anomaly_observed",
          resourceType: "session",
          resourceId: req.session.id,
          metadata: {
            lastIp,
            currentIp,
            lastUserAgent,
            currentUserAgent,
            ipChanged,
            userAgentChanged,
          },
          req,
        });
      }

      req.session.lastIp = currentIp;
      req.session.lastUserAgent = currentUserAgent;
      req.session.lastSeenAt = now;
    }

    next();
  };
}

// Helper to rotate session on privilege/org changes
export function rotateSession(req: Request, cb: (err?: unknown) => void) {
  req.session.regenerate((err?: unknown) => {
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
    sessionCreatedAt?: number;
    sessionAuthenticatedAt?: number;
    lastSeenAt?: number;
    lastIp?: string;
    lastUserAgent?: string;
  }
}
