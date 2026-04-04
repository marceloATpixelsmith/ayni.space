import { db, sessionGroupsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { SESSION_GROUPS } from "./sessionGroup.js";

const REQUIRED_SESSION_GROUP_DISPLAY_NAMES: Record<string, string> = {
  [SESSION_GROUPS.DEFAULT]: "Ayni Workspace",
  [SESSION_GROUPS.ADMIN]: "Ayni Admin",
};

export async function ensureRequiredSessionGroupsSeeded() {
  await db.insert(sessionGroupsTable).values(
    Object.entries(REQUIRED_SESSION_GROUP_DISPLAY_NAMES).map(([id, displayName]) => ({
      id,
      displayName,
    })),
  ).onConflictDoNothing();
}

export async function getSessionGroupDisplayName(sessionGroup: string): Promise<string> {
  if (sessionGroup in REQUIRED_SESSION_GROUP_DISPLAY_NAMES) {
    await ensureRequiredSessionGroupsSeeded();
  }
  const row = await db.query.sessionGroupsTable.findFirst({ where: eq(sessionGroupsTable.id, sessionGroup) });
  if (row?.displayName) return row.displayName;
  return `Ayni ${sessionGroup}`;
}

export async function getMfaIssuerForSessionGroup(sessionGroup: string): Promise<string> {
  return getSessionGroupDisplayName(sessionGroup);
}
