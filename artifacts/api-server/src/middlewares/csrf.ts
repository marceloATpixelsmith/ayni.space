import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function ensureSessionCsrfToken(req: any): string {
  if (!req.session.csrfToken || typeof req.session.csrfToken !== "string") {
    req.session.csrfToken = randomUUID();
  }

  return req.session.csrfToken;
}

export const csrfProtection: RequestHandler = (req, res, next) => {
  const token = ensureSessionCsrfToken(req);

  if (SAFE_METHODS.has(req.method)) {
    res.setHeader("X-CSRF-Token", token);
    next();
    return;
  }

  const providedToken = req.get("x-csrf-token");
  if (!providedToken || providedToken !== token) {
    res.status(403).json({ error: "Invalid CSRF token" });
    return;
  }

  next();
};

export const csrfTokenEndpoint: RequestHandler = (req, res) => {
  const token = ensureSessionCsrfToken(req);
  res.json({ csrfToken: token });
};

export function originRefererProtection(allowedOrigins: string[]): RequestHandler {
  return (req, res, next) => {
    if (req.method === "GET" && req.path.startsWith("/api/auth/google/")) {
      next();
      return;
    }

    const origin = req.get("origin");
    const referer = req.get("referer");
    if (!origin && !referer) {
      next();
      return;
    }

    const valid = [origin, referer].some((url) => {
      if (!url) return false;
      try {
        return allowedOrigins.includes(new URL(url).origin);
      } catch {
        return false;
      }
    });

    if (!valid) {
      res.status(403).json({ error: "Invalid origin or referer" });
      return;
    }

    next();
  };
}
