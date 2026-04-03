import { and, eq } from "drizzle-orm";
import { db, appsTable, orgMembershipsTable, organizationsTable, userAppAccessTable, usersTable } from "@workspace/db";
import { getAuthRoutePolicyForProfile, resolveNormalizedAccessProfile } from "./appAccessProfile.js";

function getDefaultRouteByAppSlug(appSlug: string): string {
  return appSlug === "admin" ? "/dashboard" : `/${appSlug}`;
}

export async function getAppBySlug(appSlug: string) {
  return db.query.appsTable.findFirst({ where: and(eq(appsTable.slug, appSlug), eq(appsTable.isActive, true)) });
}

export async function canAccessApp(userId: string, appSlug: string): Promise<boolean> {
  const context = await getAppContext(userId, appSlug);
  return Boolean(context?.canAccess);
}

export async function getRequiredOnboarding(userId: string, appSlug: string): Promise<"none" | "organization"> {
  const context = await getAppContext(userId, appSlug);
  return context?.requiredOnboarding ?? "none";
}

export async function getDefaultRoute(userId: string, appSlug: string): Promise<string> {
  const context = await getAppContext(userId, appSlug);
  return context?.defaultRoute ?? getDefaultRouteByAppSlug(appSlug);
}

export async function getAppContext(userId: string, appSlug: string) {
  const app = await getAppBySlug(appSlug);
  if (!app) return null;

  const normalizedAccessProfile = resolveNormalizedAccessProfile(app);
  if (!normalizedAccessProfile) {
    console.warn("[auth/access] invalid app access config", { appSlug, appId: app.id, accessMode: app.accessMode });
    return null;
  }

  console.debug("[auth/access] normalized app profile", { appSlug, appId: app.id, normalizedAccessProfile });

  const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
  if (!user || !user.active || user.suspended || user.deletedAt) return null;

  const appAccess = await db.query.userAppAccessTable.findFirst({
    where: and(eq(userAppAccessTable.userId, userId), eq(userAppAccessTable.appId, app.id)),
  });

  const activeOrg = user.activeOrgId
    ? await db.query.organizationsTable.findFirst({ where: eq(organizationsTable.id, user.activeOrgId) })
    : null;

  const orgMembership = user.activeOrgId
    ? await db.query.orgMembershipsTable.findFirst({
        where: and(eq(orgMembershipsTable.userId, userId), eq(orgMembershipsTable.orgId, user.activeOrgId)),
      })
    : null;

  const hasActiveAppAccess = appAccess?.accessStatus === "active";
  const hasActiveMembership = orgMembership?.membershipStatus === "active";

  let requiredOnboarding: "none" | "organization" = "none";
  let canAccess = false;

  if (normalizedAccessProfile === "superadmin") {
    canAccess = Boolean(user.isSuperAdmin);
  } else if (normalizedAccessProfile === "organization") {
    canAccess = hasActiveMembership || hasActiveAppAccess;
    if (!canAccess) requiredOnboarding = "organization";
  } else if (normalizedAccessProfile === "solo") {
    // Solo users are auto-self-onboarded: no onboarding route and no invite/customer registration paths.
    canAccess = true;
  } else {
    return null;
  }

  const defaultRoute = requiredOnboarding === "organization" ? "/onboarding/organization" : getDefaultRouteByAppSlug(appSlug);

  return {
    user,
    app,
    appAccess,
    activeOrg,
    orgMembership,
    normalizedAccessProfile,
    authRoutePolicy: getAuthRoutePolicyForProfile(normalizedAccessProfile, {
      staffInvitesEnabled: app.staffInvitesEnabled,
      customerRegistrationEnabled: app.customerRegistrationEnabled,
    }),
    requiredOnboarding,
    canAccess,
    defaultRoute,
  };
}
