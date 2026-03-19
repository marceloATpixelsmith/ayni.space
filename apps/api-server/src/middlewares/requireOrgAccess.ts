import type { Request, Response, NextFunction } from "express";
import { getUserOrgRole, ORG_ROLES } from "../lib/rbac.js";

export async function requireOrgAccess(req: Request, res: Response, next: NextFunction) {
  const orgId = req.params["orgId"];
  const userId = req.session?.userId;

  if (!orgId || !userId) {
    res.status(400).json({ error: "Organization ID and user session required." });
    return;
  }

  const role = await getUserOrgRole(userId, orgId);
  if (!role) {
    res.status(403).json({ error: "Access denied. You are not an active member of this organization." });
    return;
  }

  (req as Request & { orgRole: string }).orgRole = role;
  next();
}

export async function requireOrgAdmin(req: Request, res: Response, next: NextFunction) {
  await requireOrgAccess(req, res, () => {
    const role = (req as Request & { orgRole: string }).orgRole;
    const minIdx = ORG_ROLES.indexOf("org_admin");
    if (!role || ORG_ROLES.indexOf(role) < minIdx) {
      res.status(403).json({ error: "Org admin or owner role required." });
      return;
    }

    next();
  });
}
