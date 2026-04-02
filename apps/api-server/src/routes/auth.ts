import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import { db, usersTable, orgMembershipsTable, organizationsTable } from "@workspace/db";
import { getAppBySlug, getAppContext } from "../lib/appAccess.js";
import { buildGoogleAuthUrl, exchangeCodeForUser } from "../lib/auth.js";
import { destroySessionAndClearCookie, getSessionCookieName, getSessionCookieOptions, logSessionCookieConfig } from "../lib/session.js";
import { getAdminSessionGroupOrigins, getAllowedOrigins, resolveSessionGroupForRequest, resolveSessionGroupFromOrigin, SESSION_GROUPS } from "../lib/sessionGroup.js";
import { writeAuditLog } from "../lib/audit.js";
import { getAbuseClientKey, recordAbuseSignal } from "../lib/authAbuse.js";
import { getPostAuthRedirectPath } from "../lib/postAuthRedirect.js";
import { isTurnstileEnabled, verifyTurnstileTokenDetailed, logTurnstileVerificationResult } from "../middlewares/turnstile.js";
import { resolveNormalizedAccessProfile } from "../lib/appAccessProfile.js";

const router = Router();
const SUPERADMIN_TRACE_PREFIX = "[SUPERADMIN-AUTH-TRACE]";

export const authRouteDeps = {
  exchangeCodeForUserFn: exchangeCodeForUser,
};

function getRequestFrontendOrigin(req: Request): string | null {
  const allowedOrigins = getAllowedOrigins();
  const originHeader = req.headers["origin"];
  const origin = typeof originHeader === "string" ? originHeader.trim() : "";
  if (origin) {
    try {
      const normalizedOrigin = new URL(origin).origin;
      if (allowedOrigins.includes(normalizedOrigin)) return normalizedOrigin;
    } catch {
      // noop
    }
  }

  const refererHeader = req.headers["referer"];
  const referer = typeof refererHeader === "string" ? refererHeader.trim() : "";
  if (!referer) return null;
  try {
    const normalizedReferer = new URL(referer).origin;
    return allowedOrigins.includes(normalizedReferer) ? normalizedReferer : null;
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

type OAuthStatePayload = {
  nonce: string;
  appSlug: string;
  returnTo: string;
  sessionGroup: string;
};
type OAuthStateContext = Pick<OAuthStatePayload, "appSlug" | "returnTo" | "sessionGroup">;

function encodeOAuthStatePayload(payload: OAuthStatePayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeOAuthStatePayload(encodedPayload: string): OAuthStatePayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof parsed["nonce"] !== "string") return null;
    if (typeof parsed["appSlug"] !== "string" || parsed["appSlug"].trim().length === 0) return null;
    if (typeof parsed["returnTo"] !== "string" || parsed["returnTo"].trim().length === 0) return null;
    if (typeof parsed["sessionGroup"] !== "string" || parsed["sessionGroup"].trim().length === 0) return null;
    return {
      nonce: parsed["nonce"],
      appSlug: parsed["appSlug"],
      returnTo: parsed["returnTo"],
      sessionGroup: parsed["sessionGroup"],
    };
  } catch {
    return null;
  }
}

function buildOAuthState(payload: OAuthStatePayload): string {
  return `${payload.sessionGroup}.${payload.nonce}.${encodeOAuthStatePayload(payload)}`;
}

function parseOAuthState(state: string | null | undefined): OAuthStatePayload | null {
  if (!state) return null;
  const segments = state.split(".");
  if (segments.length < 3) return null;
  const encodedPayload = segments.slice(2).join(".");
  const payload = decodeOAuthStatePayload(encodedPayload);
  if (!payload) return null;
  if (payload.sessionGroup !== segments[0]) return null;
  if (payload.nonce !== segments[1]) return null;
  return payload;
}

function validateOAuthCallbackState(
  state: string,
  expectedState: unknown,
): { valid: true; stateContext: OAuthStateContext } | { valid: false } {
  if (typeof expectedState !== "string" || state !== expectedState) {
    return { valid: false };
  }

  const parsedState = parseOAuthState(state);
  if (!parsedState) {
    return { valid: false };
  }

  const stateContext: OAuthStateContext = {
    appSlug: parsedState.appSlug,
    returnTo: parsedState.returnTo,
    sessionGroup: parsedState.sessionGroup,
  };
  return { valid: true, stateContext };
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

function resolveActiveAppSlugForAuth(frontendBase: string, sessionGroup: string): string {
  const explicitMap = parseAppSlugByOriginEnv();
  const explicit = explicitMap.get(frontendBase);
  if (explicit) return explicit;

  try {
    const hostname = new URL(frontendBase).hostname.toLowerCase();
    if (hostname === "admin.ayni.space" || hostname.startsWith("admin.")) {
      return "admin";
    }
  } catch {
    // noop
  }

  if (sessionGroup === SESSION_GROUPS.ADMIN) return "admin";
  return "workspace";
}

function firstQueryParam(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function logSuperadminTrace(checkpoint: string, payload: Record<string, unknown>) {
  console.log(`${SUPERADMIN_TRACE_PREFIX} ${checkpoint}`, payload);
}

function logAuthCheckTrace(payload: {
  sessionExists: boolean;
  sessionGroup: string | null;
  userId: string | null;
  isSuperAdmin: boolean;
  allow: boolean;
  denyReason: string | null;
  sessionKeys: string;
}) {
  const { sessionExists, sessionGroup, userId, isSuperAdmin, allow, denyReason, sessionKeys } = payload;
  console.log(
    `[AUTH-CHECK-TRACE] AUTH ROUTE CHECK ` +
    `sessionExists=${sessionExists} ` +
    `sessionGroup=${sessionGroup} ` +
    `userId=${userId} ` +
    `isSuperAdmin=${isSuperAdmin} ` +
    `allow=${allow} ` +
    `denyReason=${denyReason} ` +
    `sessionKeys=${sessionKeys}`
  );
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
  const sessionGroup = req.session.sessionGroup ?? req.resolvedSessionGroup ?? null;
  const sessionKeys = Object.keys(req.session ?? {}).sort().join(",");
  if (!userId) {
    logAuthCheckTrace({
      sessionExists: Boolean(req.session),
      sessionGroup,
      userId: null,
      isSuperAdmin: false,
      allow: false,
      denyReason: "missing_session_user_id",
      sessionKeys,
    });
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
  if (!user) {
    logAuthCheckTrace({
      sessionExists: Boolean(req.session),
      sessionGroup,
      userId,
      isSuperAdmin: false,
      allow: false,
      denyReason: "user_not_found",
      sessionKeys,
    });
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

  logAuthCheckTrace({
    sessionExists: Boolean(req.session),
    sessionGroup,
    userId: user.id,
    isSuperAdmin: Boolean(user.isSuperAdmin),
    allow: true,
    denyReason: null,
    sessionKeys,
  });

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

  const originSessionGroup = resolveSessionGroupFromOrigin(returnTo);
  const requestSessionGroup = req.resolvedSessionGroup ?? getCurrentRequestSessionGroup(req);
  const inferredSessionGroup = originSessionGroup === SESSION_GROUPS.DEFAULT
    ? requestSessionGroup
    : originSessionGroup;
  const appSlug = resolveActiveAppSlugForAuth(returnTo, inferredSessionGroup);
  const oauthSessionGroup = appSlug === "admin" || inferredSessionGroup === SESSION_GROUPS.ADMIN
    ? SESSION_GROUPS.ADMIN
    : SESSION_GROUPS.DEFAULT;
  const statePayload = {
    nonce: randomUUID(),
    appSlug,
    returnTo,
    sessionGroup: oauthSessionGroup,
  };
  const state = buildOAuthState(statePayload);
  req.session.oauthState = state;
  req.session.oauthReturnTo = returnTo;
  req.session.oauthSessionGroup = oauthSessionGroup;
  req.session.oauthAppSlug = appSlug;
  req.session.oauthIntent = authIntent ?? undefined;
  logSuperadminTrace("OAUTH START", {
    appSlug,
    returnTo,
    sessionGroup: oauthSessionGroup,
    generatedStateHasAppSlug: true,
  });
  logSuperadminTrace("STATE CREATED", {
    appSlug: statePayload.appSlug,
    returnTo: statePayload.returnTo,
    sessionGroup: statePayload.sessionGroup,
  });
  console.log(
    `[AUTH-CHECK-TRACE] OAUTH STATE CREATED ` +
    `appSlug=${appSlug ?? "null"} ` +
    `returnTo=${returnTo ?? "null"} ` +
    `sessionGroup=${oauthSessionGroup ?? "null"}`
  );
  logSessionCookieConfig();

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
  let lastCompletedStep: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "A7" | "A8" | "A" = "A0";
  logSuperadminTrace("A0. HANDLER ENTER", {
    hasCode: Boolean(firstQueryParam(req.query.code)),
    hasState: Boolean(firstQueryParam(req.query.state)),
    originalUrl: req.originalUrl,
    method: req.method,
  });

  let callbackFrontendBase: string | null = null;
  let callbackSessionGroup: string | null = null;

  const denyWithAccessDenied = async () => {
    const state = firstQueryParam(req.query.state);
    const stateSessionGroup = state ? parseGroupFromOAuthState(state) : null;
    const oauthSessionGroup = callbackSessionGroup ?? req.session.oauthSessionGroup ?? stateSessionGroup ?? SESSION_GROUPS.DEFAULT;
    const frontendBase = callbackFrontendBase ?? getFrontendBaseForDeny(req, oauthSessionGroup);
    const redirectTo = getAccessDeniedRedirect(frontendBase);
    logSuperadminTrace("J. CALLBACK EXIT", {
      redirectTo,
      outcome: "deny",
      lastCompletedStep,
    });
    await destroySessionAndClearCookie(req, res, oauthSessionGroup);
    res.redirect(redirectTo);
  };

  try {
    const code = firstQueryParam(req.query.code);
    const state = firstQueryParam(req.query.state);

    logSuperadminTrace("A3. STATE VALIDATION START", {
      hasState: Boolean(state),
    });
    lastCompletedStep = "A3";
    if (!code) {
      logAuthFailure(req, "google-callback-missing-code");
      logSuperadminTrace("R. EARLY RETURN", {
        reason: "missing_code",
        redirectTo: getAccessDeniedRedirect(getFrontendBaseForDeny(req, SESSION_GROUPS.DEFAULT)),
      });
      await denyWithAccessDenied();
      return;
    }

    if (!state) {
      logAuthFailure(req, "google-callback-missing-state");
      logSuperadminTrace("A4. STATE VALIDATION RESULT", {
        valid: false,
        appSlug: null,
        returnTo: null,
        sessionGroup: SESSION_GROUPS.DEFAULT,
      });
      lastCompletedStep = "A4";
      logSuperadminTrace("R. EARLY RETURN", {
        reason: "missing_state",
        redirectTo: getAccessDeniedRedirect(getFrontendBaseForDeny(req, SESSION_GROUPS.DEFAULT)),
      });
      await denyWithAccessDenied();
      return;
    }

    const stateValidation = validateOAuthCallbackState(state, req.session.oauthState);
    const stateValid = stateValidation.valid;
    const stateSessionGroup = state ? parseGroupFromOAuthState(state) : null;
    const stateContext = stateValidation.valid ? stateValidation.stateContext : null;
    const resolvedStateSessionGroup = stateContext?.sessionGroup ?? req.session.oauthSessionGroup ?? stateSessionGroup ?? SESSION_GROUPS.DEFAULT;
    logSuperadminTrace("A4. STATE VALIDATION RESULT", {
      valid: stateValid,
      appSlug: stateContext?.appSlug ?? null,
      returnTo: stateContext?.returnTo ?? null,
      sessionGroup: resolvedStateSessionGroup,
    });
    lastCompletedStep = "A4";
    if (!stateValid) {
      logAuthFailure(req, "google-callback-invalid-state");
      logSuperadminTrace("R. EARLY RETURN", {
        reason: "invalid_state",
        redirectTo: getAccessDeniedRedirect(getFrontendBaseForDeny(req, SESSION_GROUPS.DEFAULT)),
      });
      await denyWithAccessDenied();
      return;
    }

    delete req.session.oauthState;
    const parsedStateContext = stateValidation.stateContext;
    logSuperadminTrace("STATE AFTER PARSE", {
      appSlug: parsedStateContext.appSlug,
      returnTo: parsedStateContext.returnTo,
      sessionGroup: parsedStateContext.sessionGroup,
    });
    const oauthReturnTo = parsedStateContext.returnTo;
    const stateSessionGroupCandidate = callbackSessionGroup ?? parsedStateContext.sessionGroup ?? req.session.oauthSessionGroup ?? stateSessionGroup ?? SESSION_GROUPS.DEFAULT;
    const oauthIntent = normalizeAuthIntent(req.session.oauthIntent);
    const appSlug = parsedStateContext.appSlug;
    const oauthSessionGroup = appSlug === "admin" ? SESSION_GROUPS.ADMIN : stateSessionGroupCandidate;
    callbackSessionGroup = oauthSessionGroup;
    logSuperadminTrace("A1. PRE-CALLBACK-CONTEXT", {
      appSlug,
      returnTo: oauthReturnTo ?? null,
      sessionGroup: oauthSessionGroup,
      oauthStatePresent: Boolean(req.session.oauthState),
    });
    lastCompletedStep = "A1";
    logSuperadminTrace("A2. CALLBACK INPUTS", {
      hasCode: Boolean(code),
      hasState: Boolean(state),
      codeLength: code?.length ?? 0,
      stateLength: state?.length ?? 0,
    });
    lastCompletedStep = "A2";
    delete req.session.oauthReturnTo;
    delete req.session.oauthSessionGroup;
    delete req.session.oauthAppSlug;
    delete req.session.oauthIntent;

    if (!oauthReturnTo) {
      logAuthFailure(req, "google-callback-missing-return-origin");
      logSuperadminTrace("R. EARLY RETURN", {
        reason: "missing_return_to",
        redirectTo: getAccessDeniedRedirect(getFrontendBaseForDeny(req, oauthSessionGroup)),
      });
      await denyWithAccessDenied();
      return;
    }

    const frontendBase = oauthReturnTo;
    callbackFrontendBase = frontendBase;
    const activeAppSlug = appSlug;
    if (!activeAppSlug) {
      logSuperadminTrace("R. EARLY RETURN", {
        reason: "missing_app_slug",
        redirectTo: getAccessDeniedRedirect(frontendBase),
      });
      await denyWithAccessDenied();
      return;
    }

    let app: Awaited<ReturnType<typeof getAppBySlug>> = undefined;
    try {
      logSuperadminTrace("B0. APP LOOKUP BEFORE", {
        appSlug: activeAppSlug,
      });
      app = await getAppBySlug(activeAppSlug);
      logSuperadminTrace("B1. APP LOOKUP AFTER", {
        appSlug: activeAppSlug,
        appFound: Boolean(app),
      });
    } catch (error) {
      logSuperadminTrace("B1. APP LOOKUP AFTER", {
        appSlug: activeAppSlug,
        appFound: false,
        error: error instanceof Error ? error.message : String(error),
      });
      if (activeAppSlug !== "admin") throw error;
      console.log("[auth/google/callback] app lookup failed; using fail-closed admin fallback", {
        oauthSessionGroup,
        frontendBase,
        error,
      });
    }

    const normalizedAccessProfile = app ? resolveNormalizedAccessProfile(app) : (activeAppSlug === "admin" ? "superadmin" : null);
    const isSuperadminAccessMode = normalizedAccessProfile === "superadmin";

    logSuperadminTrace("A5. TOKEN EXCHANGE START", {
      hasCode: Boolean(code),
    });
    lastCompletedStep = "A5";
    let googleUser: Awaited<ReturnType<typeof authRouteDeps.exchangeCodeForUserFn>>;
    try {
      googleUser = await authRouteDeps.exchangeCodeForUserFn(code);
      logSuperadminTrace("A6. TOKEN EXCHANGE RESULT", {
        success: true,
        hasAccessToken: true,
        hasIdToken: true,
      });
      lastCompletedStep = "A6";
    } catch (error) {
      logSuperadminTrace("A6. TOKEN EXCHANGE RESULT", {
        success: false,
        hasAccessToken: false,
        hasIdToken: false,
      });
      lastCompletedStep = "A6";
      logSuperadminTrace("R. EARLY RETURN", {
        reason: "token_exchange_failed",
        redirectTo: getAccessDeniedRedirect(frontendBase),
      });
      logAuthFailure(req, "google-callback-token-exchange-failed");
      await denyWithAccessDenied();
      return;
    }

    logSuperadminTrace("A7. PROFILE FETCH START", {
      hasAccessToken: true,
    });
    lastCompletedStep = "A7";
    logSuperadminTrace("A8. PROFILE FETCH RESULT", {
      success: Boolean(googleUser),
      hasEmail: Boolean(googleUser.email),
      hasSubject: Boolean(googleUser.sub),
    });
    lastCompletedStep = "A8";
    if (!googleUser.email) {
      logSuperadminTrace("R. EARLY RETURN", {
        reason: "missing_email",
        redirectTo: getAccessDeniedRedirect(frontendBase),
      });
      logAuthFailure(req, "google-callback-missing-email");
      await denyWithAccessDenied();
      return;
    }
    const email = normalizeEmail(googleUser.email);
    const subject = googleUser.sub;
    logSuperadminTrace("A. CALLBACK ENTRY", {
      appSlug: activeAppSlug,
      returnTo: frontendBase,
      email,
      subject,
    });
    lastCompletedStep = "A";
    logSuperadminTrace("B. APP LOOKUP RESULT", {
      appSlug: activeAppSlug,
      appFound: Boolean(app),
      appId: app?.id ?? null,
      accessMode: app?.accessMode ?? null,
      onboardingMode: app?.onboardingMode ?? null,
    });

    await new Promise((resolve, reject) => {
      req.session.regenerate((err: unknown) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(undefined);
      });
    });

    let user = null;
    if (subject) {
      logSuperadminTrace("D0. SUBJECT LOOKUP BEFORE", { subject });
      user = await db.query.usersTable.findFirst({ where: eq(usersTable.googleSubject, subject) });
    }
    logSuperadminTrace("D1. SUBJECT LOOKUP AFTER", {
      found: Boolean(user),
      userId: user?.id ?? null,
    });

    if (!user) {
      logSuperadminTrace("E0. EMAIL LOOKUP BEFORE", {
        email: email ?? null,
      });
      const byEmail = email
        ? await db.query.usersTable.findFirst({ where: sql`lower(${usersTable.email}) = ${email}` })
        : null;
      logSuperadminTrace("E1. EMAIL LOOKUP AFTER", {
        found: Boolean(byEmail),
        userId: byEmail?.id ?? null,
        email: byEmail?.email ?? email ?? null,
        googleSubjectBefore: byEmail?.googleSubject ?? null,
        isSuperAdmin: byEmail?.isSuperAdmin ?? null,
        active: byEmail?.active ?? null,
        suspended: byEmail?.suspended ?? null,
      });

      if (byEmail && !byEmail.googleSubject && subject) {
        logSuperadminTrace("F0. SUBJECT BIND UPDATE BEFORE", {
          userId: byEmail.id,
          incomingSubject: subject,
          googleSubjectBefore: byEmail.googleSubject ?? null,
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
        logSuperadminTrace("F1. SUBJECT BIND UPDATE AFTER", {
          rowsAffected: updatedRows.length,
          returnedUserId: updatedRows[0]?.id ?? null,
          googleSubjectAfter: updatedRows[0]?.googleSubject ?? null,
        });
        user = updatedRows[0] ?? null;
      } else {
        logSuperadminTrace("F0. SUBJECT BIND UPDATE BEFORE", {
          userId: byEmail?.id ?? null,
          incomingSubject: subject ?? null,
          googleSubjectBefore: byEmail?.googleSubject ?? null,
        });
        logSuperadminTrace("F1. SUBJECT BIND UPDATE AFTER", {
          rowsAffected: 0,
          returnedUserId: byEmail?.id ?? null,
          googleSubjectAfter: byEmail?.googleSubject ?? null,
        });
        user = byEmail;
      }
    } else {
      logSuperadminTrace("E0. EMAIL LOOKUP BEFORE", {
        email: email ?? null,
      });
      logSuperadminTrace("E1. EMAIL LOOKUP AFTER", {
        found: false,
        userId: null,
        email,
        googleSubjectBefore: null,
        isSuperAdmin: null,
        active: null,
        suspended: null,
      });
      logSuperadminTrace("F0. SUBJECT BIND UPDATE BEFORE", {
        userId: null,
        incomingSubject: subject ?? null,
        googleSubjectBefore: null,
      });
      logSuperadminTrace("F1. SUBJECT BIND UPDATE AFTER", {
        rowsAffected: 0,
        returnedUserId: null,
        googleSubjectAfter: user.googleSubject ?? null,
      });
    }

    if (!user) {
      logSuperadminTrace("G. FINAL USER CHOSEN FOR AUTH", {
        userId: null,
        email: email ?? null,
        googleSubject: subject ?? null,
        isSuperAdmin: null,
        active: null,
        suspended: null,
        activeOrgId: null,
      });
      if (isSuperadminAccessMode) {
        logSuperadminTrace("H. ACCESS PROFILE DECISION", {
          appSlug: activeAppSlug,
          accessMode: app?.accessMode ?? (activeAppSlug === "admin" ? "superadmin" : null),
          normalizedAccessProfile,
          allow: false,
          denyReason: "user_not_found_in_superadmin_mode",
        });
        await denyWithAccessDenied();
        return;
      }
      logSuperadminTrace("H. ACCESS PROFILE DECISION", {
        appSlug: activeAppSlug,
        accessMode: app?.accessMode ?? null,
        normalizedAccessProfile,
        allow: false,
        denyReason: "user_not_found",
      });
      await denyWithAccessDenied();
      return;
    }

    logSuperadminTrace("G. FINAL USER CHOSEN FOR AUTH", {
      userId: user.id,
      email: user.email,
      googleSubject: user.googleSubject ?? null,
      isSuperAdmin: user.isSuperAdmin,
      active: user.active,
      suspended: user.suspended,
      activeOrgId: user.activeOrgId ?? null,
    });

    if (isSuperadminAccessMode && user.isSuperAdmin !== true) {
      logSuperadminTrace("H. ACCESS PROFILE DECISION", {
        appSlug: activeAppSlug,
        accessMode: app?.accessMode ?? (activeAppSlug === "admin" ? "superadmin" : null),
        normalizedAccessProfile,
        allow: false,
        denyReason: "not_superadmin",
      });
      await denyWithAccessDenied();
      return;
    }

    await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));

    req.session.userId = user.id;
    req.session.isSuperAdmin = Boolean(user.isSuperAdmin);
    req.session.activeOrgId = user.activeOrgId ?? undefined;
    req.session.sessionAuthenticatedAt = Date.now();
    req.session.sessionGroup = oauthSessionGroup;
    req.session.appSlug = activeAppSlug;
    logSessionCookieConfig();
    console.log(
      `[AUTH-CHECK-TRACE] CALLBACK SESSION WRITE BEFORE_SAVE ` +
      `userId=${req.session.userId ?? null} ` +
      `isSuperAdmin=${req.session.isSuperAdmin ?? false} ` +
      `sessionGroup=${req.session.sessionGroup ?? null} ` +
      `appSlug=${req.session.appSlug ?? null} ` +
      `sessionKeys=${Object.keys(req.session ?? {}).sort().join(",")}`
    );
    logSuperadminTrace("G0. SESSION WRITE BEFORE", {
      sessionGroup: oauthSessionGroup,
      userId: user.id,
      isSuperAdmin: Boolean(user.isSuperAdmin),
      appSlug: activeAppSlug,
      cookieName: getSessionCookieName(oauthSessionGroup),
      cookieDomain: getSessionCookieOptions().domain ?? null,
      cookiePath: getSessionCookieOptions().path,
      cookieSameSite: getSessionCookieOptions().sameSite,
      cookieSecure: getSessionCookieOptions().secure,
    });

    await new Promise<void>((resolve, reject) => {
      req.session.save((saveErr: unknown) => {
        if (saveErr) {
          reject(saveErr);
          return;
        }
        resolve();
      });
    });

    console.log(
      `[AUTH-CHECK-TRACE] CALLBACK SESSION WRITE AFTER_SAVE ` +
      `sessionExists=${Boolean(req.session)} ` +
      `sessionId=${req.sessionID ?? "null"} ` +
      `userId=${String((req.session as any)?.userId ?? (req.session as any)?.user?.id ?? "null")} ` +
      `isSuperAdmin=${String((req.session as any)?.isSuperAdmin ?? (req.session as any)?.user?.isSuperAdmin ?? false)} ` +
      `sessionGroup=${String((req.session as any)?.sessionGroup ?? "null")} ` +
      `appSlug=${String((req.session as any)?.appSlug ?? "null")} ` +
      `sessionKeys=${Object.keys(req.session ?? {}).join(",")}`
    );
    logSuperadminTrace("G1. SESSION WRITE AFTER", {
      sessionExists: Boolean(req.session),
      sessionId: req.session?.id ?? null,
      sessionGroup: req.session.sessionGroup ?? null,
      sessionUserId: req.session.userId ?? null,
      sessionIsSuperAdmin: req.session.isSuperAdmin ?? false,
      sessionAppSlug: req.session.appSlug ?? null,
      cookieName: getSessionCookieName(oauthSessionGroup),
      cookieDomain: getSessionCookieOptions().domain ?? null,
      cookiePath: getSessionCookieOptions().path,
      cookieSameSite: getSessionCookieOptions().sameSite,
      cookieSecure: getSessionCookieOptions().secure,
    });

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
      logSuperadminTrace("H. ACCESS PROFILE DECISION", {
        appSlug: activeAppSlug,
        accessMode: app?.accessMode ?? (activeAppSlug === "admin" ? "superadmin" : null),
        normalizedAccessProfile: effectiveContext?.normalizedAccessProfile ?? normalizedAccessProfile,
        allow: false,
        denyReason: "app_context_denied",
      });
      logSuperadminTrace("J. CALLBACK EXIT", {
        redirectTo: getAccessDeniedRedirect(frontendBase),
        outcome: "deny",
        lastCompletedStep,
      });
      await destroySessionAndClearCookie(req, res, oauthSessionGroup);
      res.redirect(getAccessDeniedRedirect(frontendBase));
      return;
    }
    logSuperadminTrace("H. ACCESS PROFILE DECISION", {
      appSlug: activeAppSlug,
      accessMode: app?.accessMode ?? (activeAppSlug === "admin" ? "superadmin" : null),
      normalizedAccessProfile: effectiveContext.normalizedAccessProfile,
      allow: true,
      denyReason: null,
    });
    const destination = getPostAuthRedirectPath({
      isSuperAdmin: user.isSuperAdmin,
      normalizedAccessProfile: effectiveContext.normalizedAccessProfile,
      requiredOnboarding: effectiveContext.requiredOnboarding,
      authIntent: oauthIntent,
    });
    logSuperadminTrace("J. CALLBACK EXIT", {
      redirectTo: `${frontendBase}${destination}`,
      outcome: "allow",
      lastCompletedStep,
    });
    res.redirect(`${frontendBase}${destination}`);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : typeof error;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logSuperadminTrace("X. CALLBACK ERROR", {
      message: errorMessage,
      stack: errorStack,
      name: errorName,
    });
    logSuperadminTrace("R. EARLY RETURN", {
      reason: "unknown_pre_auth_failure",
      redirectTo: getAccessDeniedRedirect(callbackFrontendBase),
    });
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
