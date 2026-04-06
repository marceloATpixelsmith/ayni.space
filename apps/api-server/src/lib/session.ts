import session from "express-session";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import connectPgSimple from "connect-pg-simple";
import { randomUUID } from "crypto";
import { pool } from "@workspace/db";
import { writeAuditLog } from "./audit.js";
import { getKnownSessionGroups, getSessionCookieNameForGroup, resolveSessionGroupForRequest, SESSION_GROUPS } from "./sessionGroup.js";
import { logVerboseTrace } from "./traceLogging.js";

const PgStore = connectPgSimple(session);

const DEFAULT_IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour inactivity timeout
const DEFAULT_ABSOLUTE_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hour absolute cap
const STAY_LOGGED_IN_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const DEFAULT_PRUNE_INTERVAL_SECONDS = 15 * 60; // every 15 minutes
export const SESSION_STORE_SCHEMA_NAME = "platform";
export const SESSION_STORE_TABLE_NAME = "sessions";
export const SESSION_STORE_CREATE_TABLE_IF_MISSING = false;
const SESSION_TABLE_FQN = `${SESSION_STORE_SCHEMA_NAME}.${SESSION_STORE_TABLE_NAME}`;
const ENSURE_SESSION_SCHEMA_SQL = `CREATE SCHEMA IF NOT EXISTS ${SESSION_STORE_SCHEMA_NAME}`;
const ENSURE_SESSION_TABLE_SQL = `CREATE TABLE IF NOT EXISTS ${SESSION_TABLE_FQN} (
  sid varchar NOT NULL PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
)`;
const ENSURE_SESSION_EXPIRE_INDEX_SQL = `CREATE INDEX IF NOT EXISTS sessions_expire_idx ON ${SESSION_TABLE_FQN}(expire)`;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getSessionPolicy() {
  const idleTimeoutMs = parsePositiveInt(process.env["SESSION_IDLE_TIMEOUT_MS"], DEFAULT_IDLE_TIMEOUT_MS);
  const absoluteTimeoutMs = parsePositiveInt(process.env["SESSION_ABSOLUTE_TIMEOUT_MS"], DEFAULT_ABSOLUTE_TIMEOUT_MS);
  const pruneIntervalSeconds = parsePositiveInt(process.env["SESSION_PRUNE_INTERVAL_SECONDS"], DEFAULT_PRUNE_INTERVAL_SECONDS);

  const configuredSameSite = (process.env["SESSION_COOKIE_SAME_SITE"] ?? "").trim().toLowerCase();
  const cookieSameSite = configuredSameSite === "lax" || configuredSameSite === "strict" || configuredSameSite === "none"
    ? configuredSameSite
    : (process.env["NODE_ENV"] === "production" ? "none" : "lax");

  return {
    idleTimeoutMs,
    absoluteTimeoutMs,
    pruneIntervalSeconds,
    cookieSameSite: cookieSameSite as "lax" | "strict" | "none",
  };
}

export function getSessionCookieOptions() {
  const policy = getSessionPolicy();
  return {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: policy.cookieSameSite,
    path: "/",
    ...(process.env["SESSION_COOKIE_DOMAIN"] ? { domain: process.env["SESSION_COOKIE_DOMAIN"] } : {}),
  } as const;
}



export function logSessionCookieConfig() {
  const cookieOptions = getSessionCookieOptions();
  logVerboseTrace(
    `[AUTH-CHECK-TRACE] COOKIE CONFIG ` +
    `sameSite=${String(cookieOptions.sameSite ?? "null")} ` +
    `secure=${String(cookieOptions.secure ?? false)} ` +
    `domain=${String(cookieOptions.domain ?? "null")} ` +
    `path=${String(cookieOptions.path ?? "null")}`
  );
}

export function getSessionCookieName(sessionGroup: string = SESSION_GROUPS.DEFAULT) {
  return getSessionCookieNameForGroup(sessionGroup);
}

export function getSessionStoreConfig() {
  const policy = getSessionPolicy();
  return {
    pool,
    schemaName: SESSION_STORE_SCHEMA_NAME,
    tableName: SESSION_STORE_TABLE_NAME,
    createTableIfMissing: SESSION_STORE_CREATE_TABLE_IF_MISSING,
    pruneSessionInterval: policy.pruneIntervalSeconds,
  } as const;
}

export async function ensureSessionStoreInfrastructure() {
  await pool.query(ENSURE_SESSION_SCHEMA_SQL);
  await pool.query(ENSURE_SESSION_TABLE_SQL);
  await pool.query(ENSURE_SESSION_EXPIRE_INDEX_SQL);
}

export function getStayLoggedInMaxAgeMs() {
  return STAY_LOGGED_IN_MAX_AGE_MS;
}

export function applySessionPersistence(req: Request, stayLoggedIn: boolean) {
  req.session.stayLoggedIn = stayLoggedIn;
  if (!req.session.cookie) {
    (req.session as { cookie?: { maxAge?: number } }).cookie = {};
  }
  req.session.cookie.maxAge = stayLoggedIn ? STAY_LOGGED_IN_MAX_AGE_MS : getSessionPolicy().idleTimeoutMs;
}

export function getDeleteOtherSessionsSql() {
  return `DELETE FROM ${SESSION_STORE_SCHEMA_NAME}.${SESSION_STORE_TABLE_NAME} WHERE sess::jsonb->>'userId' = $1 AND sid != $2 AND COALESCE(sess::jsonb->>'sessionGroup', '${SESSION_GROUPS.DEFAULT}') = $3`;
}

export function getDeleteAllOtherSessionsForUserSql() {
  return `DELETE FROM ${SESSION_STORE_SCHEMA_NAME}.${SESSION_STORE_TABLE_NAME} WHERE sess::jsonb->>'userId' = $1 AND sid != $2`;
}

export async function revokeOtherSessionsForUser(userId: string, currentSid: string, sessionGroup: string) {
  await pool.query(getDeleteOtherSessionsSql(), [userId, currentSid, sessionGroup]);
}

export function clearSessionCookie(res: Response, sessionGroup: string = SESSION_GROUPS.DEFAULT) {
  res.clearCookie(getSessionCookieName(sessionGroup), getSessionCookieOptions());
}

export function destroySessionAndClearCookie(req: Request, res: Response, sessionGroup: string = SESSION_GROUPS.DEFAULT): Promise<void> {
  return new Promise((resolve, reject) => {
    const currentSession = req.session;
    if (!currentSession) {
      clearSessionCookie(res, sessionGroup);
      (req as { session: unknown }).session = null;
      resolve();
      return;
    }

    currentSession.destroy((err?: unknown) => {
      clearSessionCookie(res, sessionGroup);
      (req as { session: unknown }).session = null;
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

export function buildSessionOptions(secret: string, sessionGroup: string = SESSION_GROUPS.DEFAULT): session.SessionOptions {
  const policy = getSessionPolicy();
  const sessionStoreConfig = getSessionStoreConfig();

  return {
    store: new PgStore(sessionStoreConfig),
    secret,
    resave: false,
    saveUninitialized: false,
    rolling: true, // reset cookie idle maxAge on every response
    cookie: {
      ...getSessionCookieOptions(),
      maxAge: policy.idleTimeoutMs,
    },
    name: getSessionCookieName(sessionGroup),
    genid: () => `${sessionGroup}.${randomUUID()}`,
  };
}

function buildPerGroupSessionHandlers(secret: string): Map<string, RequestHandler> {
  const middlewareByGroup = new Map<string, RequestHandler>();
  for (const sessionGroup of getKnownSessionGroups()) {
    middlewareByGroup.set(sessionGroup, session(buildSessionOptions(secret, sessionGroup)));
  }

  if (!middlewareByGroup.has(SESSION_GROUPS.DEFAULT)) {
    middlewareByGroup.set(SESSION_GROUPS.DEFAULT, session(buildSessionOptions(secret, SESSION_GROUPS.DEFAULT)));
  }

  return middlewareByGroup;
}

// Session middleware configured with PostgreSQL store for persistence.
// Session-group selection is request-scoped (origin/cookie/state aware), not process-scoped.
export function createSessionMiddleware(overrideHandlers?: Map<string, RequestHandler>) {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) {
    throw new Error("SESSION_SECRET environment variable is required");
  }

  const middlewareByGroup = overrideHandlers ?? buildPerGroupSessionHandlers(secret);

  return (req: Request, res: Response, next: NextFunction) => {
    const resolution = resolveSessionGroupForRequest(req, { failOnAmbiguous: true });

    if (!resolution.ok) {
      res.status(400).json({ error: "Unable to resolve session group for request" });
      return;
    }

    const sessionGroup = resolution.sessionGroup;
    const middleware = middlewareByGroup.get(sessionGroup) ?? middlewareByGroup.get(SESSION_GROUPS.DEFAULT);

    if (!middleware) {
      next(new Error("Session middleware is not configured for resolved session group"));
      return;
    }

    middleware(req, res, (err?: unknown) => {
      if (err) {
        next(err as Error);
        return;
      }

      req.session.sessionGroup = sessionGroup;
      req.resolvedSessionGroup = sessionGroup;
      req.sessionGroupResolutionSource = resolution.source;
      next();
    });
  };
}

export function sessionSecurityMiddleware(
  deps: { writeAuditLogFn?: (entry: Parameters<typeof writeAuditLog>[0]) => void | Promise<void> } = {},
) {
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
      void destroySessionAndClearCookie(req, res, req.session.sessionGroup ?? SESSION_GROUPS.DEFAULT)
        .catch(() => {
          // Fail closed even if backing store destroy fails.
        })
        .finally(() => {
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
        void writeAuditLogFn({
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
    isSuperAdmin?: boolean;
    appSlug?: string;
    oauthState?: string;
    oauthReturnTo?: string;
    oauthReturnToPath?: string;
    oauthSessionGroup?: string;
    oauthAppSlug?: string;
    pendingUserId?: string;
    pendingAppSlug?: string;
    pendingMfaReason?: "enrollment_required" | "challenge_required";
    pendingStayLoggedIn?: boolean;
    pendingReturnToPath?: string;
    authFlowId?: string;
    oauthStayLoggedIn?: boolean;
    stayLoggedIn?: boolean;
    sessionGroup?: string;
    sessionCreatedAt?: number;
    sessionAuthenticatedAt?: number;
    lastSeenAt?: number;
    lastIp?: string;
    lastUserAgent?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      resolvedSessionGroup?: string;
      sessionGroupResolutionSource?: "origin" | "cookie" | "state" | "app" | "default";
    }
  }
}
