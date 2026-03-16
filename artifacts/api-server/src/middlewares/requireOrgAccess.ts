import type { Request, Response, NextFunction } from "express";
import { db, orgMembershipsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

// Middleware: require membership in the org from :orgId param
export async function requireOrgAccess(req: Request, res: Response, next: NextFunction) {
  const orgId = req.params["orgId"];
  const userId = req.session?.userId;

  if (!orgId || !userId) {
    res.status(400).json({ error: "Organization ID and user session required." });
    return;
  }

  const membership = await db.query.orgMembershipsTable.findFirst({
    where: and(
      eq(orgMembershipsTable.userId, userId),
      eq(orgMembershipsTable.orgId, orgId)
    ),
  });

  if (!membership) {
    res.status(403).json({ error: "Access denied. You are not a member of this organization." });
    return;
  }

  (req as Request & { orgMembership: typeof membership }).orgMembership = membership;
  next();
}

// Middleware: require at least admin role in org
export async function requireOrgAdmin(req: Request, res: Response, next: NextFunction) {
  await requireOrgAccess(req, res, () => {
    const membership = (req as Request & { orgMembership: { role: string } }).orgMembership;
    const adminRoles = ["owner", "admin"];
    if (!membership || !adminRoles.includes(membership.role)) {
      res.status(403).json({ error: "Admin or owner role required." });
      return;
    }
    next();
  });
}
