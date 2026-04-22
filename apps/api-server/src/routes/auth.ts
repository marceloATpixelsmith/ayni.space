import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  appsTable,
  authTokensTable,
  db,
  orgAppAccessTable,
  pool,
  userCredentialsTable,
  usersTable,
  orgMembershipsTable,
  organizationsTable,
  userAuthSecurityTable,
} from "@workspace/db";
import { getAppBySlug, getAppContext } from "../lib/appAccess.js";
import { buildGoogleAuthUrl, exchangeCodeForUser } from "../lib/auth.js";
import {
  applySessionPersistence,
  destroySessionAndClearCookie,
  getDeleteAllOtherSessionsForUserSql,
  getSessionCookieName,
  getSessionCookieOptions,
  logSessionCookieConfig,
} from "../lib/session.js";
import {
  getAdminSessionGroupOrigins,
  getAllowedOrigins,
  resolveSessionGroupForRequest,
  resolveSessionGroupFromOrigin,
  resolveSessionGroupFromAppSlug,
  SESSION_GROUPS,
} from "../lib/sessionGroup.js";
import {
  getRequestedAppSlugFromRequest,
  mapAuthContextFailureToAuthErrorCode,
  resolveAppContextForAuth,
} from "../lib/authContextPolicy.js";
import { writeAuditLog } from "../lib/audit.js";
import { getAbuseClientKey, recordAbuseSignal } from "../lib/authAbuse.js";
import { resolvePostAuthFlowDecision } from "../lib/postAuthFlow.js";
import {
  resolveAuthenticatedPostAuthDestination,
  type PostAuthResolutionStage,
} from "../lib/postAuthDestination.js";
import {
  resolvePostAuthContinuation,
  type PostAuthContinuation,
} from "../lib/postAuthContinuation.js";
import {
  isSessionGroupCompatible,
  resolveSessionGroupForApp,
} from "../lib/sessionGroupCompatibility.js";
import {
  isTurnstileEnabled,
  verifyTurnstileTokenDetailed,
  logTurnstileVerificationResult,
} from "../middlewares/turnstile.js";
import {
  authRateLimiter,
  authRateLimiterWithIdentifier,
} from "../middlewares/rateLimit.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { resolveNormalizedAccessProfile } from "../lib/appAccessProfile.js";
import { buildAccessDeniedLoginPath } from "../lib/postAuthRedirect.js";
import {
  AUTH_ERROR_CODES,
  buildAuthErrorLoginPath,
  parseAuthErrorCode,
} from "@workspace/auth";
import { infoVerboseTrace, logVerboseTrace } from "../lib/traceLogging.js";
import {
  generateOpaqueToken,
  getPasswordAuthOpaqueIdentifier,
  hashOpaqueToken,
  hashPassword,
  isStrongEnoughPassword,
  normalizeEmail as normalizeEmailAddress,
  verifyPassword,
} from "../lib/passwordAuth.js";
import { assessSignupRiskWithIpqs } from "../lib/ipqs.js";
import {
  activateTotpEnrollment,
  beginTotpEnrollment,
  buildTotpOtpauthUrl,
  clearFirstAuthAfterReset,
  getTrustedDeviceCookieName,
  getTrustedDeviceCookieOptions,
  getUserAuthSecurity,
  hasActiveMfaFactor,
  isMfaRequiredForUser,
  isTrustedDevice,
  markPasswordResetSecurityEvent,
  markUserHighRiskStepUp,
  rememberTrustedDevice,
  revokeTrustedDevicesForUser,
  verifyMfaChallenge,
} from "../lib/mfa.js";
import { getMfaIssuerForSessionGroup } from "../lib/sessionGroupDisplay.js";
import { getGlobalSettingSnapshot, getMfaIssuerForAppSlug, GLOBAL_SETTING_KEYS, refreshRuntimeCache } from "../lib/runtimeSettings.js";
import {
  sendLane1AuthVerificationEmail,
  sendLane1PasswordResetEmail,
} from "../lib/invitationEmail.js";
import {
  ensureAuthFlowId,
  getRequestCookieValue,
  getSetCookieValueForName,
  logAuthDebug,
  toVisibleSessionId,
} from "../lib/authDebug.js";

const router = Router();
const SUPERADMIN_TRACE_PREFIX = "[SUPERADMIN-AUTH-TRACE]";

export const authRouteDeps = {
  exchangeCodeForUserFn: exchangeCodeForUser,
};

function attachAuthResponseDiagnostics(
  req: Request,
  res: Response,
  route: string,
) {
  if (process.env["AUTH_DEBUG"] !== "true") return;
  if ((res.locals as { __authDiagAttached?: boolean }).__authDiagAttached)
    return;
  (res.locals as { __authDiagAttached?: boolean }).__authDiagAttached = true;

  res.on("finish", () => {
    const sessionGroup =
      req.resolvedSessionGroup ??
      req.session?.sessionGroup ??
      SESSION_GROUPS.DEFAULT;
    const cookieName = getSessionCookieName(sessionGroup);
    const requestCookieValue = getRequestCookieValue(req, cookieName);
    const responseCookieValue = getSetCookieValueForName(res, cookieName);
    logAuthDebug(req, "session_cookie_response", {
      route,
      status: res.statusCode,
      cookieName,
      requestCookieSessionId: toVisibleSessionId(requestCookieValue),
      responseSetCookieSessionId: toVisibleSessionId(responseCookieValue),
      responseSetCookiePresent: Boolean(responseCookieValue),
      requestSessionId: req.sessionID ?? null,
      sessionKeys: Object.keys(req.session ?? {})
        .sort()
        .join(","),
      userId: req.session?.userId ?? null,
      pendingUserId: req.session?.pendingUserId ?? null,
    });
  });
}

function getRequestFrontendOrigin(req: Request): string | null {
  const allowedOrigins = getAllowedOrigins();
  const candidateOrigins: string[] = [];
  const originHeader = req.headers["origin"];
  if (typeof originHeader === "string" && originHeader.trim()) {
    candidateOrigins.push(originHeader.trim());
  }

  const refererHeader = req.headers["referer"];
  if (typeof refererHeader === "string" && refererHeader.trim()) {
    candidateOrigins.push(refererHeader.trim());
  }

  const forwardedHost =
    typeof req.headers["x-forwarded-host"] === "string"
      ? req.headers["x-forwarded-host"].trim()
      : "";
  const forwardedProtoRaw =
    typeof req.headers["x-forwarded-proto"] === "string"
      ? req.headers["x-forwarded-proto"].trim()
      : "";
  const forwardedProto = forwardedProtoRaw.split(",", 1)[0]?.trim() || "";
  if (forwardedHost) {
    const proto = forwardedProto || "https";
    candidateOrigins.push(`${proto}://${forwardedHost}`);
  }

  for (const candidate of candidateOrigins) {
    try {
      const normalizedOrigin = new URL(candidate).origin;
      if (allowedOrigins.includes(normalizedOrigin)) return normalizedOrigin;
    } catch {
      // noop
    }
  }
  return null;
}

function getCurrentRequestSessionGroup(req: Request): string {
  const resolution = resolveSessionGroupForRequest(req, {
    failOnAmbiguous: true,
  });
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
  returnToPath?: string;
};
type OAuthStateContext = Pick<
  OAuthStatePayload,
  "appSlug" | "returnTo" | "sessionGroup" | "returnToPath"
>;

function normalizeReturnToPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  return trimmed;
}

function encodeOAuthStatePayload(payload: OAuthStatePayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeOAuthStatePayload(
  encodedPayload: string,
): OAuthStatePayload | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (typeof parsed["nonce"] !== "string") return null;
    if (
      typeof parsed["appSlug"] !== "string" ||
      parsed["appSlug"].trim().length === 0
    )
      return null;
    if (
      typeof parsed["returnTo"] !== "string" ||
      parsed["returnTo"].trim().length === 0
    )
      return null;
    if (
      typeof parsed["sessionGroup"] !== "string" ||
      parsed["sessionGroup"].trim().length === 0
    )
      return null;
    const returnToPath = normalizeReturnToPath(parsed["returnToPath"]);
    return {
      nonce: parsed["nonce"],
      appSlug: parsed["appSlug"],
      returnTo: parsed["returnTo"],
      sessionGroup: parsed["sessionGroup"],
      returnToPath: returnToPath ?? undefined,
    };
  } catch {
    return null;
  }
}

function buildOAuthState(payload: OAuthStatePayload): string {
  return `${payload.sessionGroup}.${payload.nonce}.${encodeOAuthStatePayload(payload)}`;
}

function parseOAuthState(
  state: string | null | undefined,
): OAuthStatePayload | null {
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

function parseOAuthStateReturnTo(
  state: string | null | undefined,
): string | null {
  if (!state) return null;
  const segments = state.split(".");
  if (segments.length < 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(segments.slice(2).join("."), "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (
      typeof payload["returnTo"] !== "string" ||
      payload["returnTo"].trim().length === 0
    )
      return null;
    const origin = new URL(payload["returnTo"]).origin;
    return getAllowedOrigins().includes(origin) ? origin : null;
  } catch {
    return null;
  }
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
    returnToPath: parsedState.returnToPath,
  };
  return { valid: true, stateContext };
}

function firstQueryParam(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function logSuperadminTrace(
  checkpoint: string,
  payload: Record<string, unknown>,
) {
  logVerboseTrace(`${SUPERADMIN_TRACE_PREFIX} ${checkpoint}`, payload);
}

function logAuthCheckTrace(
  req: Request,
  payload: {
    sessionExists: boolean;
    sessionGroup: string | null;
    userId: string | null;
    isSuperAdmin: boolean;
    allow: boolean;
    denyReason: string | null;
    sessionKeys: string;
  },
) {
  logAuthDebug(req, "auth_me_guard_decision", payload);
  const {
    sessionExists,
    sessionGroup,
    userId,
    isSuperAdmin,
    allow,
    denyReason,
    sessionKeys,
  } = payload;
  logVerboseTrace(
    `[AUTH-CHECK-TRACE] AUTH ROUTE CHECK ` +
      `sessionExists=${sessionExists} ` +
      `sessionGroup=${sessionGroup} ` +
      `userId=${userId} ` +
      `isSuperAdmin=${isSuperAdmin} ` +
      `allow=${allow} ` +
      `denyReason=${denyReason} ` +
      `sessionKeys=${sessionKeys}`,
  );
}

function getAccessDeniedRedirect(frontendBase: string | null): string {
  const path = buildAccessDeniedLoginPath();
  if (!frontendBase) return path;
  return `${frontendBase}${path}`;
}

function getControlledAuthErrorRedirect(
  frontendBase: string | null,
  code: string,
): string {
  const parsedCode = parseAuthErrorCode(code);
  const path = buildAuthErrorLoginPath(
    parsedCode ?? AUTH_ERROR_CODES.ACCESS_DENIED,
  );
  if (!frontendBase) return path;
  return `${frontendBase}${path}`;
}

function getFrontendBaseForDeny(
  req: Request,
  oauthSessionGroup: string,
): string | null {
  const oauthReturnTo = req.session?.oauthReturnTo;
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
  const bodyToken =
    typeof req.body?.["cf-turnstile-response"] === "string"
      ? req.body["cf-turnstile-response"]
      : undefined;
  return bodyToken ?? headerToken ?? "";
}

function getCookieValue(req: Request, cookieName: string): string | null {
  const cookieHeader = req.headers["cookie"];
  if (typeof cookieHeader !== "string") return null;
  for (const entry of cookieHeader.split(";")) {
    const [name, value] = entry.split("=");
    if (name?.trim() === cookieName) return (value ?? "").trim();
  }
  return null;
}

function logAuthFailure(
  req: Request,
  reason: string,
  metadata: Record<string, unknown> = {},
) {
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

function logGoogleUrlBranch(
  req: Request,
  branch: string,
  metadata: Record<string, unknown> = {},
) {
  infoVerboseTrace("[auth/google/url]", {
    branch,
    method: req.method,
    path: req.path,
    origin:
      typeof req.headers["origin"] === "string" ? req.headers["origin"] : null,
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
  void refreshRuntimeCache();
  const redirectUriRaw = String(getGlobalSettingSnapshot<string>(GLOBAL_SETTING_KEYS.GOOGLE_REDIRECT_URI, process.env["GOOGLE_REDIRECT_URI"] ?? "")).trim();
  let redirectUriValid = false;
  if (redirectUriRaw) {
    try {
      const parsed = new URL(redirectUriRaw);
      redirectUriValid =
        parsed.protocol === "https:" || parsed.protocol === "http:";
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
  ensureAuthFlowId(req);
  attachAuthResponseDiagnostics(req, res, "/api/auth/me");
  logAuthDebug(req, "auth_me_request", {
    requestSessionId: req.sessionID ?? null,
    sessionGroup: req.resolvedSessionGroup ?? req.session?.sessionGroup ?? null,
    sessionKeys: Object.keys(req.session ?? {})
      .sort()
      .join(","),
    userId: req.session?.userId ?? null,
    pendingUserId: req.session?.pendingUserId ?? null,
  });
  const authenticatedUser = (
    req as Request & { user?: typeof usersTable.$inferSelect }
  ).user;
  const userId = authenticatedUser?.id ?? req.session.userId;
  const sessionGroup =
    req.session.sessionGroup ?? req.resolvedSessionGroup ?? null;
  const sessionKeys = Object.keys(req.session ?? {})
    .sort()
    .join(",");
  if (!userId || !authenticatedUser) {
    logAuthCheckTrace(req, {
      sessionExists: Boolean(req.session),
      sessionGroup,
      userId: userId ?? null,
      isSuperAdmin: false,
      allow: false,
      denyReason: "missing_authenticated_user",
      sessionKeys,
    });
    res.status(401).json({ error: "Unauthorized. Please sign in." });
    return;
  }

  const hasPendingMfaSession = Boolean(
    req.session.pendingUserId || req.session.pendingMfaReason,
  );

  const pendingMfaUserId =
    hasPendingMfaSession &&
    typeof req.session.pendingUserId === "string" &&
    req.session.pendingUserId.trim().length > 0
      ? req.session.pendingUserId.trim()
      : null;
  const mfaLookupUserIds = Array.from(
    new Set(
      [
        pendingMfaUserId,
        authenticatedUser.id,
        typeof req.session.userId === "string" &&
        req.session.userId.trim().length > 0
          ? req.session.userId.trim()
          : null,
      ].filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0,
      ),
    ),
  );

  let mfaEnrolled = false;
  let mfaStateReadFailed = false;
  let mfaStateUserId = mfaLookupUserIds[0] ?? authenticatedUser.id;
  const mfaLookupResults: Array<{ userId: string; hasActiveFactor: boolean }> =
    [];
  for (const candidateUserId of mfaLookupUserIds) {
    try {
      const candidateEnrolled = await hasActiveMfaFactor(candidateUserId);
      mfaLookupResults.push({
        userId: candidateUserId,
        hasActiveFactor: candidateEnrolled,
      });
      if (candidateEnrolled) {
        mfaEnrolled = true;
        mfaStateUserId = candidateUserId;
        break;
      }
      if (!mfaEnrolled) {
        mfaStateUserId = candidateUserId;
      }
    } catch {
      mfaStateReadFailed = true;
      mfaLookupResults.push({
        userId: candidateUserId,
        hasActiveFactor: false,
      });
    }
  }

  const pendingReason = req.session.pendingMfaReason;
  const resolvePendingMfaState = () => {
    if (!hasPendingMfaSession) {
      return {
        pendingMfaEnrolled: mfaEnrolled,
        pendingNextStep: null as "mfa_enroll" | "mfa_challenge" | null,
        pendingResolution: "no_pending_session",
      };
    }

    if (pendingReason === "challenge_required") {
      return {
        pendingMfaEnrolled: true,
        pendingNextStep: "mfa_challenge" as const,
        pendingResolution: "session_reason_challenge_required",
      };
    }

    if (pendingReason === "enrollment_required") {
      if (mfaStateReadFailed) {
        return {
          pendingMfaEnrolled: true,
          pendingNextStep: "mfa_challenge" as const,
          pendingResolution:
            "enrollment_reason_factor_read_failed_fail_closed_to_challenge",
        };
      }
      if (mfaEnrolled) {
        return {
          pendingMfaEnrolled: true,
          pendingNextStep: "mfa_challenge" as const,
          pendingResolution:
            "enrollment_reason_overridden_by_live_factor_state",
        };
      }
      return {
        pendingMfaEnrolled: false,
        pendingNextStep: "mfa_enroll" as const,
        pendingResolution: "session_reason_enrollment_required",
      };
    }

    return {
      pendingMfaEnrolled: mfaStateReadFailed ? true : mfaEnrolled,
      pendingNextStep:
        mfaStateReadFailed || mfaEnrolled
          ? ("mfa_challenge" as const)
          : ("mfa_enroll" as const),
      pendingResolution: mfaStateReadFailed
        ? "missing_reason_factor_read_failed_fail_closed_to_challenge"
        : mfaEnrolled
          ? "missing_reason_live_factor_active"
          : "missing_reason_no_active_factor",
    };
  };
  const { pendingMfaEnrolled, pendingNextStep, pendingResolution } =
    resolvePendingMfaState();

  if (hasPendingMfaSession) {
    logAuthCheckTrace(req, {
      sessionExists: Boolean(req.session),
      sessionGroup,
      userId: authenticatedUser.id,
      isSuperAdmin: Boolean(authenticatedUser.isSuperAdmin),
      allow: true,
      denyReason: null,
      sessionKeys,
    });
    logAuthDebug(req, "auth_me_result", {
      userId: authenticatedUser.id,
      sessionGroup,
      appSlug: req.session.appSlug ?? null,
      mfaRequired: true,
      mfaPending: true,
      mfaEnrolled: pendingMfaEnrolled,
      mfaStateReadFailed,
      pendingReason: pendingReason ?? null,
      pendingResolution,
      mfaStateUserId,
      pendingMfaUserId,
      mfaLookupUserIds,
      mfaLookupResults,
      nextStep: pendingNextStep,
      hasPendingMfaSession: true,
    });
    res.json({
      authenticated: false,
      authState: "mfa_pending",
      sessionState: "pending_second_factor",
      userId: authenticatedUser.id,
      id: authenticatedUser.id,
      email: authenticatedUser.email,
      name: authenticatedUser.name,
      avatarUrl: authenticatedUser.avatarUrl,
      isSuperAdmin: authenticatedUser.isSuperAdmin,
      mfaRequired: true,
      mfaPending: true,
      mfaPendingReason: pendingReason ?? null,
      mfaEnrolled: pendingMfaEnrolled,
      nextStep: pendingNextStep,
      nextPath:
        pendingNextStep === "mfa_enroll" ? "/mfa/enroll" : "/mfa/challenge",
      needsEnrollment: pendingNextStep === "mfa_enroll",
      activeOrgId: null,
      activeOrg: null,
      memberships: [],
      appAccess: null,
    });
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
    .innerJoin(
      organizationsTable,
      eq(orgMembershipsTable.orgId, organizationsTable.id),
    )
    .where(eq(orgMembershipsTable.userId, userId));

  let activeOrg = null;
  if (authenticatedUser.activeOrgId) {
    const activeOrgCandidate = await db.query.organizationsTable.findFirst({
      where: eq(organizationsTable.id, authenticatedUser.activeOrgId),
    });
    if (activeOrgCandidate) {
      let activeOrgAppAccessRows: Array<typeof orgAppAccessTable.$inferSelect> =
        [];
      try {
        activeOrgAppAccessRows = await db.query.orgAppAccessTable.findMany({
          where: and(
            eq(orgAppAccessTable.orgId, activeOrgCandidate.id),
            eq(orgAppAccessTable.enabled, true),
          ),
        });
      } catch {
        activeOrgAppAccessRows = [];
      }
      if (activeOrgAppAccessRows.length === 0 && activeOrgCandidate.appId) {
        activeOrgAppAccessRows.push({
          id: `legacy-${activeOrgCandidate.id}-${activeOrgCandidate.appId}`,
          orgId: activeOrgCandidate.id,
          appId: activeOrgCandidate.appId,
          enabled: true,
          createdAt: activeOrgCandidate.createdAt,
          updatedAt: activeOrgCandidate.updatedAt,
        });
      }
      const activeOrgVisible = (
        await Promise.all(
          activeOrgAppAccessRows.map(async (orgAppAccess) => {
            const app = await db.query.appsTable.findFirst({
              where: and(
                eq(appsTable.id, orgAppAccess.appId),
                eq(appsTable.isActive, true),
              ),
            });
            if (!app) return false;
            return isSessionGroupCompatible(
              sessionGroup,
              resolveSessionGroupForApp({
                slug: app.slug,
                metadata: app.metadata ?? {},
              }),
            );
          }),
        )
      ).some(Boolean);

      if (activeOrgVisible) activeOrg = activeOrgCandidate;
    }
  }

  type MembershipRow = (typeof memberships)[number];
  const scopedMemberships = (
    await Promise.all(
      memberships.map(async (membership: MembershipRow) => {
        let membershipOrgAppAccessRows: Array<
          typeof orgAppAccessTable.$inferSelect
        > = [];
        try {
          membershipOrgAppAccessRows =
            await db.query.orgAppAccessTable.findMany({
              where: and(
                eq(orgAppAccessTable.orgId, membership.orgId),
                eq(orgAppAccessTable.enabled, true),
              ),
            });
        } catch {
          membershipOrgAppAccessRows = [];
        }
        if (membershipOrgAppAccessRows.length === 0) {
          const membershipOrg = await db.query.organizationsTable.findFirst({
            where: eq(organizationsTable.id, membership.orgId),
          });
          if (membershipOrg?.appId) {
            membershipOrgAppAccessRows.push({
              id: `legacy-${membershipOrg.id}-${membershipOrg.appId}`,
              orgId: membershipOrg.id,
              appId: membershipOrg.appId,
              enabled: true,
              createdAt: membershipOrg.createdAt,
              updatedAt: membershipOrg.updatedAt,
            });
          }
        }
        const membershipVisible = (
          await Promise.all(
            membershipOrgAppAccessRows.map(async (orgAppAccess) => {
              const app = await db.query.appsTable.findFirst({
                where: and(
                  eq(appsTable.id, orgAppAccess.appId),
                  eq(appsTable.isActive, true),
                ),
              });
              if (!app) return false;
              return isSessionGroupCompatible(
                sessionGroup,
                resolveSessionGroupForApp({
                  slug: app.slug,
                  metadata: app.metadata ?? {},
                }),
              );
            }),
          )
        ).some(Boolean);
        if (!membershipVisible) return null;
        return membership;
      }),
    )
  ).filter((membership: MembershipRow | null): membership is MembershipRow =>
    Boolean(membership),
  );

  logAuthCheckTrace(req, {
    sessionExists: Boolean(req.session),
    sessionGroup,
    userId: authenticatedUser.id,
    isSuperAdmin: Boolean(authenticatedUser.isSuperAdmin),
    allow: true,
    denyReason: null,
    sessionKeys,
  });

  const sessionAppSlug =
    typeof req.session.appSlug === "string" ? req.session.appSlug.trim() : "";
  const appAccessContext = sessionAppSlug
    ? await getAppContext(authenticatedUser.id, sessionAppSlug)
    : null;
  const mfaRequired = await isMfaRequiredForUser(
    authenticatedUser.id,
    authenticatedUser.activeOrgId,
  );
  logAuthDebug(req, "auth_me_result", {
    userId: authenticatedUser.id,
    sessionGroup,
    appSlug: req.session.appSlug ?? null,
    mfaRequired,
    mfaPending: false,
    mfaEnrolled,
    mfaStateReadFailed,
    nextStep: null,
    hasPendingMfaSession: false,
  });

  res.json({
    authenticated: true,
    authState: "authenticated",
    sessionState: "authenticated",
    id: authenticatedUser.id,
    email: authenticatedUser.email,
    name: authenticatedUser.name,
    avatarUrl: authenticatedUser.avatarUrl,
    isSuperAdmin: authenticatedUser.isSuperAdmin,
    activeOrgId: activeOrg?.id ?? null,
    activeOrg: activeOrg,
    memberships: scopedMemberships,
    mfaRequired,
    mfaPending: false,
    mfaEnrolled,
    needsEnrollment: false,
    nextStep: null,
    nextPath: null,
    appAccess: appAccessContext
      ? {
          appSlug: sessionAppSlug,
          canAccess: appAccessContext.canAccess,
          requiredOnboarding: appAccessContext.requiredOnboarding,
          defaultRoute: appAccessContext.defaultRoute,
          normalizedAccessProfile: appAccessContext.normalizedAccessProfile,
        }
      : null,
  });
}

async function handleLogout(req: Request, res: Response) {
  try {
    await destroySessionAndClearCookie(
      req,
      res,
      getCurrentRequestSessionGroup(req),
    );
    res.clearCookie(
      getTrustedDeviceCookieName(),
      getTrustedDeviceCookieOptions(),
    );
    res.json({ success: true, message: "Logged out successfully" });
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.startsWith("session_group_resolution_failed:")
    ) {
      res
        .status(400)
        .json({ error: "Unable to resolve session group for logout" });
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
      logGoogleUrlBranch(req, "turnstile_missing_token", {
        turnstileVerificationPassed: false,
      });
      logAuthFailure(req, "google-url-turnstile-missing");
      sendGoogleUrlError(
        req,
        res,
        403,
        "TURNSTILE_MISSING_TOKEN",
        "Please complete the verification challenge.",
        "turnstile_missing_token",
      );
      return;
    }

    const turnstileResult = await verifyTurnstileTokenDetailed(
      turnstileToken,
      req.ip,
    );
    if (!turnstileResult.ok) {
      logGoogleUrlBranch(req, "turnstile_verification_failed", {
        reason: turnstileResult.reason,
        turnstileVerificationPassed: false,
      });
      logAuthFailure(req, "google-url-turnstile-invalid");
      await logTurnstileVerificationResult(req, turnstileResult);
      if (turnstileResult.reason === "missing-token") {
        sendGoogleUrlError(
          req,
          res,
          403,
          "TURNSTILE_MISSING_TOKEN",
          "Please complete the verification challenge.",
          "turnstile_missing_token",
        );
        return;
      }
      if (turnstileResult.reason === "missing-secret") {
        sendGoogleUrlError(
          req,
          res,
          500,
          "TURNSTILE_MISCONFIGURED",
          "Turnstile verification is misconfigured. Please contact support.",
          "turnstile_misconfigured",
        );
        return;
      }
      if (turnstileResult.reason === "verification-error") {
        sendGoogleUrlError(
          req,
          res,
          503,
          "TURNSTILE_UNAVAILABLE",
          "Verification service is temporarily unavailable. Please try again.",
          "turnstile_unavailable",
        );
        return;
      }
      if (turnstileResult.reason === "token-expired") {
        sendGoogleUrlError(
          req,
          res,
          403,
          "TURNSTILE_TOKEN_EXPIRED",
          "Verification expired. Please complete the challenge again.",
          "turnstile_token_expired",
        );
        return;
      }
      sendGoogleUrlError(
        req,
        res,
        403,
        "TURNSTILE_INVALID_TOKEN",
        "Security verification failed. Please try again.",
        "turnstile_invalid_token",
      );
      return;
    }
    logGoogleUrlBranch(req, "turnstile_verification_passed", {
      turnstileVerificationPassed: true,
    });
  }

  const returnTo = getRequestFrontendOrigin(req);
  if (!returnTo) {
    logGoogleUrlBranch(req, "origin_invalid", {
      turnstileVerificationPassed: Boolean(req.turnstileVerified),
    });
    logAuthFailure(req, "google-url-origin-invalid");
    sendGoogleUrlError(
      req,
      res,
      400,
      "ORIGIN_NOT_ALLOWED",
      "Request origin is missing or not allowed.",
      "origin_invalid",
    );
    return;
  }

  const appContext = await resolveAppContextForAuth({
    req,
    appSlug: firstQueryParam(req.query?.appSlug) ?? null,
    origin: returnTo,
    sessionGroup: req.resolvedSessionGroup ?? resolveSessionGroupFromOrigin(returnTo),
  });
  if (!appContext.ok) {
    console.error("[auth/google/url] app context resolution failed", {
      returnTo,
      reason: appContext.reason,
      details: appContext.details ?? null,
      resolvedSessionGroup: req.resolvedSessionGroup ?? null,
      originSessionGroup: resolveSessionGroupFromOrigin(returnTo),
      requestAppSlug: getRequestedAppSlugFromRequest(req),
    });
    logAuthFailure(req, "google-url-app-context-failed", {
      returnTo,
      reason: appContext.reason,
    });
    sendGoogleUrlError(
      req,
      res,
      400,
      mapAuthContextFailureToAuthErrorCode(appContext.reason),
      "App context is required to start OAuth.",
      appContext.reason,
    );
    return;
  }
  const appSlug = appContext.resolvedAppSlug;
  const oauthSessionGroup = appContext.sessionGroup;

  const returnToPath = normalizeReturnToPath(firstQueryParam(req.body?.returnToPath));

  const statePayload = {
    nonce: randomUUID(),
    appSlug,
    returnTo,
    sessionGroup: oauthSessionGroup,
    returnToPath: returnToPath ?? undefined,
  };
  const state = buildOAuthState(statePayload);
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
    sendGoogleUrlError(
      req,
      res,
      500,
      "OAUTH_URL_INVALID",
      "Google OAuth URL generation failed.",
      "oauth_url_generation_failed",
    );
    return;
  }

  req.session.oauthState = state;
  req.session.oauthStayLoggedIn = req.body?.stayLoggedIn === true;
  req.session.oauthReturnTo = returnTo;
  req.session.oauthReturnToPath = returnToPath ?? undefined;
  req.session.oauthSessionGroup = oauthSessionGroup;
  req.session.oauthAppSlug = appSlug;
  logSuperadminTrace("OAUTH START", {
    appSlug,
    returnTo,
    sessionGroup: oauthSessionGroup,
    generatedStateHasAppSlug: true,
  });
  logSuperadminTrace("STATE CREATED", {
    appSlug: statePayload.appSlug,
    returnTo: statePayload.returnTo,
    returnToPath: statePayload.returnToPath ?? null,
    sessionGroup: statePayload.sessionGroup,
  });
  logVerboseTrace(
    `[AUTH-CHECK-TRACE] OAUTH STATE CREATED ` +
      `appSlug=${appSlug ?? "null"} ` +
      `returnTo=${returnTo ?? "null"} ` +
      `sessionGroup=${oauthSessionGroup ?? "null"}`,
  );
  logSessionCookieConfig();

  req.session.save((err: unknown) => {
    if (err) {
      logGoogleUrlBranch(req, "session_init_failed", {
        status: 500,
        code: "OAUTH_SESSION_INIT_FAILED",
      });
      logAuthFailure(req, "google-url-session-init-failed");
      res
        .status(500)
        .json({
          error: "Failed to initialize OAuth session.",
          code: "OAUTH_SESSION_INIT_FAILED",
        });
      return;
    }
    logGoogleUrlBranch(req, "success", {
      sessionGroup: oauthSessionGroup,
      status: 200,
      configValidationPassed: true,
    });
    res.json({ url });
  });
}

async function handleGoogleCallback(req: Request, res: Response) {
  let lastCompletedStep:
    | "A0"
    | "A1"
    | "A2"
    | "A3"
    | "A4"
    | "A5"
    | "A6"
    | "A7"
    | "A8"
    | "A" = "A0";
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
    const oauthSessionGroup =
      callbackSessionGroup ??
      req.session?.oauthSessionGroup ??
      stateSessionGroup ??
      SESSION_GROUPS.DEFAULT;
    const frontendBase =
      callbackFrontendBase ?? getFrontendBaseForDeny(req, oauthSessionGroup);
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
        redirectTo: getAccessDeniedRedirect(
          getFrontendBaseForDeny(req, SESSION_GROUPS.DEFAULT),
        ),
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
        redirectTo: getAccessDeniedRedirect(
          getFrontendBaseForDeny(req, SESSION_GROUPS.DEFAULT),
        ),
      });
      await denyWithAccessDenied();
      return;
    }

    const stateValidation = validateOAuthCallbackState(
      state,
      req.session.oauthState,
    );
    const stateValid = stateValidation.valid;
    const stateSessionGroup = state ? parseGroupFromOAuthState(state) : null;
    const stateContext = stateValidation.valid
      ? stateValidation.stateContext
      : null;
    const resolvedStateSessionGroup =
      stateContext?.sessionGroup ??
      req.session.oauthSessionGroup ??
      stateSessionGroup ??
      SESSION_GROUPS.DEFAULT;
    logSuperadminTrace("A4. STATE VALIDATION RESULT", {
      valid: stateValid,
      appSlug: stateContext?.appSlug ?? null,
      returnTo: stateContext?.returnTo ?? null,
      returnToPath: stateContext?.returnToPath ?? null,
      sessionGroup: resolvedStateSessionGroup,
    });
    lastCompletedStep = "A4";
    if (!stateValid) {
      const parsedState = parseOAuthState(state);
      if (!parsedState?.appSlug) {
        const frontendBaseFromState = parseOAuthStateReturnTo(state);
        console.error(
          "[auth/google/callback] missing appSlug in OAuth callback state",
          {
            statePresent: Boolean(state),
            expectedStatePresent: typeof req.session.oauthState === "string",
            stateSessionGroup,
            frontendBaseFromState,
          },
        );
        await destroySessionAndClearCookie(req, res, resolvedStateSessionGroup);
        res.redirect(
          getControlledAuthErrorRedirect(
            frontendBaseFromState ??
              getFrontendBaseForDeny(req, resolvedStateSessionGroup),
            "app_slug_invalid",
          ),
        );
        return;
      }
      logAuthFailure(req, "google-callback-invalid-state");
      logSuperadminTrace("R. EARLY RETURN", {
        reason: "invalid_state",
        redirectTo: getAccessDeniedRedirect(
          getFrontendBaseForDeny(req, SESSION_GROUPS.DEFAULT),
        ),
      });
      await denyWithAccessDenied();
      return;
    }

    delete req.session.oauthState;
    const parsedStateContext = stateValidation.stateContext;
    logSuperadminTrace("STATE AFTER PARSE", {
      appSlug: parsedStateContext.appSlug,
      returnTo: parsedStateContext.returnTo,
      returnToPath: parsedStateContext.returnToPath ?? null,
      sessionGroup: parsedStateContext.sessionGroup,
    });
    const oauthReturnTo = parsedStateContext.returnTo;
    const oauthReturnToPath =
      parsedStateContext.returnToPath ?? req.session.oauthReturnToPath ?? null;
    const oauthStayLoggedIn = req.session.oauthStayLoggedIn === true;
    const stateSessionGroupCandidate =
      callbackSessionGroup ??
      parsedStateContext.sessionGroup ??
      req.session.oauthSessionGroup ??
      stateSessionGroup ??
      SESSION_GROUPS.DEFAULT;
    const appSlug = parsedStateContext.appSlug;
    const oauthSessionGroup = appSlug
      ? resolveSessionGroupFromAppSlug(appSlug)
      : stateSessionGroupCandidate;
    callbackSessionGroup = oauthSessionGroup;
    logSuperadminTrace("A1. PRE-CALLBACK-CONTEXT", {
      appSlug,
      returnTo: oauthReturnTo ?? null,
      returnToPath: oauthReturnToPath,
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
    delete req.session.oauthReturnToPath;
    delete req.session.oauthSessionGroup;
    delete req.session.oauthAppSlug;
    delete req.session.oauthStayLoggedIn;

    if (!oauthReturnTo) {
      logAuthFailure(req, "google-callback-missing-return-origin");
      logSuperadminTrace("R. EARLY RETURN", {
        reason: "missing_return_to",
        redirectTo: getAccessDeniedRedirect(
          getFrontendBaseForDeny(req, oauthSessionGroup),
        ),
      });
      await denyWithAccessDenied();
      return;
    }

    const frontendBase = oauthReturnTo;
    callbackFrontendBase = frontendBase;
    const activeAppSlug = appSlug;
    if (!activeAppSlug) {
      console.error(
        "[auth/google/callback] missing appSlug after state validation",
        {
          statePresent: Boolean(state),
          oauthReturnTo,
        },
      );
      logSuperadminTrace("R. EARLY RETURN", {
        reason: "missing_app_slug",
        redirectTo: getControlledAuthErrorRedirect(
          frontendBase,
          "app_slug_missing",
        ),
      });
      await destroySessionAndClearCookie(req, res, oauthSessionGroup);
      res.redirect(
        getControlledAuthErrorRedirect(frontendBase, "app_slug_missing"),
      );
      return;
    }

    logSuperadminTrace("B0. APP LOOKUP BEFORE", {
      appSlug: activeAppSlug,
    });
    const app = await getAppBySlug(activeAppSlug);
    logSuperadminTrace("B1. APP LOOKUP AFTER", {
      appSlug: activeAppSlug,
      appFound: Boolean(app),
      appId: app?.id ?? null,
    });

    if (!app) {
      console.error(
        "[auth/google/callback] app lookup failed for OAuth callback appSlug",
        {
          appSlug: activeAppSlug,
          frontendBase,
        },
      );
      logAuthFailure(req, "google-callback-app-not-found", {
        appSlug: activeAppSlug,
      });
      await destroySessionAndClearCookie(req, res, oauthSessionGroup);
      res.redirect(
        getControlledAuthErrorRedirect(frontendBase, "app_not_found"),
      );
      return;
    }

    const normalizedAccessProfile = resolveNormalizedAccessProfile(app);
    const isSuperadminAccessMode = normalizedAccessProfile === "superadmin";

    logSuperadminTrace("A5. TOKEN EXCHANGE START", {
      hasCode: Boolean(code),
    });
    lastCompletedStep = "A5";
    let googleUser: Awaited<
      ReturnType<typeof authRouteDeps.exchangeCodeForUserFn>
    >;
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
      staffInvitesEnabled: app?.staffInvitesEnabled ?? null,
      customerRegistrationEnabled: app?.customerRegistrationEnabled ?? null,
    });
    infoVerboseTrace("[auth/google/callback] resolved app context", {
      appSlug: activeAppSlug,
      appId: app.id,
      normalizedAccessProfile,
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
      user = await db.query.usersTable.findFirst({
        where: eq(usersTable.googleSubject, subject),
      });
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
        ? await db.query.usersTable.findFirst({
            where: sql`lower(${usersTable.email}) = ${email}`,
          })
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
          accessMode:
            app?.accessMode ?? null,
          normalizedAccessProfile,
          allow: false,
          denyReason: "user_not_found_in_superadmin_mode",
        });
        await denyWithAccessDenied();
        return;
      }

      const now = new Date();
      const createdRows = await db
        .insert(usersTable)
        .values({
          id: randomUUID(),
          email,
          name: googleUser.name ?? null,
          avatarUrl: googleUser.picture ?? null,
          googleSubject: subject ?? null,
          emailVerifiedAt: now,
          isSuperAdmin: false,
          active: true,
          suspended: false,
          deletedAt: null,
          lastLoginAt: now,
        })
        .returning();
      user = createdRows[0] ?? null;

      logSuperadminTrace("H. ACCESS PROFILE DECISION", {
        appSlug: activeAppSlug,
        accessMode: app?.accessMode ?? null,
        normalizedAccessProfile,
        allow: Boolean(user),
        denyReason: user ? null : "user_provisioning_failed",
      });

      if (!user) {
        await denyWithAccessDenied();
        return;
      }
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

    if (user.active === false || user.suspended === true || user.deletedAt) {
      logSuperadminTrace("H. ACCESS PROFILE DECISION", {
        appSlug: activeAppSlug,
        accessMode:
          app?.accessMode ?? null,
        normalizedAccessProfile,
        allow: false,
        denyReason: "inactive_or_suspended_user",
      });
      await denyWithAccessDenied();
      return;
    }

    if (isSuperadminAccessMode && user.isSuperAdmin !== true) {
      logSuperadminTrace("H. ACCESS PROFILE DECISION", {
        appSlug: activeAppSlug,
        accessMode:
          app?.accessMode ?? null,
        normalizedAccessProfile,
        allow: false,
        denyReason: "not_superadmin",
      });
      await denyWithAccessDenied();
      return;
    }

    await db
      .update(usersTable)
      .set({ lastLoginAt: new Date() })
      .where(eq(usersTable.id, user.id));

    const oauthMfaGate = await beginMfaPendingSession(
      req,
      user.id,
      activeAppSlug,
      oauthStayLoggedIn,
    );
    const oauthContinuation = resolvePostAuthContinuation({
      appSlug: activeAppSlug,
      returnPath: normalizeReturnToPath(oauthReturnToPath),
    });
    if (oauthMfaGate.required) {
      req.session.pendingPostAuthContinuation = oauthContinuation ?? undefined;
      await new Promise<void>((resolve, reject) => {
        req.session.save((err: unknown) => (err ? reject(err) : resolve()));
      });
      const mfaResponse = buildMfaRequiredAuthResponse(oauthMfaGate);
      res.redirect(`${frontendBase}${mfaResponse.nextPath}`);
      return;
    }

    req.session.userId = user.id;
    req.session.isSuperAdmin = Boolean(user.isSuperAdmin);
    req.session.activeOrgId = user.activeOrgId ?? undefined;
    req.session.sessionAuthenticatedAt = Date.now();
    req.session.sessionGroup = oauthSessionGroup;
    req.session.appSlug = activeAppSlug;
    applySessionPersistence(req, oauthStayLoggedIn);
    logSessionCookieConfig();
    logVerboseTrace(
      `[AUTH-CHECK-TRACE] CALLBACK SESSION WRITE BEFORE_SAVE ` +
        `userId=${req.session.userId ?? null} ` +
        `isSuperAdmin=${req.session.isSuperAdmin ?? false} ` +
        `sessionGroup=${req.session.sessionGroup ?? null} ` +
        `appSlug=${req.session.appSlug ?? null} ` +
        `sessionKeys=${Object.keys(req.session ?? {})
          .sort()
          .join(",")}`,
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

    logVerboseTrace(
      `[AUTH-CHECK-TRACE] CALLBACK SESSION WRITE AFTER_SAVE ` +
        `sessionExists=${Boolean(req.session)} ` +
        `sessionId=${req.sessionID ?? "null"} ` +
        `userId=${String((req.session as any)?.userId ?? (req.session as any)?.user?.id ?? "null")} ` +
        `isSuperAdmin=${String((req.session as any)?.isSuperAdmin ?? (req.session as any)?.user?.isSuperAdmin ?? false)} ` +
        `sessionGroup=${String((req.session as any)?.sessionGroup ?? "null")} ` +
        `appSlug=${String((req.session as any)?.appSlug ?? "null")} ` +
        `sessionKeys=${Object.keys(req.session ?? {}).join(",")}`,
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

    if (!normalizedAccessProfile) {
      await denyWithAccessDenied();
      return;
    }

    const effectiveContext = await resolvePostAuthFlowDecision({
      userId: user.id,
      appSlug: activeAppSlug,
      isSuperAdmin: Boolean(user.isSuperAdmin),
      normalizedAccessProfile,
    });

    if (!effectiveContext) {
      console.error("[auth/google/callback] unable to resolve app context", {
        appSlug: activeAppSlug,
        appId: app.id,
        userId: user.id,
      });
      logAuthFailure(req, "google-callback-missing-app-context", {
        appSlug: activeAppSlug,
        appId: app.id,
      });
      logSuperadminTrace("H. ACCESS PROFILE DECISION", {
        appSlug: activeAppSlug,
        accessMode: app.accessMode,
        normalizedAccessProfile: normalizedAccessProfile,
        allow: false,
        denyReason: "missing_app_context",
      });
      logSuperadminTrace("J. CALLBACK EXIT", {
        redirectTo: getControlledAuthErrorRedirect(
          frontendBase,
          "app_context_unavailable",
        ),
        outcome: "deny",
        lastCompletedStep,
      });
      await destroySessionAndClearCookie(req, res, oauthSessionGroup);
      res.redirect(
        getControlledAuthErrorRedirect(frontendBase, "app_context_unavailable"),
      );
      return;
    }

    const onboardingRequired =
      effectiveContext.requiredOnboarding === "organization";
    if (!effectiveContext.canAccess && !onboardingRequired) {
      logSuperadminTrace("H. ACCESS PROFILE DECISION", {
        appSlug: activeAppSlug,
        accessMode:
          app?.accessMode ?? null,
        normalizedAccessProfile: effectiveContext.normalizedAccessProfile,
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
      accessMode:
        app?.accessMode ?? null,
      normalizedAccessProfile: effectiveContext.normalizedAccessProfile,
      allow: true,
      denyReason: null,
    });
    infoVerboseTrace("[auth/google/callback] post-auth app requirements", {
      appSlug: activeAppSlug,
      appId: app.id,
      requiredOnboarding: effectiveContext.requiredOnboarding,
      canAccess: effectiveContext.canAccess,
    });
    const finalDestination = await resolveNextPathForEstablishedSession(
      req,
      user.id,
      activeAppSlug,
      oauthContinuation,
      "post_auth",
    );
    if (!finalDestination) {
      await destroySessionAndClearCookie(req, res, oauthSessionGroup);
      res.redirect(
        getControlledAuthErrorRedirect(
          frontendBase,
          AUTH_ERROR_CODES.APP_CONTEXT_UNAVAILABLE,
        ),
      );
      return;
    }
    infoVerboseTrace("[auth/google/callback] final redirect path", {
      appSlug: activeAppSlug,
      redirectPath: finalDestination,
    });
    logSuperadminTrace("J. CALLBACK EXIT", {
      redirectTo: `${frontendBase}${finalDestination}`,
      outcome: "allow",
      lastCompletedStep,
    });
    res.redirect(`${frontendBase}${finalDestination}`);
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

async function resolveRequestedEmailPasswordAppContext(req: Request) {
  const origin = getRequestFrontendOrigin(req) ?? null;
  const bodyAppSlug =
    typeof req.body?.appSlug === "string" && req.body.appSlug.trim()
      ? req.body.appSlug.trim()
      : null;
  return resolveAppContextForAuth({
    req,
    appSlug: bodyAppSlug,
    origin,
    sessionGroup:
      req.resolvedSessionGroup ??
      req.session?.sessionGroup ??
      resolveSessionGroupFromOrigin(origin),
  });
}

function getGenericAuthResponseMessage() {
  return "If an account exists, we sent further instructions.";
}

function buildMfaRequiredAuthResponse(mfaGate: {
  needsEnrollment: boolean;
  nextStep: "mfa_enroll" | "mfa_challenge";
  nextPath?: "/mfa/enroll" | "/mfa/challenge";
}) {
  return {
    success: true,
    mfaRequired: true,
    needsEnrollment: mfaGate.needsEnrollment,
    nextStep: mfaGate.nextStep,
    nextPath:
      mfaGate.nextPath ??
      (mfaGate.nextStep === "mfa_enroll" ? "/mfa/enroll" : "/mfa/challenge"),
  };
}

function sendAppContextResolutionError(
  res: Response,
  reason: string = AUTH_ERROR_CODES.APP_NOT_FOUND,
) {
  res.status(400).json({
    error: "Application context could not be resolved. Please reload and try again.",
    code: reason,
  });
}

function sendPostAuthDestinationUnresolved(res: Response) {
  res.status(409).json({
    error:
      "Authenticated state could not be resolved to a destination. Please sign in again.",
    code: "POST_AUTH_DESTINATION_UNRESOLVED",
  });
}

type SignupDecisionCategory =
  | "allow"
  | "step_up"
  | "block"
  | "validation_error"
  | "duplicate_email"
  | "turnstile_failed"
  | "provider_failure"
  | "internal_error";

type SignupDecisionReasonCode =
  | "disposable_email"
  | "undeliverable_email"
  | "ipqs_provider_failure_step_up"
  | "turnstile_missing_or_invalid"
  | "duplicate_existing_email"
  | "signup_not_allowed_by_access_policy"
  | "validation_failed"
  | "internal_exception"
  | "ipqs_advisory_step_up"
  | "signup_allowed";

type SignupDecisionLog = {
  category: SignupDecisionCategory;
  reasonCode: SignupDecisionReasonCode;
  email: string;
  appSlug: string;
  metadata?: Record<string, unknown>;
};

function getSignupEmailSearchMetadata(email: string): Record<string, unknown> {
  const normalized = normalizeEmailAddress(email);
  if (!normalized) {
    return {
      normalizedEmailHash: null,
      normalizedEmailMasked: null,
      normalizedEmailDomain: null,
    };
  }

  const atIndex = normalized.indexOf("@");
  const localPart = atIndex > 0 ? normalized.slice(0, atIndex) : normalized;
  const domain = atIndex > 0 ? normalized.slice(atIndex + 1) : null;
  const visibleLocalPrefix =
    localPart.length <= 2 ? localPart : `${localPart.slice(0, 2)}***`;
  const maskedEmail = domain
    ? `${visibleLocalPrefix}@${domain}`
    : `${visibleLocalPrefix}***`;

  return {
    normalizedEmailHash: hashOpaqueToken(`signup-email:${normalized}`),
    normalizedEmailMasked: maskedEmail,
    normalizedEmailDomain: domain,
  };
}

function getSignupSessionGroup(req: Request): string {
  const sessionGroup = req.resolvedSessionGroup;
  if (typeof sessionGroup === "string" && sessionGroup.trim()) {
    return sessionGroup;
  }
  return SESSION_GROUPS.DEFAULT;
}

async function logSignupDecision(
  req: Request,
  details: SignupDecisionLog,
): Promise<void> {
  await writeAuditLog({
    userId: req.session?.userId,
    action: "auth.signup.decision",
    resourceType: "auth",
    resourceId: "signup",
    metadata: {
      decisionCategory: details.category,
      reasonCode: details.reasonCode,
      appSlug: details.appSlug,
      sessionGroup: getSignupSessionGroup(req),
      correlationId: req.correlationId ?? null,
      ...getSignupEmailSearchMetadata(details.email),
      ...details.metadata,
    },
    req,
  });
}

async function createAuthToken(
  userId: string,
  tokenType: "email_verification" | "password_reset",
  ttlMinutes: number,
) {
  const token = generateOpaqueToken();
  const tokenHash = hashOpaqueToken(token);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  await db.insert(authTokensTable).values({
    id: randomUUID(),
    userId,
    tokenType,
    tokenHash,
    expiresAt,
  });
  return token;
}

type ConsumeAuthTokenResult =
  | { status: "consumed"; token: typeof authTokensTable.$inferSelect }
  | { status: "invalid" | "expired" | "already_used" };

async function consumeAuthToken(
  token: string,
  tokenType: "email_verification" | "password_reset",
): Promise<ConsumeAuthTokenResult> {
  const tokenHash = hashOpaqueToken(token);
  const now = new Date();
  const rows = await db
    .update(authTokensTable)
    .set({ consumedAt: now })
    .where(
      and(
        eq(authTokensTable.tokenHash, tokenHash),
        eq(authTokensTable.tokenType, tokenType),
        isNull(authTokensTable.consumedAt),
        sql`${authTokensTable.expiresAt} > ${now}`,
      ),
    )
    .returning();

  const consumed = rows[0] ?? null;
  if (consumed) {
    return { status: "consumed", token: consumed };
  }

  const existing = await db.query.authTokensTable.findFirst({
    where: and(
      eq(authTokensTable.tokenHash, tokenHash),
      eq(authTokensTable.tokenType, tokenType),
    ),
  });
  if (!existing) {
    return { status: "invalid" };
  }
  if (existing.consumedAt) {
    return { status: "already_used" };
  }
  if (existing.expiresAt <= now) {
    return { status: "expired" };
  }
  return { status: "invalid" };
}

async function establishPasswordSession(
  req: Request,
  userId: string,
  appSlug: string,
  stayLoggedIn: boolean,
) {
  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((err: unknown) => (err ? reject(err) : resolve()));
  });
  req.session.userId = userId;
  req.session.appSlug = appSlug;
  req.session.sessionAuthenticatedAt = Date.now();
  applySessionPersistence(req, stayLoggedIn);
  await new Promise<void>((resolve, reject) => {
    req.session.save((err: unknown) => (err ? reject(err) : resolve()));
  });
}

type MfaStartResult =
  | { required: false }
  | {
      required: true;
      needsEnrollment: boolean;
      nextStep: "mfa_enroll" | "mfa_challenge";
      nextPath: "/mfa/enroll" | "/mfa/challenge";
    };

async function beginMfaPendingSession(
  req: Request,
  userId: string,
  appSlug: string,
  stayLoggedIn: boolean,
): Promise<MfaStartResult> {
  ensureAuthFlowId(req);
  const sessionIdBeforeRegenerate = req.sessionID ?? null;
  const activeOrgId = req.session.activeOrgId ?? null;
  const mfaRequired = await isMfaRequiredForUser(userId, activeOrgId);
  let hasFactor = false;
  let factorStateReadFailed = false;
  try {
    hasFactor = await hasActiveMfaFactor(userId);
  } catch {
    factorStateReadFailed = true;
  }
  const trustedCookieToken =
    getCookieValue(req, getTrustedDeviceCookieName()) ?? undefined;
  const trusted = await isTrustedDevice(userId, trustedCookieToken);
  const security = await getUserAuthSecurity(userId);
  const needsStepUp = Boolean(
    security?.firstAuthAfterResetPending || security?.highRiskUntilMfaAt,
  );
  const needsEnrollment = mfaRequired && !factorStateReadFailed && !hasFactor;
  const mustChallenge = (mfaRequired || needsStepUp) && !trusted;

  if (!mustChallenge && !needsEnrollment) {
    logAuthDebug(req, "mfa_gate_result", {
      userId,
      appSlug,
      required: false,
      mfaRequired,
      needsStepUp,
      trustedDevice: trusted,
      hasFactor,
      factorStateReadFailed,
    });
    return { required: false };
  }

  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((err: unknown) => (err ? reject(err) : resolve()));
  });
  const sessionIdAfterRegenerate = req.sessionID ?? null;
  req.session.userId = userId;
  req.session.appSlug = appSlug;
  req.session.sessionAuthenticatedAt = Date.now();
  req.session.pendingUserId = userId;
  req.session.pendingAppSlug = appSlug;
  req.session.pendingMfaReason = needsEnrollment
    ? "enrollment_required"
    : "challenge_required";
  req.session.pendingStayLoggedIn = stayLoggedIn;
  await new Promise<void>((resolve, reject) => {
    req.session.save((err: unknown) => (err ? reject(err) : resolve()));
  });

  logAuthDebug(req, "mfa_pending_session_saved", {
    sessionIdBeforeRegenerate,
    sessionIdAfterRegenerate,
    sessionIdAfterSave: req.sessionID ?? null,
    userId: req.session.userId ?? null,
    pendingUserId: req.session.pendingUserId ?? null,
    pendingAppSlug: req.session.pendingAppSlug ?? null,
    pendingMfaReason: req.session.pendingMfaReason ?? null,
    pendingStayLoggedIn: req.session.pendingStayLoggedIn ?? null,
    sessionKeys: Object.keys(req.session ?? {})
      .sort()
      .join(","),
  });

  logAuthDebug(req, "mfa_gate_result", {
    userId,
    appSlug,
    required: true,
    mfaRequired,
    needsStepUp,
    trustedDevice: trusted,
    hasFactor,
    factorStateReadFailed,
    needsEnrollment,
    nextStep: needsEnrollment ? "mfa_enroll" : "mfa_challenge",
  });

  return {
    required: true,
    needsEnrollment,
    nextStep: needsEnrollment ? "mfa_enroll" : "mfa_challenge",
    nextPath: needsEnrollment ? "/mfa/enroll" : "/mfa/challenge",
  };
}

async function completePendingMfaSession(
  req: Request,
): Promise<{ userId: string; continuation: PostAuthContinuation | null } | null> {
  const pendingUserId = req.session.pendingUserId;
  const pendingAppSlug = req.session.pendingAppSlug;
  const pendingStayLoggedIn = req.session.pendingStayLoggedIn === true;
  const pendingContinuation = req.session.pendingPostAuthContinuation ?? null;
  if (!pendingUserId || !pendingAppSlug) return null;

  await establishPasswordSession(
    req,
    pendingUserId,
    pendingAppSlug,
    pendingStayLoggedIn,
  );
  delete req.session.pendingUserId;
  delete req.session.pendingAppSlug;
  delete req.session.pendingMfaReason;
  delete req.session.pendingStayLoggedIn;
  req.session.postAuthContinuation = pendingContinuation ?? undefined;
  delete req.session.pendingPostAuthContinuation;
  await clearFirstAuthAfterReset(pendingUserId);
  return { userId: pendingUserId, continuation: pendingContinuation };
}

async function resolveNextPathForEstablishedSession(
  req: Request,
  userId: string,
  appSlug: string,
  continuation?: PostAuthContinuation | null,
  stage: PostAuthResolutionStage = "post_auth",
): Promise<string | null> {
  try {
    const user = await db.query.usersTable.findFirst({
      where: eq(usersTable.id, userId),
    });
    const app = await getAppBySlug(appSlug);
    if (!user || !app) return null;
    const normalizedAccessProfile = resolveNormalizedAccessProfile(app);
    if (!normalizedAccessProfile) return null;

    const flow = await resolvePostAuthFlowDecision({
      userId,
      appSlug: app.slug,
      isSuperAdmin: Boolean(user.isSuperAdmin),
      normalizedAccessProfile,
    });
    const effectiveContinuation =
      continuation === undefined
        ? (req.session.postAuthContinuation ?? null)
        : continuation;
    const destination = resolveAuthenticatedPostAuthDestination({
      continuation: effectiveContinuation,
      flowDecision: flow,
      stage,
      currentAppSlug: app.slug,
    });
    if (!destination) {
      return null;
    }
    const shouldKeepContinuation =
      stage === "post_auth" && flow?.requiredOnboarding !== "none";
    if (effectiveContinuation && shouldKeepContinuation) {
      req.session.postAuthContinuation = effectiveContinuation;
    } else {
      delete req.session.postAuthContinuation;
    }
    logAuthDebug(req, "post_auth_redirect_decision", {
      userId,
      appSlug,
      destination,
      continuationType: effectiveContinuation?.type ?? null,
      continuationPath: effectiveContinuation?.returnPath ?? null,
      requiredOnboarding: flow?.requiredOnboarding ?? null,
    });
    return destination;
  } catch {
    return null;
  }
}

async function handlePasswordSignup(req: Request, res: Response) {
  const email = normalizeEmailAddress(String(req.body?.email ?? ""));
  const password = String(req.body?.password ?? "");
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : null;
  const providedAppSlug =
    typeof req.body?.appSlug === "string" && req.body.appSlug.trim()
      ? req.body.appSlug.trim().toLowerCase()
      : "unknown";

  if (!email || !password || !isStrongEnoughPassword(password)) {
    await logSignupDecision(req, {
      category: "validation_error",
      reasonCode: "validation_failed",
      email,
      appSlug: providedAppSlug,
      metadata: {
        passwordProvided: Boolean(password),
        emailProvided: Boolean(email),
      },
    });
    res.status(400).json({ error: "Invalid signup input." });
    return;
  }

  const signupAppContext = await resolveRequestedEmailPasswordAppContext(req);
  if (!signupAppContext.ok) {
    sendAppContextResolutionError(
      res,
      mapAuthContextFailureToAuthErrorCode(signupAppContext.reason),
    );
    return;
  }
  const signupAppSlug = signupAppContext.resolvedAppSlug;

  try {
    const signupApp = await getAppBySlug(signupAppSlug);
    if (
      !signupApp ||
      signupApp.accessMode === "superadmin" ||
      (signupApp.accessMode === "organization" &&
        !signupApp.customerRegistrationEnabled)
    ) {
      await logSignupDecision(req, {
        category: "block",
        reasonCode: "signup_not_allowed_by_access_policy",
        email,
        appSlug: signupAppSlug,
        metadata: {
          appFound: Boolean(signupApp),
          appAccessMode: signupApp?.accessMode ?? null,
          customerRegistrationEnabled:
            signupApp?.customerRegistrationEnabled ?? null,
        },
      });
      res
        .status(403)
        .json({
          error:
            "We couldn't create this account. Please use a different email and try again.",
        });
      return;
    }

    const ipqsAssessment = await assessSignupRiskWithIpqs(email, req.ip);
    if (ipqsAssessment.decision === "block") {
      await logSignupDecision(req, {
        category: "block",
        reasonCode: "disposable_email",
        email,
        appSlug: signupAppSlug,
        metadata: {
          ipqsDecision: ipqsAssessment.decision,
          ipqsReason: ipqsAssessment.reason,
          ipqsScore: ipqsAssessment.score,
          ipqsDisposable: ipqsAssessment.disposable,
          ipqsUndeliverable: ipqsAssessment.undeliverable,
          ipqsSuspiciousIp: ipqsAssessment.suspiciousIp,
          ipqsProviderFailed: ipqsAssessment.providerFailed,
        },
      });
      res
        .status(400)
        .json({
          error:
            "We couldn't create this account. Please use a different email and try again.",
        });
      return;
    }

    let user = await db.query.usersTable.findFirst({
      where: sql`lower(${usersTable.email}) = ${email}`,
    });
    if (!user) {
      const [created] = await db
        .insert(usersTable)
        .values({
          id: randomUUID(),
          email,
          name: name || null,
        })
        .returning();
      user = created ?? null;
    }

    if (!user) {
      await logSignupDecision(req, {
        category: "internal_error",
        reasonCode: "internal_exception",
        email,
        appSlug: signupAppSlug,
        metadata: {
          stage: "user_resolution",
        },
      });
      res.status(500).json({ error: "Unable to create account." });
      return;
    }

    const existingCredential = await db.query.userCredentialsTable.findFirst({
      where: and(
        eq(userCredentialsTable.userId, user.id),
        eq(userCredentialsTable.credentialType, "password"),
      ),
    });

    if (existingCredential) {
      await hashPassword(password);
      await logSignupDecision(req, {
        category: "duplicate_email",
        reasonCode: "duplicate_existing_email",
        email,
        appSlug: signupAppSlug,
        metadata: {
          userId: user.id,
        },
      });
      res
        .status(201)
        .json({
          success: true,
          appSlug: signupApp.slug,
          message: "If your signup is valid, check your email for next steps.",
        });
      return;
    }

    const passwordHash = await hashPassword(password);
    await db.insert(userCredentialsTable).values({
      id: randomUUID(),
      userId: user.id,
      credentialType: "password",
      passwordHash,
    });

    const verificationToken = await createAuthToken(
      user.id,
      "email_verification",
      60,
    );
    await sendLane1AuthVerificationEmail({
      req,
      appId: signupApp.id,
      appSlug: signupApp.slug,
      userId: user.id,
      userEmail: email,
      userFullName: user.name,
      verificationToken,
      expirationDateTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    if (
      signupApp.accessMode === "organization" &&
      signupApp.customerRegistrationEnabled
    ) {
      await db
        .insert(userAuthSecurityTable)
        .values({
          userId: user.id,
          mfaRequired: true,
          forceMfaEnrollment: true,
          riskReason: "org_client_registration",
        })
        .onConflictDoUpdate({
          target: userAuthSecurityTable.userId,
          set: {
            mfaRequired: true,
            forceMfaEnrollment: true,
            riskReason: "org_client_registration",
            updatedAt: new Date(),
          },
        });
    }

    if (ipqsAssessment.decision === "step_up") {
      await markUserHighRiskStepUp(
        user.id,
        ipqsAssessment.providerFailed ? "ipqs_failure_step_up" : "ipqs_step_up",
      );
      const stepUpReasonCode: SignupDecisionReasonCode =
        ipqsAssessment.providerFailed
          ? "ipqs_provider_failure_step_up"
          : ipqsAssessment.reason === "undeliverable_email"
            ? "undeliverable_email"
            : "ipqs_advisory_step_up";
      await logSignupDecision(req, {
        category: ipqsAssessment.providerFailed
          ? "provider_failure"
          : "step_up",
        reasonCode: stepUpReasonCode,
        email,
        appSlug: signupAppSlug,
        metadata: {
          userId: user.id,
          ipqsDecision: ipqsAssessment.decision,
          ipqsReason: ipqsAssessment.reason,
          ipqsScore: ipqsAssessment.score,
          ipqsDisposable: ipqsAssessment.disposable,
          ipqsUndeliverable: ipqsAssessment.undeliverable,
          ipqsSuspiciousIp: ipqsAssessment.suspiciousIp,
          ipqsProviderFailed: ipqsAssessment.providerFailed,
        },
      });
    } else {
      await logSignupDecision(req, {
        category: "allow",
        reasonCode: "signup_allowed",
        email,
        appSlug: signupAppSlug,
        metadata: {
          userId: user.id,
          ipqsDecision: ipqsAssessment.decision,
          ipqsReason: ipqsAssessment.reason,
          ipqsScore: ipqsAssessment.score,
        },
      });
    }

    res
      .status(201)
      .json({
        success: true,
        appSlug: signupApp.slug,
        message: "If your signup is valid, check your email for next steps.",
        verifyToken:
          process.env["NODE_ENV"] === "test" ? verificationToken : undefined,
      });
  } catch (error) {
    await logSignupDecision(req, {
      category: "internal_error",
      reasonCode: "internal_exception",
      email,
      appSlug: signupAppSlug,
      metadata: {
        errorName: error instanceof Error ? error.name : typeof error,
      },
    });
    throw error;
  }
}

async function handlePasswordLogin(req: Request, res: Response) {
  ensureAuthFlowId(req);
  attachAuthResponseDiagnostics(req, res, "/api/auth/login");
  const email = normalizeEmailAddress(String(req.body?.email ?? ""));
  const password = String(req.body?.password ?? "");
  if (!email || !password) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  const user = await db.query.usersTable.findFirst({
    where: sql`lower(${usersTable.email}) = ${email}`,
  });
  const credential = user
    ? await db.query.userCredentialsTable.findFirst({
        where: and(
          eq(userCredentialsTable.userId, user.id),
          eq(userCredentialsTable.credentialType, "password"),
        ),
      })
    : null;

  const verification =
    user && credential
      ? await verifyPassword(credential.passwordHash, password)
      : { ok: false, needsRehash: false };
  if (!verification.ok || !user || !credential) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  if (verification.needsRehash && verification.upgradedHash) {
    await db
      .update(userCredentialsTable)
      .set({ passwordHash: verification.upgradedHash, updatedAt: new Date() })
      .where(eq(userCredentialsTable.id, credential.id));
  }

  if (!user.active || user.suspended || user.deletedAt) {
    res.status(403).json({ error: "Account is unavailable." });
    return;
  }
  if (!user.emailVerifiedAt) {
    res.status(403).json({ error: "Email verification required." });
    return;
  }

  const appContext = await resolveRequestedEmailPasswordAppContext(req);
  if (!appContext.ok) {
    sendAppContextResolutionError(
      res,
      mapAuthContextFailureToAuthErrorCode(appContext.reason),
    );
    return;
  }
  const appSlug = appContext.resolvedAppSlug;
  const stayLoggedIn = req.body?.stayLoggedIn === true;
  const continuation = resolvePostAuthContinuation({
    appSlug,
    returnPath: normalizeReturnToPath(firstQueryParam(req.body?.returnToPath)),
    continuationType: firstQueryParam(req.body?.continuationType),
    orgId: firstQueryParam(req.body?.continuationOrgId),
    resourceId: firstQueryParam(req.body?.continuationResourceId),
  });
  logAuthDebug(req, "password_login_request", {
    requestSessionId: req.sessionID ?? null,
    sessionGroup: req.resolvedSessionGroup ?? req.session?.sessionGroup ?? null,
    sessionKeys: Object.keys(req.session ?? {})
      .sort()
      .join(","),
    authUserId: user.id,
    appSlug,
    stayLoggedIn,
    returnToPath: continuation?.returnPath ?? null,
    continuationType: continuation?.type ?? null,
  });
  const mfaGate = await beginMfaPendingSession(
    req,
    user.id,
    appSlug,
    stayLoggedIn,
  );
  if (mfaGate.required) {
    req.session.pendingPostAuthContinuation = continuation ?? undefined;
    await new Promise<void>((resolve, reject) => {
      req.session.save((err: unknown) => (err ? reject(err) : resolve()));
    });
    logAuthDebug(req, "login_result", {
      userId: user.id,
      appSlug,
      mfaRequired: true,
      needsEnrollment: mfaGate.needsEnrollment,
      nextStep: mfaGate.nextStep,
      returnToPath: continuation?.returnPath ?? null,
      continuationType: continuation?.type ?? null,
      factorState: mfaGate.needsEnrollment
        ? "enrollment_required"
        : "challenge_required",
    });
    res.status(202).json({
      ...buildMfaRequiredAuthResponse(mfaGate),
    });
    return;
  }

  await establishPasswordSession(req, user.id, appSlug, stayLoggedIn);
  await db
    .update(usersTable)
    .set({ lastLoginAt: new Date() })
    .where(eq(usersTable.id, user.id));
  const nextPath = await resolveNextPathForEstablishedSession(
    req,
    user.id,
    appSlug,
    continuation,
  );
  if (!nextPath) {
    sendPostAuthDestinationUnresolved(res);
    return;
  }
  logAuthDebug(req, "login_result", {
    userId: user.id,
    appSlug,
    mfaRequired: false,
    nextPath,
  });
  res.json({
    success: true,
    mfaRequired: false,
    needsEnrollment: false,
    nextStep: null,
    nextPath,
  });
}

async function handleForgotPassword(req: Request, res: Response) {
  const appContext = await resolveRequestedEmailPasswordAppContext(req);
  if (!appContext.ok) {
    sendAppContextResolutionError(
      res,
      mapAuthContextFailureToAuthErrorCode(appContext.reason),
    );
    return;
  }
  const appSlug = appContext.resolvedAppSlug;
  const email = normalizeEmailAddress(String(req.body?.email ?? ""));
  let token: string | undefined;
  if (email) {
    const user = await db.query.usersTable.findFirst({
      where: sql`lower(${usersTable.email}) = ${email}`,
    });
    if (user) {
      token = await createAuthToken(user.id, "password_reset", 30);
      const app = await getAppBySlug(appSlug);
      if (app) {
        await sendLane1PasswordResetEmail({
          req,
          appId: app.id,
          appSlug: app.slug,
          userId: user.id,
          userEmail: user.email,
          userFullName: user.name,
          resetToken: token,
          expirationDateTime: new Date(
            Date.now() + 30 * 60 * 1000,
          ).toISOString(),
        });
      }
    }
  }

  res.json({
    success: true,
    message: getGenericAuthResponseMessage(),
    resetToken: process.env["NODE_ENV"] === "test" ? token : undefined,
  });
}

async function handleResetPassword(req: Request, res: Response) {
  const token = String(req.body?.token ?? "").trim();
  const password = String(req.body?.password ?? "");
  if (!token || !isStrongEnoughPassword(password)) {
    res.status(400).json({ error: "Invalid reset request." });
    return;
  }

  const consumed = await consumeAuthToken(token, "password_reset");
  if (consumed.status !== "consumed") {
    res.status(400).json({ error: "Reset token is invalid or expired." });
    return;
  }

  const hash = await hashPassword(password);
  const existingCredential = await db.query.userCredentialsTable.findFirst({
    where: and(
      eq(userCredentialsTable.userId, consumed.token.userId),
      eq(userCredentialsTable.credentialType, "password"),
    ),
  });
  if (existingCredential) {
    await db
      .update(userCredentialsTable)
      .set({ passwordHash: hash, updatedAt: new Date() })
      .where(eq(userCredentialsTable.id, existingCredential.id));
  } else {
    await db
      .insert(userCredentialsTable)
      .values({
        id: randomUUID(),
        userId: consumed.token.userId,
        credentialType: "password",
        passwordHash: hash,
      });
  }

  await markPasswordResetSecurityEvent(consumed.token.userId);
  await pool.query(getDeleteAllOtherSessionsForUserSql(), [
    consumed.token.userId,
    req.session.id ?? "",
  ]);
  await destroySessionAndClearCookie(
    req,
    res,
    req.session.sessionGroup ?? SESSION_GROUPS.DEFAULT,
  );
  res.clearCookie(
    getTrustedDeviceCookieName(),
    getTrustedDeviceCookieOptions(),
  );
  res.json({ success: true });
}

async function handleVerifyEmail(req: Request, res: Response) {
  ensureAuthFlowId(req);
  const token = String(req.body?.token ?? "").trim();
  const appSlug = String(req.body?.appSlug ?? "").trim();
  const continuation = resolvePostAuthContinuation({
    appSlug,
    returnPath: normalizeReturnToPath(firstQueryParam(req.body?.returnToPath)),
    continuationType: firstQueryParam(req.body?.continuationType),
    orgId: firstQueryParam(req.body?.continuationOrgId),
    resourceId: firstQueryParam(req.body?.continuationResourceId),
  });
  const correlationId = req.correlationId;
  const logVerifyEmailOutcome = async (
    outcome: string,
    metadata?: Record<string, unknown>,
  ) => {
    await writeAuditLog({
      action: "auth.verify_email",
      resourceType: "auth_verification",
      req,
      metadata: {
        outcome,
        appSlug: appSlug || null,
        correlationId: correlationId ?? null,
        ...metadata,
      },
    });
  };
  if (!token) {
    await logVerifyEmailOutcome("invalid_request", {
      reasonCode: "missing_token",
    });
    res.status(400).json({ error: "Invalid verification token." });
    return;
  }

  const consumed = await consumeAuthToken(token, "email_verification");
  if (consumed.status !== "consumed") {
    if (consumed.status === "expired") {
      await logVerifyEmailOutcome("token_rejected", { reasonCode: "expired" });
      res
        .status(400)
        .json({
          error: "Verification token has expired.",
          code: "VERIFICATION_TOKEN_EXPIRED",
        });
      return;
    }
    if (consumed.status === "already_used") {
      await logVerifyEmailOutcome("token_rejected", {
        reasonCode: "already_used",
      });
      res
        .status(409)
        .json({
          error: "Verification token was already used.",
          code: "VERIFICATION_TOKEN_ALREADY_USED",
        });
      return;
    }
    await logVerifyEmailOutcome("token_rejected", { reasonCode: "invalid" });
    res
      .status(400)
      .json({
        error: "Verification token is invalid.",
        code: "VERIFICATION_TOKEN_INVALID",
      });
    return;
  }

  await db
    .update(usersTable)
    .set({ emailVerifiedAt: new Date() })
    .where(eq(usersTable.id, consumed.token.userId));
  if (!appSlug) {
    await logVerifyEmailOutcome("verified_no_app_slug", {
      userId: consumed.token.userId,
    });
    res.json({ success: true });
    return;
  }

  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, consumed.token.userId),
  });
  if (!user || !user.active || user.suspended || user.deletedAt) {
    await logVerifyEmailOutcome("account_unavailable", {
      userId: consumed.token.userId,
    });
    res.status(403).json({ error: "Account is unavailable." });
    return;
  }

  const mfaGate = await beginMfaPendingSession(req, user.id, appSlug, false);
  if (mfaGate.required) {
    req.session.pendingPostAuthContinuation = continuation ?? undefined;
    await new Promise<void>((resolve, reject) => {
      req.session.save((err: unknown) => (err ? reject(err) : resolve()));
    });
    logAuthDebug(req, "verify_email_result", {
      userId: user.id,
      appSlug,
      mfaRequired: true,
      needsEnrollment: mfaGate.needsEnrollment,
      nextStep: mfaGate.nextStep,
      continuationType: continuation?.type ?? null,
      returnToPath: continuation?.returnPath ?? null,
    });
    await logVerifyEmailOutcome("verified_mfa_required", {
      userId: user.id,
      needsEnrollment: mfaGate.needsEnrollment,
    });
    res.status(202).json({
      ...buildMfaRequiredAuthResponse(mfaGate),
    });
    return;
  }

  await establishPasswordSession(req, user.id, appSlug, false);
  await db
    .update(usersTable)
    .set({ lastLoginAt: new Date() })
    .where(eq(usersTable.id, user.id));
  const nextPath = await resolveNextPathForEstablishedSession(
    req,
    user.id,
    appSlug,
    continuation,
  );
  if (!nextPath) {
    sendPostAuthDestinationUnresolved(res);
    return;
  }
  logAuthDebug(req, "verify_email_result", {
    userId: user.id,
    appSlug,
    mfaRequired: false,
    nextPath,
    continuationType: continuation?.type ?? null,
    returnToPath: continuation?.returnPath ?? null,
  });
  await logVerifyEmailOutcome("verified_session_established", {
    userId: user.id,
    nextPath,
  });
  res.json({
    success: true,
    mfaRequired: false,
    needsEnrollment: false,
    nextStep: null,
    nextPath,
  });
}

async function handleMfaEnrollStart(req: Request, res: Response) {
  ensureAuthFlowId(req);
  const userId = req.session.userId ?? req.session.pendingUserId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  let alreadyEnrolled = false;
  try {
    alreadyEnrolled = await hasActiveMfaFactor(userId);
  } catch {
    res
      .status(503)
      .json({
        error:
          "Unable to verify two-step verification status. Please try again.",
      });
    return;
  }
  if (alreadyEnrolled) {
    const shouldChallenge =
      req.session.pendingMfaReason === "challenge_required" ||
      Boolean(req.session.pendingUserId);
    logAuthDebug(req, "mfa_enroll_start_decision", {
      userId,
      alreadyEnrolled: true,
      shouldChallenge,
      nextStep: shouldChallenge ? "mfa_challenge" : null,
    });
    res.status(409).json({
      error:
        "Two-step verification is already active for this account. Use your authenticator code to continue.",
      ...(shouldChallenge
        ? {
            mfaRequired: true,
            needsEnrollment: false,
            nextStep: "mfa_challenge" as const,
          }
        : {}),
    });
    return;
  }
  const factor = await beginTotpEnrollment(userId);
  if (!factor) {
    delete req.session.pendingUserId;
    delete req.session.pendingAppSlug;
    delete req.session.pendingMfaReason;
    delete req.session.pendingStayLoggedIn;
    delete req.session.pendingPostAuthContinuation;
    delete req.session.postAuthContinuation;
    res
      .status(401)
      .json({
        error:
          "Two-step verification session is no longer valid. Please sign in again.",
      });
    return;
  }

  const sessionGroup = req.session.sessionGroup ?? req.resolvedSessionGroup ?? SESSION_GROUPS.DEFAULT;
  const fallbackIssuer = await getMfaIssuerForSessionGroup(sessionGroup);
  const appSlugForIssuer =
    (typeof req.session.appSlug === "string" && req.session.appSlug) ||
    (typeof req.session.pendingAppSlug === "string" && req.session.pendingAppSlug) ||
    (typeof req.body?.appSlug === "string" && req.body.appSlug.trim()) ||
    null;
  const issuer = await getMfaIssuerForAppSlug(appSlugForIssuer, fallbackIssuer);
  logAuthDebug(req, "mfa_enroll_start_decision", {
    userId,
    alreadyEnrolled: false,
    factorIssued: Boolean(factor),
    issuer,
    nextStep: "mfa_enroll",
  });
  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, userId),
  });
  const otpauthUrl = buildTotpOtpauthUrl({
    issuer,
    accountName: user?.email ?? userId,
    secret: factor.secret,
  });
  res.json({
    factorId: factor.factorId,
    secret: factor.secret,
    otpauthUrl,
    issuer,
  });
}

async function handleMfaEnrollVerify(req: Request, res: Response) {
  ensureAuthFlowId(req);
  const userId = req.session.userId ?? req.session.pendingUserId;
  const factorId = String(req.body?.factorId ?? "").trim();
  const code = String(req.body?.code ?? "").trim();
  const rememberDevice = req.body?.rememberDevice === true;
  if (!userId || !factorId || !code) {
    res
      .status(400)
      .json({ error: "Invalid two-step verification setup request." });
    return;
  }
  const activated = await activateTotpEnrollment(userId, factorId, code);
  if (!activated) {
    logAuthDebug(req, "mfa_enroll_verify_result", {
      userId,
      verified: false,
      factorIdPresent: Boolean(factorId),
    });
    res.status(400).json({ error: "Invalid two-step verification code." });
    return;
  }

  if (!Array.isArray(activated.recoveryCodes) || activated.recoveryCodes.length === 0) {
    logAuthDebug(req, "mfa_enroll_verify_result", {
      userId,
      verified: false,
      factorIdPresent: Boolean(factorId),
      error: "recovery_codes_missing",
    });
    res.status(500).json({
      error:
        "Two-step verification setup could not be completed safely. Please retry setup.",
    });
    return;
  }

  const completed = await completePendingMfaSession(req);
  if (completed && rememberDevice) {
    const token = await rememberTrustedDevice(userId);
    res.cookie(
      getTrustedDeviceCookieName(),
      token,
      getTrustedDeviceCookieOptions(),
    );
  }

  let nextPath: string | undefined;
  if (completed) {
    const appSlug = req.session.appSlug;
    if (appSlug) {
      const resolvedNextPath = await resolveNextPathForEstablishedSession(
        req,
        completed.userId,
        appSlug,
        completed.continuation,
      );
      if (!resolvedNextPath) {
        sendPostAuthDestinationUnresolved(res);
        return;
      }
      nextPath = resolvedNextPath;
    }
  }
  logAuthDebug(req, "mfa_enroll_verify_result", {
    userId,
    verified: true,
    sessionEstablished: Boolean(completed),
    recoveryCodesIssued: activated.recoveryCodes.length,
    nextPath: nextPath ?? null,
  });

  res.json({
    success: true,
    recoveryCodes: activated.recoveryCodes,
    sessionEstablished: Boolean(completed),
    nextPath,
  });
}

async function handleMfaChallenge(req: Request, res: Response) {
  ensureAuthFlowId(req);
  const userId = req.session.pendingUserId;
  const code = String(req.body?.code ?? "").trim();
  const rememberDevice = req.body?.rememberDevice === true;
  const stayLoggedIn = req.body?.stayLoggedIn === true;
  if (!userId || !code) {
    res
      .status(400)
      .json({ error: "Invalid two-step verification challenge request." });
    return;
  }

  const ok = await verifyMfaChallenge(userId, code);
  if (!ok) {
    logAuthDebug(req, "mfa_challenge_result", {
      userId,
      verified: false,
      rememberDevice,
      stayLoggedIn,
    });
    res.status(401).json({ error: "Invalid two-step verification code." });
    return;
  }

  req.session.pendingStayLoggedIn = stayLoggedIn;
  const completed = await completePendingMfaSession(req);
  if (!completed) {
    res
      .status(400)
      .json({ error: "Two-step verification session is not active." });
    return;
  }

  if (rememberDevice) {
    const token = await rememberTrustedDevice(userId);
    res.cookie(
      getTrustedDeviceCookieName(),
      token,
      getTrustedDeviceCookieOptions(),
    );
  }
  const appSlug = req.session.appSlug;
  const nextPath = appSlug
    ? ((await resolveNextPathForEstablishedSession(
        req,
        userId,
        appSlug,
        completed.continuation,
      )) ??
      undefined)
    : undefined;
  if (appSlug && !nextPath) {
    sendPostAuthDestinationUnresolved(res);
    return;
  }
  logAuthDebug(req, "mfa_challenge_result", {
    userId,
    verified: true,
    rememberDevice,
    stayLoggedIn,
    sessionEstablished: true,
    nextPath: nextPath ?? null,
  });

  res.json({ success: true, nextPath });
}

async function handleMfaRecovery(req: Request, res: Response) {
  ensureAuthFlowId(req);
  const userId = req.session.pendingUserId;
  const recoveryCode = String(req.body?.recoveryCode ?? "").trim();
  const rememberDevice = req.body?.rememberDevice === true;
  const stayLoggedIn = req.body?.stayLoggedIn === true;
  if (!userId || !recoveryCode) {
    res.status(400).json({ error: "Invalid two-step recovery request." });
    return;
  }
  const ok = await verifyMfaChallenge(userId, recoveryCode);
  if (!ok) {
    logAuthDebug(req, "mfa_recovery_result", {
      userId,
      verified: false,
      rememberDevice,
      stayLoggedIn,
    });
    res.status(401).json({ error: "Invalid recovery code." });
    return;
  }
  req.session.pendingStayLoggedIn = stayLoggedIn;
  const completed = await completePendingMfaSession(req);
  if (!completed) {
    res
      .status(400)
      .json({ error: "Two-step verification session is not active." });
    return;
  }
  if (rememberDevice) {
    const token = await rememberTrustedDevice(userId);
    res.cookie(
      getTrustedDeviceCookieName(),
      token,
      getTrustedDeviceCookieOptions(),
    );
  }
  const appSlug = req.session.appSlug;
  const nextPath = appSlug
    ? ((await resolveNextPathForEstablishedSession(
        req,
        userId,
        appSlug,
        completed.continuation,
      )) ??
      undefined)
    : undefined;
  if (appSlug && !nextPath) {
    sendPostAuthDestinationUnresolved(res);
    return;
  }
  logAuthDebug(req, "mfa_recovery_result", {
    userId,
    verified: true,
    rememberDevice,
    stayLoggedIn,
    sessionEstablished: true,
    nextPath: nextPath ?? null,
  });
  res.json({ success: true, nextPath });
}

async function handlePostOnboardingNextPath(req: Request, res: Response) {
  ensureAuthFlowId(req);
  const authenticatedUser = (
    req as Request & { user?: typeof usersTable.$inferSelect }
  ).user;
  const userId = authenticatedUser?.id ?? req.session.userId ?? null;
  const appSlug = req.session.appSlug ?? null;
  if (!userId || !appSlug) {
    res.status(400).json({ error: "No active authenticated app session." });
    return;
  }

  const nextPath =
    await resolveNextPathForEstablishedSession(
      req,
      userId,
      appSlug,
      req.session.postAuthContinuation ?? null,
      "post_onboarding",
    );
  if (!nextPath) {
    sendPostAuthDestinationUnresolved(res);
    return;
  }
  delete req.session.postAuthContinuation;
  await new Promise<void>((resolve, reject) => {
    req.session.save((err: unknown) => (err ? reject(err) : resolve()));
  });

  res.json({ success: true, nextPath });
}

async function handleMfaDisable(req: Request, res: Response) {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await db
    .update(userAuthSecurityTable)
    .set({ forceMfaEnrollment: true, mfaRequired: true, updatedAt: new Date() })
    .where(eq(userAuthSecurityTable.userId, userId));
  await revokeTrustedDevicesForUser(userId, "mfa_reset");
  res.clearCookie(
    getTrustedDeviceCookieName(),
    getTrustedDeviceCookieOptions(),
  );
  res.json({ success: true });
}

router.get("/me", requireAuth, handleMe);
router.post("/logout", handleLogout);
router.post(
  "/google/url",
  authRateLimiter({ keyPrefix: "auth-google-url" }),
  handleGoogleUrl,
);
router.post(
  "/signup",
  authRateLimiterWithIdentifier({
    keyPrefix: "auth-signup",
    opaqueIdentifier: (req) =>
      getPasswordAuthOpaqueIdentifier(String(req.body?.email ?? "")),
  }),
  handlePasswordSignup,
);
router.post(
  "/login",
  authRateLimiterWithIdentifier({
    keyPrefix: "auth-login",
    opaqueIdentifier: (req) =>
      getPasswordAuthOpaqueIdentifier(String(req.body?.email ?? "")),
  }),
  handlePasswordLogin,
);
router.post(
  "/forgot-password",
  authRateLimiterWithIdentifier({
    keyPrefix: "auth-forgot-password",
    opaqueIdentifier: (req) =>
      getPasswordAuthOpaqueIdentifier(String(req.body?.email ?? "")),
  }),
  handleForgotPassword,
);
router.post(
  "/reset-password",
  authRateLimiter({ keyPrefix: "auth-reset-password" }),
  handleResetPassword,
);
router.post(
  "/verify-email",
  authRateLimiter({ keyPrefix: "auth-verify-email" }),
  handleVerifyEmail,
);
router.post(
  "/mfa/enroll/start",
  authRateLimiter({ keyPrefix: "auth-mfa-enroll-start" }),
  handleMfaEnrollStart,
);
router.post(
  "/mfa/enroll/verify",
  authRateLimiter({ keyPrefix: "auth-mfa-enroll-verify" }),
  handleMfaEnrollVerify,
);
router.post(
  "/mfa/challenge",
  authRateLimiter({ keyPrefix: "auth-mfa-challenge" }),
  handleMfaChallenge,
);
router.post(
  "/mfa/recovery",
  authRateLimiter({ keyPrefix: "auth-mfa-recovery" }),
  handleMfaRecovery,
);
router.post(
  "/post-onboarding/next-path",
  requireAuth,
  authRateLimiter({ keyPrefix: "auth-post-onboarding-next-path" }),
  handlePostOnboardingNextPath,
);
router.post(
  "/mfa/disable",
  requireAuth,
  authRateLimiter({ keyPrefix: "auth-mfa-disable" }),
  handleMfaDisable,
);
router.get("/google/callback", handleGoogleCallback);

export default router;
