import { and, eq } from "drizzle-orm";
import { db, appsTable, orgMembershipsTable, organizationsTable, userAppAccessTable, usersTable } from "@workspace/db";

export async function getAppBySlug(appSlug: string) {
  return db.query.appsTable.findFirst({ where: and(eq(appsTable.slug, appSlug), eq(appsTable.isActive, true)) });
}

export async function canAccessApp(userId: string, appSlug: string): Promise<boolean> {
  const context = await getAppContext(userId, appSlug);
  return Boolean(context?.canAccess);
}

export async function getRequiredOnboarding(userId: string, appSlug: string): Promise<"none" | "organization" | "solo"> {
  const context = await getAppContext(userId, appSlug);
  return context?.requiredOnboarding ?? "none";
}

export async function getDefaultRoute(userId: string, appSlug: string): Promise<string> {
  const context = await getAppContext(userId, appSlug);
  return context?.defaultRoute ?? `/${appSlug}`;
}

export async function getAppContext(userId: string, appSlug: string) {
  const app = await getAppBySlug(appSlug);
  if (!app) return null;

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

  let requiredOnboarding: "none" | "organization" | "solo" = "none";
  let canAccess = false;

  if (app.accessMode === "restricted") {
    // Config-driven super-admin boundary for restricted apps (e.g. admin console).
    canAccess = Boolean(user.isSuperAdmin);
  } else if (app.tenancyMode === "organization") {
    canAccess = hasActiveMembership || hasActiveAppAccess;
    if (!canAccess) {
      requiredOnboarding = app.onboardingMode === "disabled" ? "none" : "organization";
    }
  } else if (app.tenancyMode === "solo") {
    canAccess = hasActiveAppAccess;
    if (!canAccess) {
      requiredOnboarding = app.onboardingMode === "disabled" ? "none" : "solo";
    }
  } else {
    canAccess = app.accessMode === "public_signup" || hasActiveAppAccess;
  }

  const defaultRoute = requiredOnboarding === "organization"
    ? `/${appSlug}/onboarding/organization`
    : requiredOnboarding === "solo"
      ? `/${appSlug}/onboarding/solo`
      : `/${appSlug}`;

  return {
    user,
    app,
    appAccess,
    activeOrg,
    orgMembership,
    requiredOnboarding,
    canAccess,
    defaultRoute,
  };
}
