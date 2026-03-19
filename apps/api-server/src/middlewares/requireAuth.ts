import type { Request, Response, NextFunction } from "express";
import { and, eq } from "drizzle-orm";
import { db, usersTable, userAppAccessTable, appsTable } from "@workspace/db";

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
    req.session.destroy(() => {});
    res.status(401).json({ error: "User not found. Please sign in again." });
    return;
  }

  if (user.suspended || user.deletedAt || !user.active) {
    req.session.destroy(() => {});
    res.status(403).json({ error: "Account suspended or deleted. Contact support." });
    return;
  }

  await db.update(usersTable).set({ lastSeenAt: new Date() }).where(eq(usersTable.id, userId));
  (req as Request & { user: typeof user }).user = user;
  next();
}

export async function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  await requireAuth(req, res, async () => {
    const user = (req as Request & { user: { isSuperAdmin: boolean; id: string } }).user;

    const adminApp = await db.query.appsTable.findFirst({ where: eq(appsTable.slug, "admin") });
    const appAccess = adminApp
      ? await db.query.userAppAccessTable.findFirst({
          where: and(
            eq(userAppAccessTable.userId, user.id),
            eq(userAppAccessTable.appId, adminApp.id),
            eq(userAppAccessTable.accessStatus, "active")
          ),
        })
      : null;

    if (!user?.isSuperAdmin || !appAccess) {
      res.status(403).json({ error: "Forbidden. Super admin + admin app access required." });
      return;
    }
    next();
  });
}
