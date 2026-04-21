import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { getRequestCookieValue, getSetCookieValueForName, logAuthDebug, toVisibleSessionId } from "../lib/authDebug.js";
import { getSessionCookieName } from "../lib/session.js";
import { SESSION_GROUPS } from "../lib/sessionGroup.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const MISSING_ORIGIN_REFERER_EXCEPTIONS: Array<{ method: string; pattern: RegExp }> = [
  { method: "POST", pattern: /^\/api\/billing\/webhook\/?$/ },
  { method: "POST", pattern: /^\/api\/transactional-email\/webhooks\/brevo\/?$/ },
  { method: "POST", pattern: /^\/api\/transactional-email\/webhooks\/mailchimp-transactional\/?$/ },
];

function ensureSessionCsrfToken(req: any): string {
  if (!req.session.csrfToken || typeof req.session.csrfToken !== "string") {
    req.session.csrfToken = randomUUID();
  }

  return req.session.csrfToken;
}

export const csrfProtection: RequestHandler = (req, res, next) => {
  const webhookBypass = MISSING_ORIGIN_REFERER_EXCEPTIONS.some(
    (entry) => entry.method === req.method.toUpperCase() && entry.pattern.test(req.path),
  );
  if (webhookBypass) {
    next();
    return;
  }

  const token = ensureSessionCsrfToken(req);

  if (SAFE_METHODS.has(req.method)) {
    res.setHeader("X-CSRF-Token", token);
    next();
    return;
  }

  const providedToken = req.get("x-csrf-token");
  if (!providedToken || providedToken !== token) {
    res.status(403).json({ error: "Invalid CSRF token", code: "CSRF_INVALID" });
    return;
  }

  next();
};

export const csrfTokenEndpoint: RequestHandler = (req, res) => {
  if (process.env["AUTH_DEBUG"] === "true") {
    const sessionGroup = req.resolvedSessionGroup ?? req.session?.sessionGroup ?? SESSION_GROUPS.DEFAULT;
    const cookieName = getSessionCookieName(sessionGroup);
    logAuthDebug(req, "csrf_token_request", {
      requestSessionId: req.sessionID ?? null,
      sessionGroup,
      cookieName,
      requestCookieSessionId: toVisibleSessionId(getRequestCookieValue(req, cookieName)),
      sessionKeys: Object.keys(req.session ?? {}).sort().join(","),
      userId: req.session?.userId ?? null,
      pendingUserId: req.session?.pendingUserId ?? null,
    });
    res.on("finish", () => {
      logAuthDebug(req, "csrf_token_response", {
        status: res.statusCode,
        requestSessionId: req.sessionID ?? null,
        sessionGroup,
        cookieName,
        responseSetCookieSessionId: toVisibleSessionId(getSetCookieValueForName(res, cookieName)),
        responseSetCookiePresent: Boolean(getSetCookieValueForName(res, cookieName)),
        sessionKeys: Object.keys(req.session ?? {}).sort().join(","),
        userId: req.session?.userId ?? null,
        pendingUserId: req.session?.pendingUserId ?? null,
      });
    });
  }
  const token = ensureSessionCsrfToken(req);
  res.json({ csrfToken: token });
};

export function originRefererProtection(allowedOrigins: string[] | (() => string[] | Promise<string[]>)): RequestHandler {
  return (req, res, next) => {
    if (req.method === "GET" && req.path.startsWith("/api/auth/google/")) {
      next();
      return;
    }

    const origin = req.get("origin");
    const referer = req.get("referer");
    if (!origin && !referer) {
      if (!SAFE_METHODS.has(req.method.toUpperCase())) {
        const exceptionMatch = MISSING_ORIGIN_REFERER_EXCEPTIONS.some(
          (entry) => entry.method === req.method.toUpperCase() && entry.pattern.test(req.path),
        );
        if (!exceptionMatch) {
          res.status(403).json({
            error: "Origin or referer header required for unsafe requests",
            code: "ORIGIN_OR_REFERER_REQUIRED",
          });
          return;
        }
      }
      next();
      return;
    }

    Promise.resolve(typeof allowedOrigins === "function" ? allowedOrigins() : allowedOrigins).then((resolvedAllowedOrigins) => {
    const valid = [origin, referer].some((url) => {
      if (!url) return false;
      try {
        return resolvedAllowedOrigins.includes(new URL(url).origin);
      } catch {
        return false;
      }
    });

    if (!valid) {
      res.status(403).json({
        error: "Invalid origin or referer",
        code: "ORIGIN_OR_REFERER_INVALID",
      });
      return;
    }

    next();
    }).catch(() => {
      res.status(403).json({
        error: "Invalid origin or referer",
        code: "ORIGIN_OR_REFERER_INVALID",
      });
    });
  };
}
