import { db, orgMembershipsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export const ORG_ROLES = ["staff", "org_admin", "org_owner"];

export async function getUserOrgRole(userId: string, orgId: string) {
  const membership = await db.query.orgMembershipsTable.findFirst({
    where: and(
      eq(orgMembershipsTable.userId, userId),
      eq(orgMembershipsTable.orgId, orgId),
      eq(orgMembershipsTable.membershipStatus, "active")
    ),
  });
  return membership?.role || null;
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function normalizeSlug(slug: string) {
  return slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
}
