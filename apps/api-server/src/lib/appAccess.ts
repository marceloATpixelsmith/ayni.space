import { and, eq } from "drizzle-orm";
import {
  db,
  appSettingsTable,
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
import { APP_SETTING_KEYS } from "./runtimeSettings.js";

function getDefaultRouteByAppSlug(appSlug: string): string {
  return appSlug === "admin" ? "/dashboard" : `/${appSlug}`;
}

function buildTestFallbackAppBySlug(appSlug: string): typeof appsTable.$inferSelect | null {
  if (process.env["NODE_ENV"] === "production") return null;

  const normalizedSlug = appSlug.trim().toLowerCase();
  if (!normalizedSlug) return null;

  const inferredSessionGroup = normalizedSlug === "admin" ? "admin" : "default";
  const inferredAccessMode = inferredSessionGroup === "admin" ? "superadmin" : "organization";

  return {
    id: `test-app-${normalizedSlug}`,
    slug: normalizedSlug,
    name: normalizedSlug,
    domain: `${normalizedSlug}.local`,
    accessMode: inferredAccessMode,
    isActive: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    customerRegistrationEnabled: true,
    staffInvitesEnabled: true,
    metadata: { sessionGroup: inferredSessionGroup },
    baseUrl: null,
    turnstileSiteKeyOverride: null,
    description: null,
    iconUrl: null,
    transactionalFromEmail: null,
    transactionalFromName: null,
    transactionalReplyToEmail: null,
    invitationEmailSubject: null,
    invitationEmailHtml: null,
  } satisfies typeof appsTable.$inferSelect;
}

export async function getAppBySlug(appSlug: string | null | undefined) {
  const normalizedSlug =
    typeof appSlug === "string" ? appSlug.trim().toLowerCase() : "";
  if (!normalizedSlug) return null;
  try {
    const directMatch = await db.query.appsTable.findFirst({
      where: and(eq(appsTable.slug, normalizedSlug), eq(appsTable.isActive, true)),
    });
    if (directMatch) return directMatch;

    const mappedApps = await db
      .select({
        app: appsTable,
      })
      .from(appSettingsTable)
      .innerJoin(appsTable, eq(appSettingsTable.appId, appsTable.id))
      .where(
        and(
          eq(appSettingsTable.key, APP_SETTING_KEYS.VITE_APP_SLUG),
          eq(appSettingsTable.value, normalizedSlug),
          eq(appsTable.isActive, true),
        ),
      );

    if (mappedApps.length !== 1) {
      return null;
    }

    return mappedApps[0]!.app;
  } catch (error) {
    const fallbackAppEnabled =
      process.env["AUTH_ALLOW_TEST_APP_LOOKUP_FALLBACK"] === "true";
    const fallbackApp = fallbackAppEnabled
      ? buildTestFallbackAppBySlug(normalizedSlug)
      : null;
    if (fallbackAppEnabled && fallbackApp) {
      console.warn("[auth/access] canonical app lookup failed, using test fallback", {
        appSlug: normalizedSlug,
        error: error instanceof Error ? error.message : String(error),
      });
      return fallbackApp;
    }
    throw error;
  }
}

export async function getAppSlugByOrigin(origin: string): Promise<string | null> {
  let normalizedHost: string | null = null;
  let normalizedHostname: string | null = null;
  try {
    const parsedOrigin = new URL(origin);
    normalizedHost = parsedOrigin.host.toLowerCase();
    normalizedHostname = parsedOrigin.hostname.toLowerCase();
  } catch {
    normalizedHost = null;
    normalizedHostname = null;
  }
  if (!normalizedHost) return null;

  const appByHost = await db.query.appsTable.findFirst({
    where: and(eq(appsTable.domain, normalizedHost), eq(appsTable.isActive, true)),
    columns: {
      slug: true,
    },
  });
  if (appByHost?.slug) return appByHost.slug;

  if (!normalizedHostname || normalizedHostname === normalizedHost) return null;

  const appByHostname = await db.query.appsTable.findFirst({
    where: and(eq(appsTable.domain, normalizedHostname), eq(appsTable.isActive, true)),
    columns: {
      slug: true,
    },
  });
  return appByHostname?.slug ?? null;
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
    if (!canAccess) {
      if (app.customerRegistrationEnabled) {
        canAccess = true;
        requiredOnboarding = user.name?.trim() ? "none" : "user";
      } else {
        requiredOnboarding = "organization";
      }
    } else if (!user.name?.trim()) {
      requiredOnboarding = "user";
    }
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
