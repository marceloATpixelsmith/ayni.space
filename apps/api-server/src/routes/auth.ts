import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import { db, usersTable, orgMembershipsTable, organizationsTable } from "@workspace/db";
import { getAppBySlug, getAppContext } from "../lib/appAccess.js";
import { buildGoogleAuthUrl, exchangeCodeForUser } from "../lib/auth.js";
import { destroySessionAndClearCookie } from "../lib/session.js";
import { getAdminSessionGroupOrigins, getAllowedOrigins, resolveSessionGroupForRequest, resolveSessionGroupFromOrigin, SESSION_GROUPS } from "../lib/sessionGroup.js";
import { writeAuditLog } from "../lib/audit.js";
import { getAbuseClientKey, recordAbuseSignal } from "../lib/authAbuse.js";
import { getPostAuthRedirectPath } from "../lib/postAuthRedirect.js";
import { isTurnstileEnabled, verifyTurnstileTokenDetailed, logTurnstileVerificationResult } from "../middlewares/turnstile.js";
import { resolveNormalizedAccessProfile } from "../lib/appAccessProfile.js";

const router = Router();

export const authRouteDeps = {
  exchangeCodeForUserFn: exchangeCodeForUser,
};

function getRequestFrontendOrigin(req: Request): string | null {
  const originHeader = req.headers["origin"];
  const origin = typeof originHeader === "string" ? originHeader.trim() : "";
  if (!origin) return null;
  try {
    const normalizedOrigin = new URL(origin).origin;
    return getAllowedOrigins().includes(normalizedOrigin) ? normalizedOrigin : null;
  } catch {
    return null;
  }
}

function getCurrentRequestSessionGroup(req: Request): string {
  const resolution = resolveSessionGroupForRequest(req, { failOnAmbiguous: true });
  if (!resolution.ok) {
    throw new Error(`session_group_resolution_failed:${resolution.reason}`);
  }

  return resolution.sessionGroup;
}

function parseGroupFromOAuthState(state: string): string | null {
  const [sessionGroup] = state.split(".", 1);
  return sessionGroup || null;
}


function parseAppSlugByOriginEnv(): Map<string, string> {
  const raw = process.env["APP_SLUG_BY_ORIGIN"] ?? "";
  const mappings = new Map<string, string>();
  for (const entry of raw.split(",").map((value) => value.trim()).filter(Boolean)) {
    const [origin, slug] = entry.split("=").map((value) => value.trim());
    if (!origin || !slug) continue;
    try {
      mappings.set(new URL(origin).origin, slug);
    } catch {
      continue;
    }
  }
  return mappings;
}

function resolveActiveAppSlugForAuth(frontendBase: string, sessionGroup: string): string | null {
  const explicitMap = parseAppSlugByOriginEnv();
  const explicit = explicitMap.get(frontendBase);
  if (explicit) return explicit;
  if (sessionGroup === SESSION_GROUPS.ADMIN) return "admin";
  return null;
}

function firstQueryParam(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}


function normalizeAuthIntent(value: unknown): "sign_in" | "create_account" | null {
  if (value === "sign_in" || value === "create_account") return value;
  return null;
}

function getAccessDeniedRedirect(frontendBase: string | null): string {
  if (!frontendBase) return "/login?error=access_denied";
  return `${frontendBase}/login?error=access_denied`;
}

function getFrontendBaseForDeny(req: Request, oauthSessionGroup: string): string | null {
  const oauthReturnTo = req.session.oauthReturnTo;
  if (typeof oauthReturnTo === "string") {
    try {
      const normalized = new URL(oauthReturnTo).origin;
      if (getAllowedOrigins().includes(normalized)) {
        return normalized;
      }
    } catch {
      // noop
    }
  }

  if (oauthSessionGroup === SESSION_GROUPS.ADMIN) {
    return getAdminSessionGroupOrigins()[0] ?? null;
  }

  return null;
}

function getTurnstileToken(req: Request): string {
  const headerValue = req.headers["cf-turnstile-response"];
  const headerToken = typeof headerValue === "string" ? headerValue : undefined;
  const bodyToken = typeof req.body?.["cf-turnstile-response"] === "string" ? req.body["cf-turnstile-response"] : undefined;
  return bodyToken ?? headerToken ?? "";
}

function logAuthFailure(req: Request, reason: string, metadata: Record<string, unknown> = {}) {
  const signal = recordAbuseSignal(`auth:${reason}:${getAbuseClientKey(req)}`);
  writeAuditLog({
    userId: req.session?.userId,
    action: signal.repeated ? "auth.failure.repeated" : "auth.failure",
    resourceType: "auth",
    resourceId: reason,
    metadata: {
      reason,
      count: signal.count,
      threshold: signal.threshold,
      ...metadata,
    },
    req,
  });
}

function logGoogleUrlBranch(req: Request, branch: string, metadata: Record<string, unknown> = {}) {
  console.info("[auth/google/url]", {
    branch,
    method: req.method,
    path: req.path,
    origin: typeof req.headers["origin"] === "string" ? req.headers["origin"] : null,
    resolvedSessionGroup: req.resolvedSessionGroup ?? null,
    turnstileTokenPresent: Boolean(getTurnstileToken(req)),
    turnstileVerified: Boolean(req.turnstileVerified),
    ...metadata,
  });
}

function sendGoogleUrlError(
  req: Request,
  res: Response,
  status: number,
  code: string,
  error: string,
  branch: string,
  metadata: Record<string, unknown> = {},
) {
  logGoogleUrlBranch(req, branch, { status, code, ...metadata });
  res.status(status).json({ error, code });
}

function getGoogleConfigValidation() {
  const clientId = process.env["GOOGLE_CLIENT_ID"]?.trim() ?? "";
  const clientSecret = process.env["GOOGLE_CLIENT_SECRET"]?.trim() ?? "";
  const redirectUriRaw = process.env["GOOGLE_REDIRECT_URI"]?.trim() ?? "";
  let redirectUriValid = false;
  if (redirectUriRaw) {
    try {
      const parsed = new URL(redirectUriRaw);
      redirectUriValid = parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
      redirectUriValid = false;
    }
  }

  return {
    ok: Boolean(clientId && clientSecret && redirectUriRaw && redirectUriValid),
    missingClientId: !clientId,
    missingClientSecret: !clientSecret,
    missingRedirectUri: !redirectUriRaw,
    invalidRedirectUri: Boolean(redirectUriRaw) && !redirectUriValid,
  };
}

async function handleMe(req: Request, res: Response) {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  const memberships = await db
    .select({
      orgId: orgMembershipsTable.orgId,
      orgName: organizationsTable.name,
      orgSlug: organizationsTable.slug,
      role: orgMembershipsTable.role,
    })
    .from(orgMembershipsTable)
    .innerJoin(organizationsTable, eq(orgMembershipsTable.orgId, organizationsTable.id))
    .where(eq(orgMembershipsTable.userId, userId));

  let activeOrg = null;
  if (user.activeOrgId) {
    activeOrg = await db.query.organizationsTable.findFirst({ where: eq(organizationsTable.id, user.activeOrgId) });
  }

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    isSuperAdmin: user.isSuperAdmin,
    activeOrgId: user.activeOrgId,
    activeOrg: activeOrg,
    memberships,
  });
}

async function handleLogout(req: Request, res: Response) {
  try {
    await destroySessionAndClearCookie(req, res, getCurrentRequestSessionGroup(req));
    res.json({ success: true, message: "Logged out successfully" });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("session_group_resolution_failed:")) {
      res.status(400).json({ error: "Unable to resolve session group for logout" });
      return;
    }
    console.error("Session destroy error:", err);
    res.status(500).json({ error: "Failed to destroy session" });
  }
}

async function handleGoogleUrl(req: Request, res: Response) {
  logGoogleUrlBranch(req, "request_received");

  if (isTurnstileEnabled() && !req.turnstileVerified) {
    const turnstileToken = getTurnstileToken(req);
    if (!turnstileToken) {
      logGoogleUrlBranch(req, "turnstile_missing_token", { turnstileVerificationPassed: false });
      logAuthFailure(req, "google-url-turnstile-missing");
      sendGoogleUrlError(req, res, 403, "TURNSTILE_MISSING_TOKEN", "Please complete the verification challenge.", "turnstile_missing_token");
      return;
    }

    const turnstileResult = await verifyTurnstileTokenDetailed(turnstileToken, req.ip);
    if (!turnstileResult.ok) {
      logGoogleUrlBranch(req, "turnstile_verification_failed", { reason: turnstileResult.reason, turnstileVerificationPassed: false });
      logAuthFailure(req, "google-url-turnstile-invalid");
      logTurnstileVerificationResult(req, turnstileResult);
      if (turnstileResult.reason === "missing-token") {
        sendGoogleUrlError(req, res, 403, "TURNSTILE_MISSING_TOKEN", "Please complete the verification challenge.", "turnstile_missing_token");
        return;
      }
      if (turnstileResult.reason === "missing-secret") {
        sendGoogleUrlError(req, res, 500, "TURNSTILE_MISCONFIGURED", "Turnstile verification is misconfigured. Please contact support.", "turnstile_misconfigured");
        return;
      }
      if (turnstileResult.reason === "verification-error") {
        sendGoogleUrlError(req, res, 503, "TURNSTILE_UNAVAILABLE", "Verification service is temporarily unavailable. Please try again.", "turnstile_unavailable");
        return;
      }
      if (turnstileResult.reason === "token-expired") {
        sendGoogleUrlError(req, res, 403, "TURNSTILE_TOKEN_EXPIRED", "Verification expired. Please complete the challenge again.", "turnstile_token_expired");
        return;
      }
      sendGoogleUrlError(req, res, 403, "TURNSTILE_INVALID_TOKEN", "Security verification failed. Please try again.", "turnstile_invalid_token");
      return;
    }
    logGoogleUrlBranch(req, "turnstile_verification_passed", { turnstileVerificationPassed: true });
  }

  const returnTo = getRequestFrontendOrigin(req);
  const authIntent = normalizeAuthIntent(req.body?.intent);
  if (!returnTo) {
    logGoogleUrlBranch(req, "origin_invalid", { turnstileVerificationPassed: Boolean(req.turnstileVerified) });
    logAuthFailure(req, "google-url-origin-invalid");
    sendGoogleUrlError(req, res, 400, "ORIGIN_NOT_ALLOWED", "Request origin is missing or not allowed.", "origin_invalid");
    return;
  }

  const oauthSessionGroup = resolveSessionGroupFromOrigin(returnTo);
  const state = `${oauthSessionGroup}.${randomUUID()}`;
  req.session.oauthState = state;
  req.session.oauthReturnTo = returnTo;
  req.session.oauthSessionGroup = oauthSessionGroup;
  req.session.oauthIntent = authIntent ?? undefined;

  const configValidation = getGoogleConfigValidation();
  if (!configValidation.ok) {
    sendGoogleUrlError(
      req,
      res,
      500,
      "OAUTH_CONFIG_MISSING",
      "Google OAuth is not configured. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.",
      "oauth_config_missing",
      { configValidationPassed: false, ...configValidation },
    );
    return;
  }

  let url = "";
  try {
    url = buildGoogleAuthUrl(state);
  } catch {
    sendGoogleUrlError(
      req,
      res,
      500,
      "OAUTH_CONFIG_MISSING",
      "Google OAuth is not configured. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.",
      "oauth_config_missing",
      { configValidationPassed: false },
    );
    return;
  }

  if (!url || typeof url !== "string") {
    sendGoogleUrlError(req, res, 500, "OAUTH_URL_INVALID", "Google OAuth URL generation failed.", "oauth_url_generation_failed");
    return;
  }

  req.session.save((err: unknown) => {
    if (err) {
      logGoogleUrlBranch(req, "session_init_failed", { status: 500, code: "OAUTH_SESSION_INIT_FAILED" });
      logAuthFailure(req, "google-url-session-init-failed");
      res.status(500).json({ error: "Failed to initialize OAuth session.", code: "OAUTH_SESSION_INIT_FAILED" });
      return;
    }
    logGoogleUrlBranch(req, "success", { sessionGroup: oauthSessionGroup, status: 200, configValidationPassed: true });
    res.json({ url });
  });
}

async function handleGoogleCallback(req: Request, res: Response) {
  let callbackFrontendBase: string | null = null;
  let callbackSessionGroup: string | null = null;

  const denyWithAccessDenied = async () => {
    const state = firstQueryParam(req.query.state);
    const stateSessionGroup = state ? parseGroupFromOAuthState(state) : null;
    const oauthSessionGroup = callbackSessionGroup ?? req.session.oauthSessionGroup ?? stateSessionGroup ?? SESSION_GROUPS.DEFAULT;
    const frontendBase = callbackFrontendBase ?? getFrontendBaseForDeny(req, oauthSessionGroup);
    await destroySessionAndClearCookie(req, res, oauthSessionGroup);
    res.redirect(getAccessDeniedRedirect(frontendBase));
  };

  try {
    const code = firstQueryParam(req.query.code);
    const state = firstQueryParam(req.query.state);

    if (!code) {
      logAuthFailure(req, "google-callback-missing-code");
      await denyWithAccessDenied();
      return;
    }

    if (!state || !req.session.oauthState || state !== req.session.oauthState) {
      logAuthFailure(req, "google-callback-invalid-state");
      await denyWithAccessDenied();
      return;
    }

    delete req.session.oauthState;
    const oauthReturnTo = req.session.oauthReturnTo;
    const stateSessionGroup = parseGroupFromOAuthState(state);
    const oauthSessionGroup = callbackSessionGroup ?? req.session.oauthSessionGroup ?? stateSessionGroup ?? SESSION_GROUPS.DEFAULT;
    callbackSessionGroup = oauthSessionGroup;
    const oauthIntent = normalizeAuthIntent(req.session.oauthIntent);
    delete req.session.oauthReturnTo;
    delete req.session.oauthSessionGroup;
    delete req.session.oauthIntent;

    if (!oauthReturnTo) {
      logAuthFailure(req, "google-callback-missing-return-origin");
      await denyWithAccessDenied();
      return;
    }

    const frontendBase = oauthReturnTo;
    callbackFrontendBase = frontendBase;
    const activeAppSlug = resolveActiveAppSlugForAuth(frontendBase, oauthSessionGroup);
    if (!activeAppSlug) {
      await denyWithAccessDenied();
      return;
    }

    let app: Awaited<ReturnType<typeof getAppBySlug>> = undefined;
    try {
      app = await getAppBySlug(activeAppSlug);
    } catch (error) {
      if (activeAppSlug !== "admin") throw error;
      console.log("[auth/google/callback] app lookup failed; using fail-closed admin fallback", {
        oauthSessionGroup,
        frontendBase,
        error,
      });
    }

    const normalizedAccessProfile = app ? resolveNormalizedAccessProfile(app) : (activeAppSlug === "admin" ? "superadmin" : null);
    const isSuperadminAccessMode = normalizedAccessProfile === "superadmin";

    const googleUser = await authRouteDeps.exchangeCodeForUserFn(code);
    const email = normalizeEmail(googleUser.email);
    const subject = googleUser.sub;
    console.log("[auth/google/callback] identity:", { email, subject });

    await new Promise((resolve, reject) => {
      req.session.regenerate((err: unknown) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(undefined);
      });
    });

    let user = subject
      ? await db.query.usersTable.findFirst({ where: eq(usersTable.googleSubject, subject) })
      : null;
    console.log("[auth/google/callback] subject match:", { found: Boolean(user), userId: user?.id ?? null });

    if (!user) {
      const byEmail = email
        ? await db.query.usersTable.findFirst({ where: sql`lower(${usersTable.email}) = ${email}` })
        : null;
      console.log("[auth/google/callback] email match:", {
        found: Boolean(byEmail),
        userId: byEmail?.id ?? null,
        googleSubjectBefore: byEmail?.googleSubject ?? null,
      });

      if (byEmail && !byEmail.googleSubject && subject) {
        console.log("[auth/google/callback] before update:", {
          userId: byEmail.id,
          googleSubjectBefore: byEmail.googleSubject ?? null,
          incomingSubject: subject,
        });
        const updatedRows = await db
          .update(usersTable)
          .set({
            googleSubject: subject,
            avatarUrl: googleUser.picture ?? byEmail.avatarUrl,
            name: byEmail.name ?? googleUser.name ?? null,
          })
          .where(eq(usersTable.id, byEmail.id))
          .returning();
        console.log("[auth/google/callback] after update:", {
          rowsAffected: updatedRows.length,
          googleSubjectAfter: updatedRows[0]?.googleSubject ?? null,
        });
        user = updatedRows[0] ?? null;
      } else {
        user = byEmail;
      }
    }

    if (!user) {
      if (isSuperadminAccessMode) {
        console.log("[auth/google/callback] decision:", { decision: "deny" });
        await denyWithAccessDenied();
        return;
      }
      console.log("[auth/google/callback] decision:", { decision: "deny" });
      await denyWithAccessDenied();
      return;
    }

    console.log("[auth/google/callback] final user:", {
      userId: user.id,
      googleSubject: user.googleSubject ?? null,
      isSuperAdmin: user.isSuperAdmin,
    });

    if (isSuperadminAccessMode && user.isSuperAdmin !== true) {
      console.log("[auth/google/callback] decision:", { decision: "deny" });
      await denyWithAccessDenied();
      return;
    }

    await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));

    req.session.userId = user.id;
    req.session.activeOrgId = user.activeOrgId ?? undefined;
    req.session.sessionAuthenticatedAt = Date.now();
    req.session.sessionGroup = oauthSessionGroup;

    writeAuditLog({
      userId: user.id,
      userEmail: user.email,
      action: "user.login",
      resourceType: "user",
      resourceId: user.id,
      req,
    });

    let appContext = null as Awaited<ReturnType<typeof getAppContext>>;
    try {
      appContext = await getAppContext(user.id, activeAppSlug);
    } catch (error) {
      if (activeAppSlug === "admin") {
        console.log("[auth/google/callback] app-context lookup failed; using fail-closed admin fallback", { oauthSessionGroup, frontendBase, error });
      } else {
        throw error;
      }
    }

    const effectiveContext = appContext ?? (activeAppSlug === "admin"
      ? {
          canAccess: Boolean(user.isSuperAdmin),
          normalizedAccessProfile: "superadmin" as const,
          requiredOnboarding: "none" as const,
        }
      : null);

    if (!effectiveContext?.canAccess) {
      console.log("[auth/google/callback] decision:", { decision: "deny" });
      await destroySessionAndClearCookie(req, res, oauthSessionGroup);
      res.redirect(getAccessDeniedRedirect(frontendBase));
      return;
    }

    console.log("[auth/google/callback] decision:", { decision: "allow" });

    const destination = getPostAuthRedirectPath({
      isSuperAdmin: user.isSuperAdmin,
      normalizedAccessProfile: effectiveContext.normalizedAccessProfile,
      requiredOnboarding: effectiveContext.requiredOnboarding,
      authIntent: oauthIntent,
    });
    res.redirect(`${frontendBase}${destination}`);
  } catch (error) {
    console.log("Google callback failed:", error);
    logAuthFailure(req, "google-callback-exception");
    await denyWithAccessDenied();
  }
}

router.get("/me", handleMe);
router.post("/logout", handleLogout);
router.post("/google/url", handleGoogleUrl);
router.get("/google/callback", handleGoogleCallback);

export default router;
