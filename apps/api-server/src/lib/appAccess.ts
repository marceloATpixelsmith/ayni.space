import { and, eq } from "drizzle-orm";
import {
  appsTable,
  db,
  orgAppAccessTable,
  orgMembershipsTable,
  organizationsTable,
  type App,
} from "@workspace/db";
import { resolveNormalizedAccessProfile } from "./appAccessProfile.js";

export async function getAppBySlug(
  slug: string,
  options?: {
    allowOutageFallback?: boolean;
  },
): Promise<App | null>
{
  const normalizedSlug = slug.trim().toLowerCase();

  try
  {
    return (
      await db.query.appsTable.findFirst({
        where: and(
          eq(appsTable.slug, normalizedSlug),
          eq(appsTable.isActive, true),
        ),
      })
    ) ?? null;
  }
  catch (error)
  {
    if (!options?.allowOutageFallback)
    {
      throw error;
    }

    return getTestFallbackApp(normalizedSlug);
  }
}

export async function getAppSlugByOrigin(
  origin: string,
): Promise<string | null>
{
  try
  {
    const normalizedOrigin = new URL(origin).origin.toLowerCase();

    const apps = await db.query.appsTable.findMany({
      where: eq(appsTable.isActive, true),
    });

    for (const app of apps)
    {
      const baseUrl = app.baseUrl?.trim().toLowerCase();

      if (baseUrl)
      {
        try
        {
          if (new URL(baseUrl).origin.toLowerCase() === normalizedOrigin)
          {
            return app.slug;
          }
        }
        catch
        {
          //NOOP
        }
      }

      const domain = app.domain?.trim().toLowerCase();

      if (!domain)
      {
        continue;
      }

      const normalizedDomain = domain.startsWith("http://") || domain.startsWith("https://")
        ? new URL(domain).origin.toLowerCase()
        : `https://${domain}`;

      if (normalizedDomain === normalizedOrigin)
      {
        return app.slug;
      }
    }

    return null;
  }
  catch
  {
    return null;
  }
}

export function getTestFallbackApp(
  slug: string,
): App | null
{
  if (process.env.NODE_ENV !== "test")
  {
    return null;
  }

  if (slug !== "admin")
  {
    return null;
  }

  return {
    id: "test-admin-app",
    slug: "admin",
    name: "Admin",
    domain: "admin.example.com",
    baseUrl: "https://admin.example.com",
    turnstileSiteKeyOverride: null,
    accessMode: "organization",
    metadata: null,
    description: null,
    iconUrl: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    staffInvitesEnabled: true,
    customerRegistrationEnabled: true,
  } as App;
}

export async function getAppContext(
  userId: string,
  appSlug: string,
): Promise<{
  canAccess: boolean;
  requiredOnboarding: "none" | "organization" | "user";
  normalizedAccessProfile: "solo" | "organization" | "superadmin";
} | null>
{
  const app = await getAppBySlug(appSlug);

  if (!app)
  {
    return null;
  }

  const normalizedAccessProfile = resolveNormalizedAccessProfile(app);

  if (!normalizedAccessProfile)
  {
    return null;
  }

  if (normalizedAccessProfile === "superadmin")
  {
    const user = await db.query.usersTable.findFirst({
      where: (users, { eq }) => eq(users.id, userId),
    });

    return {
      canAccess: Boolean(user?.isSuperAdmin),
      requiredOnboarding: "none",
      normalizedAccessProfile,
    };
  }

  const memberships = await db
    .select({
      orgId: orgMembershipsTable.orgId,
    })
    .from(orgMembershipsTable)
    .where(eq(orgMembershipsTable.userId, userId));

  const orgIds = memberships.map((membership) => membership.orgId);

  let canAccess = false;

  if (orgIds.length > 0)
  {
    const appAccessRows = await db
      .select({
        orgId: orgAppAccessTable.orgId,
      })
      .from(orgAppAccessTable)
      .where(
        and(
          eq(orgAppAccessTable.appId, app.id),
          eq(orgAppAccessTable.enabled, true),
        ),
      );

    const allowedOrgIds = new Set(
      appAccessRows.map((row) => row.orgId),
    );

    canAccess = orgIds.some((orgId) => allowedOrgIds.has(orgId));
  }

  const user = await db.query.usersTable.findFirst({
    where: (users, { eq }) => eq(users.id, userId),
  });

  let requiredOnboarding: "none" | "organization" | "user" = "none";

  //FIX: NEW GOOGLE SIGNUPS FOR ORGANIZATION/SOLO APPS
  //MUST BE ALLOWED INTO ONBOARDING EVEN WITHOUT EXISTING
  //ORG MEMBERSHIPS OR APP ACCESS.
  if (!canAccess)
  {
    if (app.customerRegistrationEnabled)
    {
      canAccess = true;
      requiredOnboarding = "organization";
    }
    else
    {
      requiredOnboarding = "organization";
    }
  }
  else if (!user?.name?.trim())
  {
    requiredOnboarding = "user";
  }

  return {
    canAccess,
    requiredOnboarding,
    normalizedAccessProfile,
  };
}
