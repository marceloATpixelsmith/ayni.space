import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { destroySessionAndClearCookie } from "../lib/session.js";
import { SESSION_GROUPS } from "../lib/sessionGroup.js";
import { logAuthDebug } from "../lib/authDebug.js";

function logFirstAuthRequest(payload: {
  req: Request;
  path: string;
  method: string;
  cookieHeaderPresent: boolean;
  sessionExists: boolean;
  sessionId: string | null;
  sessionGroup: string | null;
  userId: string | null;
  isSuperAdmin: boolean;
  allow: boolean;
  denyReason: string | null;
  sessionKeys: string;
}) {
  logAuthDebug(payload.req, "require_auth_decision", {
    path: payload.path,
    method: payload.method,
    cookieHeaderPresent: payload.cookieHeaderPresent,
    sessionExists: payload.sessionExists,
    sessionIdPresent: Boolean(payload.sessionId),
    sessionGroup: payload.sessionGroup,
    userId: payload.userId,
    isSuperAdmin: payload.isSuperAdmin,
    allow: payload.allow,
    denyReason: payload.denyReason,
    sessionKeys: payload.sessionKeys,
  });
  console.log(
    `[AUTH-CHECK-TRACE] FIRST AUTH REQUEST ` +
    `path=${payload.path} method=${payload.method} ` +
    `cookieHeaderPresent=${payload.cookieHeaderPresent} ` +
    `sessionExists=${payload.sessionExists} ` +
    `sessionId=${payload.sessionId} ` +
    `sessionGroup=${payload.sessionGroup} ` +
    `userId=${payload.userId} ` +
    `isSuperAdmin=${payload.isSuperAdmin} ` +
    `allow=${payload.allow} ` +
    `denyReason=${payload.denyReason} ` +
    `sessionKeys=${payload.sessionKeys}`
  );
}

function logAdminGuard(payload: {
  req: Request;
  path: string;
  sessionExists: boolean;
  sessionGroup: string | null;
  userId: string | null;
  isSuperAdmin: boolean;
  allow: boolean;
  denyReason: string | null;
}) {
  logAuthDebug(payload.req, "require_super_admin_decision", {
    path: payload.path,
    sessionExists: payload.sessionExists,
    sessionGroup: payload.sessionGroup,
    userId: payload.userId,
    isSuperAdmin: payload.isSuperAdmin,
    allow: payload.allow,
    denyReason: payload.denyReason,
  });
  console.log(
    `[AUTH-CHECK-TRACE] ADMIN GUARD ` +
    `path=${payload.path} ` +
    `sessionExists=${payload.sessionExists} ` +
    `sessionGroup=${payload.sessionGroup} ` +
    `userId=${payload.userId} ` +
    `isSuperAdmin=${payload.isSuperAdmin} ` +
    `allow=${payload.allow} ` +
    `denyReason=${payload.denyReason}`
  );
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = req.session?.userId;
  const pendingUserId = req.session?.pendingUserId;
  const sessionGroup = req.session?.sessionGroup ?? null;
  const sessionId = req.session?.id ?? null;
  const cookieHeaderPresent = typeof req.headers["cookie"] === "string" && req.headers["cookie"].trim().length > 0;
  const sessionKeys = Object.keys(req.session ?? {}).sort().join(",");
  const hasPendingMfaSession = Boolean(req.session?.pendingUserId || req.session?.pendingMfaReason);
  const normalizedPath = req.path.replace(/\/+$/, "") || "/";
  const normalizedOriginalPath = req.originalUrl.split("?", 1)[0]?.replace(/\/+$/, "") || "/";
  const normalizedMountedPath = `${req.baseUrl ?? ""}${req.path ?? ""}`.replace(/\/+$/, "") || "/";
  const mfaPendingPathAllowed =
    normalizedPath === "/me"
    || normalizedPath === "/api/auth/me"
    || normalizedMountedPath.endsWith("/auth/me")
    || normalizedOriginalPath.endsWith("/auth/me");
  const mfaPendingForRequest = hasPendingMfaSession && mfaPendingPathAllowed;
  const effectiveUserId = userId ?? (mfaPendingForRequest ? pendingUserId : null);

  if (!effectiveUserId) {
    logFirstAuthRequest({
      req,
      path: req.path,
      method: req.method,
      cookieHeaderPresent,
      sessionExists: Boolean(req.session),
      sessionId,
      sessionGroup,
      userId: null,
      isSuperAdmin: false,
      allow: false,
      denyReason: "missing_user_id",
      sessionKeys,
    });
    res.status(401).json({ error: "Unauthorized. Please sign in." });
    return;
  }

  if (hasPendingMfaSession && !mfaPendingPathAllowed) {
    logFirstAuthRequest({
      req,
      path: req.path,
      method: req.method,
      cookieHeaderPresent,
      sessionExists: Boolean(req.session),
      sessionId,
      sessionGroup,
      userId: userId ?? null,
      isSuperAdmin: false,
      allow: false,
      denyReason: "mfa_pending",
      sessionKeys,
    });
    res.status(401).json({ error: "Two-step verification required.", code: "MFA_REQUIRED" });
    return;
  }

  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, effectiveUserId),
  });

  if (!user) {
    logFirstAuthRequest({
      req,
      path: req.path,
      method: req.method,
      cookieHeaderPresent,
      sessionExists: Boolean(req.session),
      sessionId,
      sessionGroup,
      userId: effectiveUserId,
      isSuperAdmin: false,
      allow: false,
      denyReason: "user_not_found",
      sessionKeys,
    });
    await destroySessionAndClearCookie(req, res, req.session.sessionGroup ?? SESSION_GROUPS.DEFAULT);
    res.status(401).json({ error: "User not found. Please sign in again." });
    return;
  }

  if (user.suspended || user.deletedAt || !user.active) {
    logFirstAuthRequest({
      req,
      path: req.path,
      method: req.method,
      cookieHeaderPresent,
      sessionExists: Boolean(req.session),
      sessionId,
      sessionGroup,
      userId: effectiveUserId,
      isSuperAdmin: Boolean(user.isSuperAdmin),
      allow: false,
      denyReason: "inactive_or_suspended",
      sessionKeys,
    });
    await destroySessionAndClearCookie(req, res, req.session.sessionGroup ?? SESSION_GROUPS.DEFAULT);
    res.status(403).json({ error: "Account suspended or deleted. Contact support." });
    return;
  }

  logFirstAuthRequest({
    req,
    path: req.path,
    method: req.method,
    cookieHeaderPresent,
    sessionExists: Boolean(req.session),
    sessionId,
    sessionGroup,
    userId: effectiveUserId,
    isSuperAdmin: Boolean(user.isSuperAdmin),
    allow: true,
    denyReason: null,
    sessionKeys,
  });
  if (!mfaPendingForRequest) {
    await db
      .update(usersTable)
      .set({ lastSeenAt: new Date() })
      .where(eq(usersTable.id, effectiveUserId));
  }
  (req as Request & { authMfaPending?: boolean }).authMfaPending =
    Boolean(hasPendingMfaSession);
  (req as Request & { user: typeof user }).user = user;
  next();
}

declare global {
  namespace Express {
    interface Request {
      authMfaPending?: boolean;
    }
  }
}

export async function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  await requireAuth(req, res, async () => {
    const user = (req as Request & { user: { isSuperAdmin: boolean } }).user;
    const sessionGroup = req.session?.sessionGroup ?? null;
    const sessionUserId = req.session?.userId ?? null;
    const sessionIsSuperAdmin = Boolean(user?.isSuperAdmin);

    if (!user?.isSuperAdmin) {
      logAdminGuard({
        req,
        path: req.path,
        sessionExists: Boolean(req.session),
        sessionGroup,
        userId: sessionUserId,
        isSuperAdmin: sessionIsSuperAdmin,
        allow: false,
        denyReason: "not_superadmin",
      });
      res.status(403).json({ error: "Forbidden. Super admin required." });
      return;
    }

    logAdminGuard({
      req,
      path: req.path,
      sessionExists: Boolean(req.session),
      sessionGroup,
      userId: sessionUserId,
      isSuperAdmin: sessionIsSuperAdmin,
      allow: true,
      denyReason: null,
    });
    next();
  });
}
