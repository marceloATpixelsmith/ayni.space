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
  if (configured === "false") {
    if (isProduction()) {
      return process.env["TURNSTILE_ALLOW_DISABLE_IN_PRODUCTION"] === "true" ? false : true;
    }
    return false;
  }
  return isProduction();
}

function getTurnstileSecret(): string {
  return process.env["TURNSTILE_SECRET_KEY"] ?? "";
}

export type TurnstileVerificationResult = {
  ok: boolean;
  reason?: "missing-token" | "missing-secret" | "verification-failed" | "verification-error";
  errorCodes?: string[];
};

export async function verifyTurnstileTokenDetailed(token: string, remoteip?: string): Promise<TurnstileVerificationResult> {
  if (!isTurnstileEnabled()) return { ok: true };

  const normalizedToken = token.trim();
  if (!normalizedToken) return { ok: false, reason: "missing-token" };

  const secret = getTurnstileSecret();
  if (!secret) {
    return { ok: false, reason: "missing-secret" };
  }

  try {
    const body = new URLSearchParams({
      secret,
      response: normalizedToken,
      ...(remoteip ? { remoteip } : {}),
    });

    const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!resp.ok) return { ok: false, reason: "verification-failed" };
    const data = (await resp.json()) as { success?: boolean; "error-codes"?: string[] };
    if (data.success) return { ok: true };
    return { ok: false, reason: "verification-failed", errorCodes: data["error-codes"] };
  } catch {
    return { ok: false, reason: "verification-error" };
  }
}

export async function verifyTurnstileToken(token: string, remoteip?: string): Promise<boolean> {
  const result = await verifyTurnstileTokenDetailed(token, remoteip);
  return result.ok;
}

function getTokenFromRequest(req: Request): string {
  const headerValue = req.headers["cf-turnstile-response"];
  const headerToken = typeof headerValue === "string" ? headerValue : undefined;
  const bodyToken = typeof req.body?.["cf-turnstile-response"] === "string" ? req.body["cf-turnstile-response"] : undefined;
  return bodyToken ?? headerToken ?? "";
}

function logTurnstileFailure(req: Request, reason: string, writeAuditLogFn: typeof writeAuditLog, metadata: Record<string, unknown> = {}) {
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
      ...metadata,
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
      res.status(403).json({ error: "Please complete the verification challenge." });
      return;
    }

    verifyFn(token, req.ip)
      .then((ok) => {
        if (!ok) {
          logTurnstileFailure(req, "invalid-token", writeAuditLogFn);
          res.status(403).json({ error: "Security verification failed. Please try again." });
          return;
        }
        (req as Request & { turnstileVerified?: boolean }).turnstileVerified = true;
        next();
      })
      .catch(() => {
        logTurnstileFailure(req, "verification-error", writeAuditLogFn);
        res.status(403).json({ error: "Security verification failed. Please try again." });
      });
  };
}

export function logTurnstileVerificationResult(req: Request, result: TurnstileVerificationResult, writeAuditLogFn: typeof writeAuditLog = writeAuditLog) {
  if (result.ok) return;
  logTurnstileFailure(req, result.reason ?? "verification-failed", writeAuditLogFn, {
    errorCodes: result.errorCodes ?? [],
  });
}

declare global {
  namespace Express {
    interface Request {
      turnstileVerified?: boolean;
    }
  }
}

export {};
