import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

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
    const user = (req as Request & { user: { isSuperAdmin: boolean } }).user;

    if (!user?.isSuperAdmin) {
      res.status(403).json({ error: "Forbidden. Super admin required." });
      return;
    }

    next();
  });
}
