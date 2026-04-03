import type { Request, Response, NextFunction } from "express";
import { getUserOrgRole, ORG_ROLES } from "../lib/rbac.js";
import { assertRequestSessionGroupCompatibleWithOrg } from "../lib/sessionGroupCompatibility.js";

function asSingleString(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

export async function requireOrgAccess(req: Request, res: Response, next: NextFunction) {
  const orgId = asSingleString(req.params["orgId"]);
  const userId = req.session?.userId;

  if (!orgId || !userId) {
    res.status(400).json({ error: "Organization ID and user session required." });
    return;
  }

  const sessionGroupCheck = await assertRequestSessionGroupCompatibleWithOrg(req, orgId);
  if (!sessionGroupCheck.ok) {
    if (sessionGroupCheck.reason === "invalid-org") {
      res.status(404).json({ error: "Organization not found" });
      return;
    }

    res.status(403).json({ error: "Organization is not accessible from this session context." });
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
