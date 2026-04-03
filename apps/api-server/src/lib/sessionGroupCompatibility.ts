import type { Request } from "express";
import { and, eq } from "drizzle-orm";
import { appsTable, db, organizationsTable, type App } from "@workspace/db";
import { SESSION_GROUPS } from "./sessionGroup.js";

export type OrgSessionGroupContext = {
  orgId: string;
  appId: string;
  appSlug: string;
  targetSessionGroup: string;
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
    where: eq(organizationsTable.id, orgId),
  });
  if (!org?.appId) return null;

  const app = await db.query.appsTable.findFirst({
    where: and(eq(appsTable.id, org.appId), eq(appsTable.isActive, true)),
  });
  if (!app) return null;

  return {
    orgId: org.id,
    appId: app.id,
    appSlug: app.slug,
    targetSessionGroup: resolveSessionGroupForApp(app),
  };
}

export function isSessionGroupCompatible(currentSessionGroup: string | null | undefined, targetSessionGroup: string): boolean {
  if (!currentSessionGroup || currentSessionGroup.trim().length === 0) return false;
  return currentSessionGroup === targetSessionGroup;
}

export async function assertRequestSessionGroupCompatibleWithOrg(
  req: Request,
  orgId: string,
): Promise<{ ok: true; context: OrgSessionGroupContext } | { ok: false; reason: "invalid-org" | "incompatible-session-group" }> {
  const currentSessionGroup = req.session?.sessionGroup ?? req.resolvedSessionGroup ?? null;
  if (!currentSessionGroup) {
    return {
      ok: true,
      context: {
        orgId,
        appId: "",
        appSlug: "",
        targetSessionGroup: SESSION_GROUPS.DEFAULT,
      },
    };
  }

  const context = await resolveOrgSessionGroupContext(orgId);
  if (!context) {
    return { ok: false, reason: "invalid-org" };
  }

  if (!isSessionGroupCompatible(currentSessionGroup, context.targetSessionGroup)) {
    return { ok: false, reason: "incompatible-session-group" };
  }

  return { ok: true, context };
}
