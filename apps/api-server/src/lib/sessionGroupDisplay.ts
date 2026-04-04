import { db, sessionGroupsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { SESSION_GROUPS } from "./sessionGroup.js";

const FALLBACK_DISPLAY_NAMES: Record<string, string> = {
  [SESSION_GROUPS.DEFAULT]: "Ayni Workspace",
  [SESSION_GROUPS.ADMIN]: "Ayni Admin",
};

export async function getSessionGroupDisplayName(sessionGroup: string): Promise<string> {
  const row = await db.query.sessionGroupsTable.findFirst({ where: eq(sessionGroupsTable.id, sessionGroup) });
  if (row?.displayName) return row.displayName;
  return FALLBACK_DISPLAY_NAMES[sessionGroup] ?? `Ayni ${sessionGroup}`;
}

export async function getMfaIssuerForSessionGroup(sessionGroup: string): Promise<string> {
  return getSessionGroupDisplayName(sessionGroup);
}
