// Rate limiting middleware using express-rate-limit and persistent store
import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import Redis from "ioredis";

const RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED === "true";
const REDIS_URL = process.env.REDIS_URL;
const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000"); // 1 min default
const MAX = parseInt(process.env.RATE_LIMIT_MAX || "30"); // 30 req/min default

let store;
if (RATE_LIMIT_ENABLED && REDIS_URL) {
  const redisClient = new Redis(REDIS_URL);
  store = new RedisStore({ sendCommand: (...args) => redisClient.call(...args) });
}

export function rateLimiter() {
  if (!RATE_LIMIT_ENABLED) return (req, res, next) => next();
  return rateLimit({
    windowMs: WINDOW_MS,
    max: MAX,
    store,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." },
  });
}
