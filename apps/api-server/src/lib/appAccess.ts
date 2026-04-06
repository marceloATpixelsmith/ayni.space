import { and, eq } from "drizzle-orm";
import {
  db,
  appsTable,
  orgAppAccessTable,
  orgMembershipsTable,
  organizationsTable,
  userAppAccessTable,
  usersTable,
} from "@workspace/db";
import {
  getAuthRoutePolicyForProfile,
  resolveNormalizedAccessProfile,
} from "./appAccessProfile.js";

function getDefaultRouteByAppSlug(appSlug: string): string {
  return appSlug === "admin" ? "/dashboard" : `/${appSlug}`;
}

export async function getAppBySlug(appSlug: string) {
  return db.query.appsTable.findFirst({
    where: and(eq(appsTable.slug, appSlug), eq(appsTable.isActive, true)),
  });
}

export async function canAccessApp(
  userId: string,
  appSlug: string,
): Promise<boolean> {
  const context = await getAppContext(userId, appSlug);
  return Boolean(context?.canAccess);
}

export async function getRequiredOnboarding(
  userId: string,
  appSlug: string,
): Promise<"none" | "organization" | "user"> {
  const context = await getAppContext(userId, appSlug);
  return context?.requiredOnboarding ?? "none";
}

export async function getDefaultRoute(
  userId: string,
  appSlug: string,
): Promise<string> {
  const context = await getAppContext(userId, appSlug);
  return context?.defaultRoute ?? getDefaultRouteByAppSlug(appSlug);
}

export async function getAppContext(userId: string, appSlug: string) {
  const app = await getAppBySlug(appSlug);
  if (!app) return null;

  const normalizedAccessProfile = resolveNormalizedAccessProfile(app);
  if (!normalizedAccessProfile) {
    console.warn("[auth/access] invalid app access config", {
      appSlug,
      appId: app.id,
      accessMode: app.accessMode,
    });
    return null;
  }

  console.debug("[auth/access] normalized app profile", {
    appSlug,
    appId: app.id,
    normalizedAccessProfile,
  });

  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, userId),
  });
  if (!user || !user.active || user.suspended || user.deletedAt) return null;

  let appAccess = null;
  try {
    appAccess = await db.query.userAppAccessTable.findFirst({
      where: and(
        eq(userAppAccessTable.userId, userId),
        eq(userAppAccessTable.appId, app.id),
      ),
    });
  } catch {
    appAccess = null;
  }

  const hasActiveAppAccess = appAccess?.accessStatus === "active";
  let activeOrg = null;
  let orgMembership = null;

  let requiredOnboarding: "none" | "organization" | "user" = "none";
  let canAccess = false;

  if (normalizedAccessProfile === "superadmin") {
    canAccess = Boolean(user.isSuperAdmin);
  } else if (normalizedAccessProfile === "organization") {
    let activeMemberships: Array<typeof orgMembershipsTable.$inferSelect> = [];
    try {
      activeMemberships = await db.query.orgMembershipsTable.findMany({
        where: and(
          eq(orgMembershipsTable.userId, userId),
          eq(orgMembershipsTable.membershipStatus, "active"),
        ),
      });
    } catch {
      activeMemberships = [];
    }
    if (activeMemberships.length === 0 && user.activeOrgId) {
      const activeMembership = await db.query.orgMembershipsTable.findFirst({
        where: and(
          eq(orgMembershipsTable.userId, userId),
          eq(orgMembershipsTable.orgId, user.activeOrgId),
          eq(orgMembershipsTable.membershipStatus, "active"),
        ),
      });
      if (activeMembership) activeMemberships = [activeMembership];
    }

    const orgAuthorizations = (
      await Promise.all(
        activeMemberships.map(async (membership) => {
          const organization = await db.query.organizationsTable.findFirst({
            where: and(
              eq(organizationsTable.id, membership.orgId),
              eq(organizationsTable.isActive, true),
            ),
          });
          if (!organization) return null;

          let orgAppAccess = null;
          try {
            orgAppAccess = await db.query.orgAppAccessTable.findFirst({
              where: and(
                eq(orgAppAccessTable.orgId, organization.id),
                eq(orgAppAccessTable.appId, app.id),
                eq(orgAppAccessTable.enabled, true),
              ),
            });
          } catch {
            orgAppAccess = null;
          }
          if (!orgAppAccess && organization.appId !== app.id) return null;

          return { membership, organization };
        }),
      )
    ).filter(Boolean) as Array<{
      membership: (typeof activeMemberships)[number];
      organization: typeof organizationsTable.$inferSelect;
    }>;

    const selectedAuthorization =
      orgAuthorizations.find(
        (item) => item.organization.id === user.activeOrgId,
      ) ??
      orgAuthorizations[0] ??
      null;
    activeOrg = selectedAuthorization?.organization ?? null;
    orgMembership = selectedAuthorization?.membership ?? null;
    canAccess = Boolean(selectedAuthorization) || hasActiveAppAccess;
    if (!canAccess) requiredOnboarding = "organization";
    if (canAccess && !user.name?.trim()) requiredOnboarding = "user";
  } else if (normalizedAccessProfile === "solo") {
    canAccess = true;
    if (!user.name?.trim()) requiredOnboarding = "user";
  } else {
    return null;
  }

  const defaultRoute =
    requiredOnboarding === "organization"
      ? "/onboarding/organization"
      : requiredOnboarding === "user"
        ? "/onboarding/user"
        : getDefaultRouteByAppSlug(appSlug);

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
