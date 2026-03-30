import { Router, type IRouter } from "express";
import {
  db,
  appsTable,
  appPlansTable,
  subscriptionsTable,
  orgAppAccessTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireOrgAccess } from "../middlewares/requireOrgAccess.js";
import { getAppContext, canAccessApp, getRequiredOnboarding, getDefaultRoute } from "../lib/appAccess.js";
import { resolveNormalizedAccessProfile, getAuthRoutePolicyForProfile } from "../lib/appAccessProfile.js";

const router: IRouter = Router();

function asSingleString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

// Helper to format app with plans
async function formatApp(app: typeof appsTable.$inferSelect) {
  const plans = await db.query.appPlansTable.findMany({
    where: and(eq(appPlansTable.appId, app.id), eq(appPlansTable.isActive, true)),
  });
  return {
    id: app.id,
    name: app.name,
    slug: app.slug,
    accessMode: app.accessMode,
    tenancyMode: app.tenancyMode,
    onboardingMode: app.onboardingMode,
    normalizedAccessProfile: resolveNormalizedAccessProfile(app),
    authRoutePolicy: resolveNormalizedAccessProfile(app) ? getAuthRoutePolicyForProfile(resolveNormalizedAccessProfile(app)!) : null,
    description: app.description,
    iconUrl: app.iconUrl,
    isActive: app.isActive,
    plans: plans.map((p) => ({
      id: p.id,
      name: p.name,
      priceMonthly: p.priceMonthly,
      stripePriceId: p.stripePriceId,
      features: p.features,
    })),
  };
}

// ── GET /apps ─────────────────────────────────────────────────────────────────
router.get("/", async (_req, res) => {
  const apps = await db.query.appsTable.findMany({
    where: eq(appsTable.isActive, true),
  });
  const formatted = await Promise.all(apps.map(formatApp));
  res.json(formatted);
});


// ── GET /apps/slug/:appSlug/context ─────────────────────────────────────────
router.get("/slug/:appSlug/context", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const appSlug = asSingleString(req.params["appSlug"]);

  if (!appSlug) {
    res.status(400).json({ error: "appSlug route param required" });
    return;
  }

  const context = await getAppContext(userId, appSlug);

  if (!context) {
    res.status(404).json({ error: "App context not found" });
    return;
  }

  res.json({
    canAccess: await canAccessApp(userId, appSlug),
    requiredOnboarding: await getRequiredOnboarding(userId, appSlug),
    defaultRoute: await getDefaultRoute(userId, appSlug),
    normalizedAccessProfile: context.normalizedAccessProfile,
    authRoutePolicy: context.authRoutePolicy,
    app: context.app,
    appAccess: context.appAccess,
    activeOrg: context.activeOrg,
    orgMembership: context.orgMembership,
  });
});

// ── GET /apps/:appId ──────────────────────────────────────────────────────────
router.get("/:appId", async (req, res) => {
  const appId = asSingleString(req.params["appId"]);
  if (!appId) {
    res.status(400).json({ error: "appId route param required" });
    return;
  }

  const app = await db.query.appsTable.findFirst({
    where: eq(appsTable.id, appId),
  });

  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }

  res.json(await formatApp(app));
});

export default router;

export async function getOrgAppsHandler(req: import("express").Request, res: import("express").Response) {
  const orgId = asSingleString(req.params["orgId"]);
  if (!orgId) {
    res.status(400).json({ error: "orgId route param required" });
    return;
  }

  // Get all subscriptions for this org
  const subs = await db
    .select({
      appId: subscriptionsTable.appId,
      appName: appsTable.name,
      appSlug: appsTable.slug,
      status: subscriptionsTable.status,
      subscriptionId: subscriptionsTable.id,
    })
    .from(subscriptionsTable)
    .innerJoin(appsTable, eq(subscriptionsTable.appId, appsTable.id))
    .where(and(eq(subscriptionsTable.orgId, orgId)));

  // Also include apps that are enabled via admin override without subscription
  const accessOverrides = await db.query.orgAppAccessTable.findMany({
    where: and(eq(orgAppAccessTable.orgId, orgId), eq(orgAppAccessTable.enabled, true)),
  });

  const result: Array<{
    appId: string;
    appName: string;
    appSlug: string;
    status: "active" | "trialing" | "past_due" | "canceled" | "inactive";
    subscriptionId: string | null;
  }> = subs.map((s) => ({
    appId: s.appId,
    appName: s.appName,
    appSlug: s.appSlug,
    status: s.status as "active" | "trialing" | "past_due" | "canceled" | "inactive",
    subscriptionId: s.subscriptionId,
  }));

  // Add admin-enabled apps not already in result
  for (const access of accessOverrides) {
    if (!result.find((r) => r.appId === access.appId)) {
      const app = await db.query.appsTable.findFirst({ where: eq(appsTable.id, access.appId) });
      if (app) {
        result.push({
          appId: app.id,
          appName: app.name,
          appSlug: app.slug,
          status: "active",
          subscriptionId: null,
        });
      }
    }
  }

  res.json(result);
}
