import type { Request } from "express";

const DEFAULT_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_REPEATED_THRESHOLD = 5;

type Counter = { count: number; resetAt: number };
const counters = new Map<string, Counter>();

export function getAbuseClientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function recordAbuseSignal(key: string, options?: { windowMs?: number; threshold?: number }) {
  const windowMs = options?.windowMs ?? DEFAULT_WINDOW_MS;
  const threshold = options?.threshold ?? Number.parseInt(process.env["ABUSE_REPEATED_THRESHOLD"] ?? String(DEFAULT_REPEATED_THRESHOLD), 10);
  const now = Date.now();

  const current = counters.get(key);
  if (!current || current.resetAt <= now) {
    const next = { count: 1, resetAt: now + windowMs };
    counters.set(key, next);
    return { count: 1, repeated: false, threshold };
  }

  current.count += 1;
  return { count: current.count, repeated: current.count >= threshold, threshold };
}
