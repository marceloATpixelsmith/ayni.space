import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db, usersTable, orgMembershipsTable, organizationsTable } from "@workspace/db";
import { buildGoogleAuthUrl, exchangeCodeForUser } from "../lib/auth.js";
import { destroySessionAndClearCookie } from "../lib/session.js";
import { getAllowedOrigins, isRestrictedSessionGroup, resolveSessionGroupForRequest, resolveSessionGroupFromOrigin, SESSION_GROUPS } from "../lib/sessionGroup.js";
import { writeAuditLog } from "../lib/audit.js";
import { getAbuseClientKey, recordAbuseSignal } from "../lib/authAbuse.js";
import { getPostAuthRedirectPath } from "../lib/postAuthRedirect.js";
import { isTurnstileEnabled, verifyTurnstileTokenDetailed, logTurnstileVerificationResult } from "../middlewares/turnstile.js";

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

function firstQueryParam(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
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
    ...metadata,
  });
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
  if (isTurnstileEnabled() && !req.turnstileVerified) {
    const turnstileToken = getTurnstileToken(req);
    if (!turnstileToken) {
      logGoogleUrlBranch(req, "turnstile_missing_token");
      logAuthFailure(req, "google-url-turnstile-missing");
      res.status(403).json({
        error: "Please complete the verification challenge.",
        code: "TURNSTILE_MISSING_TOKEN",
      });
      return;
    }

    const turnstileResult = await verifyTurnstileTokenDetailed(turnstileToken, req.ip);
    if (!turnstileResult.ok) {
      logGoogleUrlBranch(req, "turnstile_verification_failed", { reason: turnstileResult.reason });
      logAuthFailure(req, "google-url-turnstile-invalid");
      logTurnstileVerificationResult(req, turnstileResult);
      if (turnstileResult.reason === "missing-token") {
        res.status(403).json({
          error: "Please complete the verification challenge.",
          code: "TURNSTILE_MISSING_TOKEN",
        });
        return;
      }
      if (turnstileResult.reason === "missing-secret") {
        res.status(500).json({
          error: "Turnstile verification is misconfigured. Please contact support.",
          code: "TURNSTILE_MISCONFIGURED",
        });
        return;
      }
      if (turnstileResult.reason === "verification-error") {
        res.status(503).json({
          error: "Verification service is temporarily unavailable. Please try again.",
          code: "TURNSTILE_UNAVAILABLE",
        });
        return;
      }
      if (turnstileResult.reason === "token-expired") {
        res.status(403).json({
          error: "Verification expired. Please complete the challenge again.",
          code: "TURNSTILE_TOKEN_EXPIRED",
        });
        return;
      }
      res.status(403).json({
        error: "Security verification failed. Please try again.",
        code: "TURNSTILE_INVALID_TOKEN",
      });
      return;
    }
  }

  const returnTo = getRequestFrontendOrigin(req);
  if (!returnTo) {
    logGoogleUrlBranch(req, "origin_invalid");
    logAuthFailure(req, "google-url-origin-invalid");
    res.status(400).json({
      error: "Request origin is missing or not allowed.",
      code: "ORIGIN_NOT_ALLOWED",
    });
    return;
  }

  const oauthSessionGroup = resolveSessionGroupFromOrigin(returnTo);
  const state = `${oauthSessionGroup}.${randomUUID()}`;
  req.session.oauthState = state;
  req.session.oauthReturnTo = returnTo;
  req.session.oauthSessionGroup = oauthSessionGroup;

  let url = "";
  try {
    url = buildGoogleAuthUrl(state);
  } catch {
    logGoogleUrlBranch(req, "oauth_config_missing");
    res.status(500).json({
      error: "Google OAuth is not configured. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.",
      code: "OAUTH_CONFIG_MISSING",
    });
    return;
  }

  if (!url || typeof url !== "string") {
    logGoogleUrlBranch(req, "oauth_url_generation_failed");
    res.status(500).json({ error: "Google OAuth URL generation failed.", code: "OAUTH_URL_INVALID" });
    return;
  }

  req.session.save((err: unknown) => {
    if (err) {
      logGoogleUrlBranch(req, "session_init_failed");
      logAuthFailure(req, "google-url-session-init-failed");
      res.status(500).json({ error: "Failed to initialize OAuth session.", code: "OAUTH_SESSION_INIT_FAILED" });
      return;
    }
    logGoogleUrlBranch(req, "success", { sessionGroup: oauthSessionGroup });
    res.json({ url });
  });
}

async function handleGoogleCallback(req: Request, res: Response) {
  const code = firstQueryParam(req.query.code);
  const state = firstQueryParam(req.query.state);

  if (!code) {
    logAuthFailure(req, "google-callback-missing-code");
    res.status(400).json({ error: "Missing authorization code" });
    return;
  }

  if (!state || !req.session.oauthState || state !== req.session.oauthState) {
    logAuthFailure(req, "google-callback-invalid-state");
    res.status(400).json({ error: "Invalid OAuth state. Please try signing in again." });
    return;
  }

  delete req.session.oauthState;
  const oauthReturnTo = req.session.oauthReturnTo;
  const stateSessionGroup = parseGroupFromOAuthState(state);
  const oauthSessionGroup = req.session.oauthSessionGroup ?? stateSessionGroup ?? SESSION_GROUPS.DEFAULT;
  delete req.session.oauthReturnTo;
  delete req.session.oauthSessionGroup;

  try {
    const googleUser = await authRouteDeps.exchangeCodeForUserFn(code);

    await new Promise((resolve, reject) => {
      req.session.regenerate((err: unknown) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(undefined);
      });
    });

    let user = await db.query.usersTable.findFirst({ where: eq(usersTable.googleSubject, googleUser.sub) });

    if (!user) {
      const existingByEmail = await db.query.usersTable.findFirst({ where: eq(usersTable.email, googleUser.email) });

      if (existingByEmail) {
        const [updated] = await db
          .update(usersTable)
          .set({
            googleSubject: googleUser.sub,
            avatarUrl: googleUser.picture ?? existingByEmail.avatarUrl,
            name: existingByEmail.name ?? googleUser.name ?? null,
          })
          .where(eq(usersTable.id, existingByEmail.id))
          .returning();
        user = updated;
      } else {
        const [created] = await db
          .insert(usersTable)
          .values({
            id: randomUUID(),
            email: googleUser.email,
            name: googleUser.name ?? null,
            avatarUrl: googleUser.picture ?? null,
            googleSubject: googleUser.sub,
            isSuperAdmin: false,
          })
          .returning();
        user = created;

        writeAuditLog({
          userId: user.id,
          userEmail: user.email,
          action: "user.created",
          resourceType: "user",
          resourceId: user.id,
          req,
        });
      }
    } else {
      await db
        .update(usersTable)
        .set({
          avatarUrl: googleUser.picture ?? user.avatarUrl,
          name: user.name ?? googleUser.name ?? null,
        })
        .where(eq(usersTable.id, user.id));
    }

    if (!user) {
      res.status(500).json({ error: "Failed to resolve authenticated user" });
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

    if (!oauthReturnTo) {
      logAuthFailure(req, "google-callback-missing-return-origin");
      res.status(400).json({ error: "Unable to determine return app for OAuth callback" });
      return;
    }

    const frontendBase = oauthReturnTo;

    if (isRestrictedSessionGroup(oauthSessionGroup) && !user.isSuperAdmin) {
      await destroySessionAndClearCookie(req, res, oauthSessionGroup);
      res.redirect(`${frontendBase}/login?error=access_denied`);
      return;
    }

    const destination = getPostAuthRedirectPath(user.isSuperAdmin);
    res.redirect(`${frontendBase}${destination}`);
  } catch (error) {
    console.error("Google callback failed:", error);
    logAuthFailure(req, "google-callback-exception");
    res.status(500).json({ error: "Google authentication failed" });
  }
}

router.get("/me", handleMe);
router.post("/logout", handleLogout);
router.post("/google/url", handleGoogleUrl);
router.get("/google/callback", handleGoogleCallback);

export default router;
