import type { Request, Response, NextFunction } from "express";
import { getUserOrgRole, ROLES } from "../lib/rbac.js";

//──────────────────────────────────────────────────────────────────────────────
//MIDDLEWARE:REQUIRE MEMBERSHIP IN THE ORG FROM :orgId PARAM
//──────────────────────────────────────────────────────────────────────────────
export async function requireOrgAccess
(
  req: Request,
  res: Response,
  next: NextFunction
)
{
  const orgId = req.params["orgId"];
  const userId = req.session?.userId;

  if (!orgId || !userId)
  {
    res.status(400).json({ error: "Organization ID and user session required." });
    return;
  }

  const role = await getUserOrgRole(userId, orgId);

  if (!role)
  {
    res.status(403).json({ error: "Access denied. You are not a member of this organization." });
    return;
  }

  (req as Request & { orgRole: string }).orgRole = role;

  next();
}

//──────────────────────────────────────────────────────────────────────────────
//MIDDLEWARE:REQUIRE AT LEAST ADMIN ROLE IN ORG
//──────────────────────────────────────────────────────────────────────────────
export async function requireOrgAdmin
(
  req: Request,
  res: Response,
  next: NextFunction
)
{
  await requireOrgAccess
  (
    req,
    res,
    () =>
    {
      const role = (req as Request & { orgRole: string }).orgRole;
      const minIdx = ROLES.indexOf("admin");

      if (!role || ROLES.indexOf(role) < minIdx)
      {
        res.status(403).json({ error: "Admin or owner role required." });
        return;
      }

      next();
    }
  );
}