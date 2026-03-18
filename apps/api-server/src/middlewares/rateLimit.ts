import type { RequestHandler } from "express";

const RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED === "true";
const WINDOW_MS = Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "60000", 10);
const MAX = Number.parseInt(process.env.RATE_LIMIT_MAX ?? "30", 10);

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function getClientKey(req: Parameters<RequestHandler>[0]): string {
  const forwarded = req.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? req.ip;
  return req.ip;
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
      res.status(429).json({ error: "Too many requests, please try again later." });
      return;
    }

    current.count += 1;
    next();
  };
}
