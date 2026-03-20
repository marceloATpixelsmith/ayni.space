import { getUserOrgRole } from "./rbac.js";

export async function userHasActiveOrgMembership(userId: string, orgId: string): Promise<boolean> {
  const role = await getUserOrgRole(userId, orgId);
  return Boolean(role);
}
