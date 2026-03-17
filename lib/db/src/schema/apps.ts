import { text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { platform } from "./_schemas";

// App registry - all apps available on the platform
export const appsTable = platform.table("apps", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  iconUrl: text("icon_url"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// App pricing plans
export const appPlansTable = platform.table("app_plans", {
  id: text("id").primaryKey(),
  appId: text("app_id").notNull(),
  name: text("name").notNull(), // e.g. "Starter", "Pro", "Enterprise"
  priceMonthly: integer("price_monthly").notNull().default(0), // in cents
  stripePriceId: text("stripe_price_id"),
  features: text("features").array().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Which apps are enabled for each organization (admin override)
export const orgAppAccessTable = platform.table("org_app_access", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  appId: text("app_id").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAppSchema = createInsertSchema(appsTable).omit({ createdAt: true, updatedAt: true });
export const insertAppPlanSchema = createInsertSchema(appPlansTable).omit({ createdAt: true });
export type InsertApp = z.infer<typeof insertAppSchema>;
export type InsertAppPlan = z.infer<typeof insertAppPlanSchema>;
export type App = typeof appsTable.$inferSelect;
export type AppPlan = typeof appPlansTable.$inferSelect;
export type OrgAppAccess = typeof orgAppAccessTable.$inferSelect;
