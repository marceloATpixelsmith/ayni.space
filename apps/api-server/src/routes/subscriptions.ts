import { Router, type IRouter } from "express";
import { db, subscriptionsTable, appsTable, appPlansTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireOrgAccess } from "../middlewares/requireOrgAccess.js";

const router: IRouter = Router();

// ── GET /organizations/:orgId/subscriptions ───────────────────────────────────
router.get("/organizations/:orgId/subscriptions", requireAuth, requireOrgAccess, async (req, res) => {
  const orgId = String(req.params["orgId"]);

  const subs = await db
    .select({
      id: subscriptionsTable.id,
      orgId: subscriptionsTable.orgId,
      appId: subscriptionsTable.appId,
      appName: appsTable.name,
      planName: appPlansTable.name,
      status: subscriptionsTable.status,
      currentPeriodStart: subscriptionsTable.currentPeriodStart,
      currentPeriodEnd: subscriptionsTable.currentPeriodEnd,
      stripeSubscriptionId: subscriptionsTable.stripeSubscriptionId,
      cancelAtPeriodEnd: subscriptionsTable.cancelAtPeriodEnd,
    })
    .from(subscriptionsTable)
    .innerJoin(appsTable, eq(subscriptionsTable.appId, appsTable.id))
    .innerJoin(appPlansTable, eq(subscriptionsTable.planId, appPlansTable.id))
    .where(eq(subscriptionsTable.orgId, orgId));

  res.json(subs);
});

export default router;
