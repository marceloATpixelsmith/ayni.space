import type { Request, RequestHandler } from "express";
import { pool } from "@workspace/db";
import { infoVerboseTrace } from "../lib/traceLogging.js";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

const configuredRateLimitEnabled = process.env.RATE_LIMIT_ENABLED;
const RATE_LIMIT_ENABLED =
  configuredRateLimitEnabled === undefined
    ? isProduction()
    : configuredRateLimitEnabled === "true";
const RATE_LIMIT_ALLOW_DISABLE_IN_PRODUCTION = process.env.RATE_LIMIT_ALLOW_DISABLE_IN_PRODUCTION === "true";
const DEFAULT_WINDOW_MS = Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "60000", 10);
const DEFAULT_MAX = Number.parseInt(process.env.RATE_LIMIT_MAX ?? "30", 10);
const DEFAULT_AUTH_MAX = Number.parseInt(process.env.AUTH_RATE_LIMIT_MAX ?? "10", 10);

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

type RateLimitConsumeResult =
  | { limited: false }
  | { limited: true; retryAfterSeconds: number };

type RateLimitStore = {
  consume: (key: string, now: number, windowMs: number, max: number) => Promise<RateLimitConsumeResult>;
};

function getClientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

const memoryStore: RateLimitStore = {
  async consume(key, now, windowMs, max) {
    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { limited: false };
    }

    if (current.count >= max) {
      return {
        limited: true,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
      };
    }

    current.count += 1;
    return { limited: false };
  },
};

const postgresStore: RateLimitStore = {
  async consume(key, now, windowMs, max) {
    const result = await pool.query<{ count: number; retry_after_seconds: number }>(
      `
        INSERT INTO platform.rate_limits AS rl (bucket_key, window_started_at, count)
        VALUES ($1, to_timestamp($2::double precision / 1000.0), 1)
        ON CONFLICT (bucket_key)
        DO UPDATE
        SET
          count = CASE
            WHEN rl.window_started_at <= to_timestamp(($2 - $3)::double precision / 1000.0) THEN 1
            ELSE rl.count + 1
          END,
          window_started_at = CASE
            WHEN rl.window_started_at <= to_timestamp(($2 - $3)::double precision / 1000.0)
              THEN to_timestamp($2::double precision / 1000.0)
            ELSE rl.window_started_at
          END,
          updated_at = now()
        RETURNING
          count,
          GREATEST(
            1,
            CEIL(
              EXTRACT(EPOCH FROM (window_started_at + (($3 || ' milliseconds')::interval - to_timestamp($2::double precision / 1000.0))))
            )::int
          ) AS retry_after_seconds
      `,
      [key, now, windowMs],
    );

    const row = result.rows[0];
    if (!row || row.count <= max) return { limited: false };
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Number(row.retry_after_seconds) || 1),
    };
  },
};

let rateLimitStoreOverride: RateLimitStore | null = null;

function getRateLimitStore(): RateLimitStore {
  if (rateLimitStoreOverride) return rateLimitStoreOverride;
  if (isProduction()) return postgresStore;
  return memoryStore;
}

export function setRateLimitStoreForTests(store: RateLimitStore | null): void {
  rateLimitStoreOverride = store;
}

export type RateLimitOptions = {
  windowMs?: number;
  max?: number;
  keyPrefix?: string;
  skip?: (req: Parameters<RequestHandler>[0]) => boolean;
};

export function rateLimiter(options: RateLimitOptions = {}): RequestHandler {
  if (!RATE_LIMIT_ENABLED && (!isProduction() || RATE_LIMIT_ALLOW_DISABLE_IN_PRODUCTION)) {
    return (_req, _res, next) => next();
  }

  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const max = options.max ?? DEFAULT_MAX;
  const keyPrefix = options.keyPrefix ?? "default";
  const skip = options.skip;

  return (req, res, next) => {
    if (skip?.(req)) {
      next();
      return;
    }

    const now = Date.now();
    const key = `${keyPrefix}:${getClientKey(req)}`;
    getRateLimitStore()
      .consume(key, now, windowMs, max)
      .then((result) => {
        if (result.limited) {
          const retryAfterSeconds = result.retryAfterSeconds;
          res.setHeader("Retry-After", String(retryAfterSeconds));
          if (keyPrefix === "auth-google-url" || keyPrefix.startsWith("test-auth-google-url")) {
            infoVerboseTrace("[auth/google/url]", {
              branch: "rate_limited",
              method: req.method,
              path: req.path,
              origin: typeof req.headers["origin"] === "string" ? req.headers["origin"] : null,
              resolvedSessionGroup: req.resolvedSessionGroup ?? null,
              keyPrefix,
              retryAfterSeconds,
              status: 429,
              code: "RATE_LIMITED",
            });
          }
          res.status(429).json({ error: "Too many requests, please try again later.", code: "RATE_LIMITED" });
          return;
        }

        next();
      })
      .catch((error) => {
        if (isProduction()) {
          console.error("[rate-limit] distributed limiter failure", error);
          res.status(503).json({ error: "Request throttling is temporarily unavailable.", code: "RATE_LIMIT_UNAVAILABLE" });
          return;
        }

        memoryStore
          .consume(key, now, windowMs, max)
          .then((fallbackResult) => {
            if (fallbackResult.limited) {
              res.setHeader("Retry-After", String(fallbackResult.retryAfterSeconds));
              res.status(429).json({ error: "Too many requests, please try again later.", code: "RATE_LIMITED" });
              return;
            }
            next();
          })
          .catch(() => {
            res.status(503).json({ error: "Request throttling is temporarily unavailable.", code: "RATE_LIMIT_UNAVAILABLE" });
          });
      });
  };
}

export function authRateLimiter(options: RateLimitOptions = {}): RequestHandler {
  return rateLimiter({
    max: options.max ?? DEFAULT_AUTH_MAX,
    windowMs: options.windowMs ?? DEFAULT_WINDOW_MS,
    keyPrefix: options.keyPrefix ?? "auth",
  });
}

export type AuthRateLimiterWithIdentifierOptions = RateLimitOptions & {
  opaqueIdentifier?: (req: Parameters<RequestHandler>[0]) => string | null;
};

export function authRateLimiterWithIdentifier(options: AuthRateLimiterWithIdentifierOptions = {}): RequestHandler {
  const ipLimiter = authRateLimiter(options);
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const max = options.max ?? DEFAULT_AUTH_MAX;
  const keyPrefix = options.keyPrefix ?? "auth";
  const opaqueIdentifier = options.opaqueIdentifier;
  const skip = options.skip;

  return (req, res, next) => {
    if (skip?.(req)) {
      next();
      return;
    }

    ipLimiter(req, res, () => {
      const opaqueId = opaqueIdentifier?.(req);
      if (!opaqueId) {
        next();
        return;
      }

      const key = `${keyPrefix}:opaque:${opaqueId}`;
      getRateLimitStore()
        .consume(key, Date.now(), windowMs, max)
        .then((result) => {
          if (result.limited) {
            res.setHeader("Retry-After", String(result.retryAfterSeconds));
            res.status(429).json({ error: "Too many requests, please try again later.", code: "RATE_LIMITED" });
            return;
          }

          next();
        })
        .catch((error) => {
          if (isProduction()) {
            console.error("[rate-limit] distributed identifier limiter failure", error);
            res.status(503).json({ error: "Request throttling is temporarily unavailable.", code: "RATE_LIMIT_UNAVAILABLE" });
            return;
          }

          memoryStore
            .consume(key, Date.now(), windowMs, max)
            .then((fallbackResult) => {
              if (fallbackResult.limited) {
                res.setHeader("Retry-After", String(fallbackResult.retryAfterSeconds));
                res.status(429).json({ error: "Too many requests, please try again later.", code: "RATE_LIMITED" });
                return;
              }
              next();
            })
            .catch(() => {
              res.status(503).json({ error: "Request throttling is temporarily unavailable.", code: "RATE_LIMIT_UNAVAILABLE" });
            });
        });
    });
  };
}
