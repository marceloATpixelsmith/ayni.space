import type { RequestHandler } from "express";

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const RATE_LIMIT_ENABLED =
  process.env.RATE_LIMIT_ENABLED === undefined
    ? IS_PRODUCTION
    : process.env.RATE_LIMIT_ENABLED === "true";
const WINDOW_MS = Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "60000", 10);
const MAX = Number.parseInt(process.env.RATE_LIMIT_MAX ?? "30", 10);

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function getClientKey(req: Parameters<RequestHandler>[0]): string {
  const forwarded = req.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || req.ip || "unknown";
  return req.ip || "unknown";
}

export function rateLimiter(): RequestHandler {
  if (!RATE_LIMIT_ENABLED) {
    return (_req, _res, next) => next();
  }

  return (req, res, next) => {
    const now = Date.now();
    const key = getClientKey(req);
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
      next();
      return;
    }

    if (current.count >= MAX) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ error: "Too many requests, please try again later." });
      return;
    }

    current.count += 1;
    next();
  };
}
