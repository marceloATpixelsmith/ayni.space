import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Subscription statuses matching Stripe statuses
export const SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "canceled",
  "incomplete",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

// Subscriptions - per-org per-app billing
export const subscriptionsTable = pgTable("subscriptions", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  appId: text("app_id").notNull(),
  planId: text("plan_id").notNull(),
  status: text("status").notNull().default("active"),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  stripeCustomerId: text("stripe_customer_id"),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  trialEnd: timestamp("trial_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSubscriptionSchema = createInsertSchema(subscriptionsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptionsTable.$inferSelect;
