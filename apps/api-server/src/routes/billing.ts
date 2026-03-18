import { Router, type IRouter } from "express";
import { db, organizationsTable, appPlansTable, subscriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireOrgAccess } from "../middlewares/requireOrgAccess.js";
import { writeAuditLog } from "../lib/audit.js";

const router: IRouter = Router();

function getStripe() {
  const Stripe = require("stripe");
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) throw new Error("STRIPE_SECRET_KEY is required");
  return Stripe(key, { apiVersion: "2024-12-18.acacia" });
}

// ── POST /billing/checkout ────────────────────────────────────────────────────
router.post("/checkout", requireAuth, requireOrgAccess, async (req, res) => {
  const { orgId, appId, planId, successUrl, cancelUrl } = req.body as {
    orgId: string;
    appId: string;
    planId: string;
    successUrl?: string;
    cancelUrl?: string;
  };

  try {
    const stripe = getStripe();
    const org = await db.query.organizationsTable.findFirst({
      where: eq(organizationsTable.id, orgId),
    });
    const plan = await db.query.appPlansTable.findFirst({
      where: eq(appPlansTable.id, planId),
    });

    if (!org || !plan) {
      res.status(404).json({ error: "Organization or plan not found" });
      return;
    }

    if (!plan.stripePriceId) {
      res.status(400).json({ error: "This plan does not have a Stripe price configured" });
      return;
    }

    // Create or retrieve Stripe customer
    let customerId = org.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.session.userId,
        metadata: { orgId: org.id, orgName: org.name },
      });
      customerId = customer.id;
      await db
        .update(organizationsTable)
        .set({ stripeCustomerId: customerId })
        .where(eq(organizationsTable.id, orgId));
    }

    const frontendBase = process.env["FRONTEND_URL"] || "";
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: successUrl || `${frontendBase}/dashboard/billing?success=1`,
      cancel_url: cancelUrl || `${frontendBase}/dashboard/billing?canceled=1`,
      subscription_data: {
        trial_period_days: 14,
        metadata: { orgId, appId, planId },
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Checkout error:", err);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// ── POST /billing/portal ──────────────────────────────────────────────────────
router.post("/portal", requireAuth, requireOrgAccess, async (req, res) => {
  const { orgId, returnUrl } = req.body as { orgId: string; returnUrl?: string };

  try {
    const stripe = getStripe();
    const org = await db.query.organizationsTable.findFirst({
      where: eq(organizationsTable.id, orgId),
    });

    if (!org?.stripeCustomerId) {
      res.status(400).json({ error: "No Stripe customer found for this organization" });
      return;
    }

    const frontendBase = process.env["FRONTEND_URL"] || "";
    const session = await stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: returnUrl || `${frontendBase}/dashboard/billing`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Portal error:", err);
    res.status(500).json({ error: "Failed to create portal session" });
  }
});

// ── POST /billing/webhook ─────────────────────────────────────────────────────
// Raw body required — handled in app.ts before JSON middleware
router.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env["STRIPE_WEBHOOK_SECRET"];
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET not configured");
    res.status(500).json({ error: "Webhook secret not configured" });
    return;
  }
  if (!sig || typeof sig !== "string") {
    res.status(400).json({ error: "Missing Stripe signature" });
    return;
  }
  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    res.status(400).json({ error: "Invalid webhook signature" });
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Record<string, unknown>;
        const meta = (session["subscription_data"] as Record<string, unknown>)?.["metadata"] as Record<string, string>;
        if (meta?.orgId && meta?.appId && meta?.planId) {
          const subId = session["subscription"] as string;
          const sub = await getStripe().subscriptions.retrieve(subId);
          await db.insert(subscriptionsTable).values({
            id: randomUUID(),
            orgId: meta.orgId,
            appId: meta.appId,
            planId: meta.planId,
            status: "active",
            stripeSubscriptionId: subId,
            stripeCustomerId: sub.customer as string,
            currentPeriodStart: new Date((sub.current_period_start as number) * 1000),
            currentPeriodEnd: new Date((sub.current_period_end as number) * 1000),
            cancelAtPeriodEnd: false,
          });
          writeAuditLog({
            orgId: meta.orgId,
            action: "subscription.created",
            resourceType: "subscription",
            metadata: { appId: meta.appId, planId: meta.planId, eventType: event.type, eventId: event["id"] },
          });
        }
        break;
      }
      case "customer.subscription.updated": {
        const sub = event.data.object as Record<string, unknown>;
        if (sub["id"]) {
          await db
            .update(subscriptionsTable)
            .set({
              status: sub["status"] as string,
              cancelAtPeriodEnd: sub["cancel_at_period_end"] as boolean,
              currentPeriodStart: new Date((sub["current_period_start"] as number) * 1000),
              currentPeriodEnd: new Date((sub["current_period_end"] as number) * 1000),
            })
            .where(eq(subscriptionsTable.stripeSubscriptionId, sub["id"] as string));
          writeAuditLog({
            action: "subscription.updated",
            resourceType: "subscription",
            resourceId: sub["id"] as string,
            metadata: { status: sub["status"], eventType: event.type, eventId: event["id"] },
          });
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Record<string, unknown>;
        if (sub["id"]) {
          await db
            .update(subscriptionsTable)
            .set({ status: "canceled" })
            .where(eq(subscriptionsTable.stripeSubscriptionId, sub["id"] as string));
          writeAuditLog({
            action: "subscription.deleted",
            resourceType: "subscription",
            resourceId: sub["id"] as string,
            metadata: { eventType: event.type, eventId: event["id"] },
          });
        }
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Record<string, unknown>;
        const subId = invoice["subscription"] as string;
        if (subId) {
          await db
            .update(subscriptionsTable)
            .set({ status: "past_due" })
            .where(eq(subscriptionsTable.stripeSubscriptionId, subId));
          writeAuditLog({
            action: "invoice.payment_failed",
            resourceType: "subscription",
            resourceId: subId,
            metadata: { eventType: event.type, eventId: event["id"] },
          });
        }
        break;
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Webhook processing error:", err);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

export default router;
