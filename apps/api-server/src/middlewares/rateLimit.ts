import type { RequestHandler } from "express";

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const configuredRateLimitEnabled = process.env.RATE_LIMIT_ENABLED;
const RATE_LIMIT_ENABLED =
  configuredRateLimitEnabled === undefined
    ? IS_PRODUCTION
    : configuredRateLimitEnabled === "true";
const RATE_LIMIT_ALLOW_DISABLE_IN_PRODUCTION = process.env.RATE_LIMIT_ALLOW_DISABLE_IN_PRODUCTION === "true";
const DEFAULT_WINDOW_MS = Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "60000", 10);
const DEFAULT_MAX = Number.parseInt(process.env.RATE_LIMIT_MAX ?? "30", 10);
const DEFAULT_AUTH_MAX = Number.parseInt(process.env.AUTH_RATE_LIMIT_MAX ?? "10", 10);

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function getClientKey(req: Parameters<RequestHandler>[0]): string {
  const forwarded = req.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || req.ip || "unknown";
  return req.ip || "unknown";
}

type RateLimitOptions = {
  windowMs?: number;
  max?: number;
  keyPrefix?: string;
  skip?: (req: Parameters<RequestHandler>[0]) => boolean;
};

export function rateLimiter(options: RateLimitOptions = {}): RequestHandler {
  if (!RATE_LIMIT_ENABLED && (!IS_PRODUCTION || RATE_LIMIT_ALLOW_DISABLE_IN_PRODUCTION)) {
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
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (current.count >= max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ error: "Too many requests, please try again later." });
      return;
    }

    current.count += 1;
    next();
  };
}

export function authRateLimiter(options: RateLimitOptions = {}): RequestHandler {
  return rateLimiter({
    max: options.max ?? DEFAULT_AUTH_MAX,
    windowMs: options.windowMs ?? DEFAULT_WINDOW_MS,
    keyPrefix: options.keyPrefix ?? "auth",
  });
}
