import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { destroySessionAndClearCookie } from "../lib/session.js";
import { SESSION_GROUPS } from "../lib/sessionGroup.js";

const SUPERADMIN_TRACE_PREFIX = "[SUPERADMIN-AUTH-TRACE]";
function logAuthCheckTrace(payload: {
  sessionExists: boolean;
  sessionGroup: string | null;
  userId: string | null;
  isSuperAdmin: boolean;
  allow: boolean;
  denyReason: string | null;
}) {
  console.log("[AUTH-CHECK-TRACE]", payload);
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized. Please sign in." });
    return;
  }

  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, userId),
  });

  if (!user) {
    await destroySessionAndClearCookie(req, res, req.session.sessionGroup ?? SESSION_GROUPS.DEFAULT);
    res.status(401).json({ error: "User not found. Please sign in again." });
    return;
  }

  if (user.suspended || user.deletedAt || !user.active) {
    await destroySessionAndClearCookie(req, res, req.session.sessionGroup ?? SESSION_GROUPS.DEFAULT);
    res.status(403).json({ error: "Account suspended or deleted. Contact support." });
    return;
  }

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
      logAuthCheckTrace({
        sessionExists: Boolean(req.session),
        sessionGroup,
        userId: sessionUserId,
        isSuperAdmin: sessionIsSuperAdmin,
        allow: false,
        denyReason: "not_superadmin",
      });
      console.log(`${SUPERADMIN_TRACE_PREFIX} K. FIRST AUTHENTICATED ADMIN CHECK`, {
        sessionExists: Boolean(req.session),
        sessionGroup,
        sessionUserId,
        sessionIsSuperAdmin,
        allow: false,
        denyReason: "not_superadmin",
      });
      res.status(403).json({ error: "Forbidden. Super admin required." });
      return;
    }

    logAuthCheckTrace({
      sessionExists: Boolean(req.session),
      sessionGroup,
      userId: sessionUserId,
      isSuperAdmin: sessionIsSuperAdmin,
      allow: true,
      denyReason: null,
    });
    console.log(`${SUPERADMIN_TRACE_PREFIX} K. FIRST AUTHENTICATED ADMIN CHECK`, {
      sessionExists: Boolean(req.session),
      sessionGroup,
      sessionUserId,
      sessionIsSuperAdmin,
      allow: true,
      denyReason: null,
    });
    next();
  });
}
