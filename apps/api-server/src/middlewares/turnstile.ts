import type { Request, RequestHandler } from "express";
import { writeAuditLog } from "../lib/audit.js";
import { getAbuseClientKey, recordAbuseSignal } from "../lib/authAbuse.js";

function isProduction(): boolean {
  return process.env["NODE_ENV"] === "production";
}

export function isTurnstileEnabled(): boolean {
  const configured = process.env["TURNSTILE_ENABLED"];
  // Production-safe default: ON unless explicitly disabled and force-override is set.
  if (configured === undefined) return isProduction();
  if (configured === "true") return true;
  if (configured === "false" && isProduction()) {
    return process.env["TURNSTILE_ALLOW_DISABLE_IN_PRODUCTION"] === "true";
  }
  return configured === "true";
}

function getTurnstileSecret(): string {
  return process.env["TURNSTILE_SECRET_KEY"] ?? "";
}

export async function verifyTurnstileToken(token: string, remoteip?: string): Promise<boolean> {
  if (!isTurnstileEnabled()) return true;

  const secret = getTurnstileSecret();
  if (!secret) {
    throw new Error("TURNSTILE_SECRET_KEY not set");
  }

  if (!token) return false;

  try {
    const body = new URLSearchParams({
      secret,
      response: token,
      ...(remoteip ? { remoteip } : {}),
    });

    const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!resp.ok) return false;
    const data = (await resp.json()) as { success?: boolean };
    return Boolean(data.success);
  } catch {
    return false;
  }
}

function getTokenFromRequest(req: Request): string {
  const headerValue = req.headers["cf-turnstile-response"];
  const headerToken = typeof headerValue === "string" ? headerValue : undefined;
  const bodyToken = typeof req.body?.["cf-turnstile-response"] === "string" ? req.body["cf-turnstile-response"] : undefined;
  return bodyToken ?? headerToken ?? "";
}

function logTurnstileFailure(req: Request, reason: string, writeAuditLogFn: typeof writeAuditLog) {
  const userId = req.session?.userId;
  const key = `${req.path}:${getAbuseClientKey(req)}`;
  const signal = recordAbuseSignal(`turnstile:${key}`);

  writeAuditLogFn({
    userId,
    action: signal.repeated ? "turnstile.failed.repeated" : "turnstile.failed",
    resourceType: "security",
    resourceId: req.path,
    metadata: {
      reason,
      count: signal.count,
      threshold: signal.threshold,
      method: req.method,
      path: req.path,
    },
    req,
  });
}

export function turnstileVerifyMiddleware(deps: { verifyFn?: typeof verifyTurnstileToken; writeAuditLogFn?: typeof writeAuditLog } = {}): RequestHandler {
  const verifyFn = deps.verifyFn ?? verifyTurnstileToken;
  const writeAuditLogFn = deps.writeAuditLogFn ?? writeAuditLog;

  return (req, res, next) => {
    if (!isTurnstileEnabled()) {
      next();
      return;
    }

    const token = getTokenFromRequest(req);
    if (!token) {
      logTurnstileFailure(req, "missing-token", writeAuditLogFn);
      res.status(403).json({ error: "Turnstile verification failed" });
      return;
    }

    verifyFn(token, req.ip)
      .then((ok) => {
        if (!ok) {
          logTurnstileFailure(req, "invalid-token", writeAuditLogFn);
          res.status(403).json({ error: "Turnstile verification failed" });
          return;
        }
        next();
      })
      .catch(() => {
        logTurnstileFailure(req, "verification-error", writeAuditLogFn);
        res.status(500).json({ error: "Turnstile verification error" });
      });
  };
}
