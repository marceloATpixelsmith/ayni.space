// Centralized RBAC and org membership utilities
import { db, orgMembershipsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export const ROLES = ["owner", "admin", "member", "viewer"];

export async function getUserOrgRole(userId: string, orgId: string) {
  const membership = await db.query.orgMembershipsTable.findFirst({
    where: and(eq(orgMembershipsTable.userId, userId), eq(orgMembershipsTable.orgId, orgId)),
  });
  return membership?.role || null;
}

export function requireOrgRole(minRole: string) {
  const minIdx = ROLES.indexOf(minRole);
  return async (req, res, next) => {
    const userId = req.session?.userId;
    const orgId = req.params["orgId"] || req.body.orgId;
    if (!userId || !orgId) {
      return res.status(400).json({ error: "User and org required" });
    }
    const role = await getUserOrgRole(userId, orgId);
    if (!role || ROLES.indexOf(role) < minIdx) {
      return res.status(403).json({ error: `Requires ${minRole} role or higher` });
    }
    next();
  };
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function normalizeSlug(slug: string) {
  return slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
}
