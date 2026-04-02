import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { destroySessionAndClearCookie } from "../lib/session.js";
import { SESSION_GROUPS } from "../lib/sessionGroup.js";
import { logVerboseTrace } from "../lib/traceLogging.js";

function logFirstAuthRequest(payload: {
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
  const { path, method, cookieHeaderPresent, sessionExists, sessionId, sessionGroup, userId, isSuperAdmin, allow, denyReason, sessionKeys } = payload;
  logVerboseTrace(
    `[AUTH-CHECK-TRACE] FIRST AUTH REQUEST ` +
    `path=${path} method=${method} ` +
    `cookieHeaderPresent=${cookieHeaderPresent} ` +
    `sessionExists=${sessionExists} ` +
    `sessionId=${sessionId} ` +
    `sessionGroup=${sessionGroup} ` +
    `userId=${userId} ` +
    `isSuperAdmin=${isSuperAdmin} ` +
    `allow=${allow} ` +
    `denyReason=${denyReason} ` +
    `sessionKeys=${sessionKeys}`
  );
}

function logAdminGuard(payload: {
  path: string;
  sessionExists: boolean;
  sessionGroup: string | null;
  userId: string | null;
  isSuperAdmin: boolean;
  allow: boolean;
  denyReason: string | null;
}) {
  const { path, sessionExists, sessionGroup, userId, isSuperAdmin, allow, denyReason } = payload;
  logVerboseTrace(
    `[AUTH-CHECK-TRACE] ADMIN GUARD ` +
    `path=${path} ` +
    `sessionExists=${sessionExists} ` +
    `sessionGroup=${sessionGroup} ` +
    `userId=${userId} ` +
    `isSuperAdmin=${isSuperAdmin} ` +
    `allow=${allow} ` +
    `denyReason=${denyReason}`
  );
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = req.session?.userId;
  const sessionGroup = req.session?.sessionGroup ?? null;
  const sessionId = req.session?.id ?? null;
  const cookieHeaderPresent = typeof req.headers["cookie"] === "string" && req.headers["cookie"].trim().length > 0;
  const sessionKeys = Object.keys(req.session ?? {}).sort().join(",");

  if (!userId) {
    logFirstAuthRequest({
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

  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, userId),
  });

  if (!user) {
    logFirstAuthRequest({
      path: req.path,
      method: req.method,
      cookieHeaderPresent,
      sessionExists: Boolean(req.session),
      sessionId,
      sessionGroup,
      userId,
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
      path: req.path,
      method: req.method,
      cookieHeaderPresent,
      sessionExists: Boolean(req.session),
      sessionId,
      sessionGroup,
      userId,
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
    path: req.path,
    method: req.method,
    cookieHeaderPresent,
    sessionExists: Boolean(req.session),
    sessionId,
    sessionGroup,
    userId,
    isSuperAdmin: Boolean(user.isSuperAdmin),
    allow: true,
    denyReason: null,
    sessionKeys,
  });
  await db.update(usersTable).set({ lastSeenAt: new Date() }).where(eq(usersTable.id, userId));
  (req as Request & { user: typeof user }).user = user;
  next();
}

export async function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  await requireAuth(req, res, async () => {
    const user = (req as Request & { user: { isSuperAdmin: boolean } }).user;
    const sessionGroup = req.session?.sessionGroup ?? null;
    const sessionUserId = req.session?.userId ?? null;
    const sessionIsSuperAdmin = Boolean(user?.isSuperAdmin);

    if (!user?.isSuperAdmin) {
      logAdminGuard({
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
