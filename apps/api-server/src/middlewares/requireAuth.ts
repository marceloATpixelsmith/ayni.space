import type { Request, Response, NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Middleware: require a valid session with a userId
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized. Please sign in." });
    return;
  }

  // Verify user still exists in DB
  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, userId),
  });

  if (!user) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "User not found. Please sign in again." });
    return;
  }

  if (user.suspended || user.deletedAt) {
    req.session.destroy(() => {});
    res.status(403).json({ error: "Account suspended or deleted. Contact support." });
    return;
  }

  // Update last_seen_at
  await db.update(usersTable).set({ lastSeenAt: new Date() }).where(eq(usersTable.id, userId));

  // Attach user to request for downstream handlers
  (req as Request & { user: typeof user }).user = user;
  next();
}

// Middleware: require super admin role
export async function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  await requireAuth(req, res, () => {
    const user = (req as Request & { user: { isSuperAdmin: boolean } }).user;
    if (!user?.isSuperAdmin) {
      res.status(403).json({ error: "Forbidden. Super admin access required." });
      return;
    }
    next();
  });
}
