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
  reason?: "missing-token" | "missing-secret" | "verification-failed" | "verification-error" | "token-expired";
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
    const errorCodes = data["error-codes"] ?? [];
    if (errorCodes.includes("timeout-or-duplicate")) {
      return { ok: false, reason: "token-expired", errorCodes };
    }
    return { ok: false, reason: "verification-failed", errorCodes };
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
      res.status(403).json({ error: "Please complete the verification challenge.", code: "TURNSTILE_MISSING_TOKEN" });
      return;
    }

    const verificationPromise: Promise<TurnstileVerificationResult> = verifyFn === verifyTurnstileToken
      ? verifyTurnstileTokenDetailed(token, req.ip)
      : verifyFn(token, req.ip).then((ok) => ({ ok, reason: ok ? undefined : "verification-failed" as const }));

    verificationPromise
      .then((result) => {
        if (!result.ok) {
          const reason = result.reason ?? "verification-failed";
          logTurnstileFailure(req, reason, writeAuditLogFn, { errorCodes: result.errorCodes ?? [] });
          if (reason === "missing-token") {
            res.status(403).json({ error: "Please complete the verification challenge.", code: "TURNSTILE_MISSING_TOKEN" });
            return;
          }
          if (reason === "missing-secret") {
            res.status(500).json({
              error: "Turnstile verification is misconfigured. Please contact support.",
              code: "TURNSTILE_MISCONFIGURED",
            });
            return;
          }
          if (reason === "verification-error") {
            res.status(503).json({
              error: "Verification service is temporarily unavailable. Please try again.",
              code: "TURNSTILE_UNAVAILABLE",
            });
            return;
          }
          if (reason === "token-expired") {
            res.status(403).json({
              error: "Verification expired. Please complete the challenge again.",
              code: "TURNSTILE_TOKEN_EXPIRED",
            });
            return;
          }
          res.status(403).json({ error: "Security verification failed. Please try again.", code: "TURNSTILE_INVALID_TOKEN" });
          return;
        }

        (req as Request & { turnstileVerified?: boolean }).turnstileVerified = true;
        next();
      })
      .catch(() => {
        logTurnstileFailure(req, "verification-error", writeAuditLogFn);
        res.status(503).json({
          error: "Verification service is temporarily unavailable. Please try again.",
          code: "TURNSTILE_UNAVAILABLE",
        });
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
