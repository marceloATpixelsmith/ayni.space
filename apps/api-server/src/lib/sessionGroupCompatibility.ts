import type { Request } from "express";
import { and, eq } from "drizzle-orm";
import { appsTable, db, orgAppAccessTable, organizationsTable, type App } from "@workspace/db";
import { SESSION_GROUPS } from "./sessionGroup.js";

export type OrgSessionGroupContext = {
  orgId: string;
  appIds: string[];
  appSlugs: string[];
  targetSessionGroups: string[];
};

function readSessionGroupFromAppMetadata(app: Pick<App, "metadata">): string | null {
  const metadata = app.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;

  const candidate = (metadata as Record<string, unknown>)["sessionGroup"];
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate.trim();
  }

  return null;
}

export function resolveSessionGroupForApp(app: Pick<App, "slug" | "metadata">): string {
  const metadataSessionGroup = readSessionGroupFromAppMetadata(app);
  if (metadataSessionGroup) return metadataSessionGroup;
  if (app.slug === "admin") return SESSION_GROUPS.ADMIN;
  return SESSION_GROUPS.DEFAULT;
}

export async function resolveOrgSessionGroupContext(orgId: string): Promise<OrgSessionGroupContext | null> {
  const org = await db.query.organizationsTable.findFirst({
    where: and(eq(organizationsTable.id, orgId), eq(organizationsTable.isActive, true)),
  });
  if (!org) return null;

  let orgAppAccessRows: Array<typeof orgAppAccessTable.$inferSelect> = [];
  try {
    orgAppAccessRows = await db.query.orgAppAccessTable.findMany({
      where: and(eq(orgAppAccessTable.orgId, orgId), eq(orgAppAccessTable.enabled, true)),
    });
  } catch {
    orgAppAccessRows = [];
  }
  if (orgAppAccessRows.length === 0 && org.appId) {
    orgAppAccessRows.push({
      id: `legacy-${org.id}-${org.appId}`,
      orgId: org.id,
      appId: org.appId,
      enabled: true,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
    });
  }
  if (orgAppAccessRows.length === 0) return null;

  const apps = (
    await Promise.all(
      orgAppAccessRows.map((accessRow) =>
        db.query.appsTable.findFirst({
          where: and(eq(appsTable.id, accessRow.appId), eq(appsTable.isActive, true)),
        }),
      ),
    )
  ).filter((app): app is NonNullable<typeof app> => Boolean(app));
  if (apps.length === 0) return null;

  return {
    orgId,
    appIds: apps.map((app) => app.id),
    appSlugs: apps.map((app) => app.slug),
    targetSessionGroups: [...new Set(apps.map((app) => resolveSessionGroupForApp(app)))],
  };
}

export function isSessionGroupCompatible(currentSessionGroup: string | null | undefined, targetSessionGroup: string): boolean {
  if (!currentSessionGroup || currentSessionGroup.trim().length === 0) return false;
  return currentSessionGroup === targetSessionGroup;
}

export async function assertRequestSessionGroupCompatibleWithOrg(
  req: Request,
  orgId: string,
): Promise<
  { ok: true; context: OrgSessionGroupContext } |
  { ok: false; reason: "invalid-org" | "incompatible-session-group" | "missing-session-group" }
> {
  const currentSessionGroup = req.session?.sessionGroup ?? req.resolvedSessionGroup ?? null;
  if (!currentSessionGroup) {
    return { ok: false, reason: "missing-session-group" };
  }

  const context = await resolveOrgSessionGroupContext(orgId);
  if (!context) {
    return { ok: false, reason: "invalid-org" };
  }

  if (!context.targetSessionGroups.some((targetSessionGroup) => isSessionGroupCompatible(currentSessionGroup, targetSessionGroup))) {
    return { ok: false, reason: "incompatible-session-group" };
  }

  return { ok: true, context };
}
