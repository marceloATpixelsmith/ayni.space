import { text, boolean, integer, timestamp, jsonb, uniqueIndex, index, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { platform } from "./_schemas";

export const appAccessModeEnum = pgEnum("app_access_mode", ["superadmin", "solo", "organization"]);
export const accessStatusEnum = pgEnum("access_status", ["pending", "active", "revoked", "suspended"]);

// App registry - reusable definition for current and future apps.
export const appsTable = platform.table(
  "apps",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    domain: text("domain").notNull(),
    baseUrl: text("base_url"),
    turnstileSiteKeyOverride: text("turnstile_site_key_override"),
    description: text("description"),
    iconUrl: text("icon_url"),
    accessMode: appAccessModeEnum("access_mode").notNull().default("organization"),
    staffInvitesEnabled: boolean("staff_invites_enabled").notNull().default(false),
    customerRegistrationEnabled: boolean("customer_registration_enabled").notNull().default(false),
    transactionalFromEmail: text("transactional_from_email"),
    transactionalFromName: text("transactional_from_name"),
    transactionalReplyToEmail: text("transactional_reply_to_email"),
    invitationEmailSubject: text("invitation_email_subject"),
    invitationEmailHtml: text("invitation_email_html"),
    isActive: boolean("is_active").notNull().default(true),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("apps_slug_unique").on(t.slug), uniqueIndex("apps_domain_unique").on(t.domain)]
);

export const userAppAccessTable = platform.table(
  "user_app_access",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    appId: text("app_id").notNull(),
    role: text("role").notNull(),
    accessStatus: accessStatusEnum("access_status").notNull().default("active"),
    grantedByUserId: text("granted_by_user_id"),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("user_app_access_user_app_unique").on(t.userId, t.appId),
    index("user_app_access_user_id_idx").on(t.userId),
    index("user_app_access_app_id_idx").on(t.appId),
  ]
);

// App pricing plans
export const appPlansTable = platform.table("app_plans", {
  id: text("id").primaryKey(),
  appId: text("app_id").notNull(),
  name: text("name").notNull(),
  priceMonthly: integer("price_monthly").notNull().default(0),
  stripePriceId: text("stripe_price_id"),
  features: text("features").array().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orgAppAccessTable = platform.table("org_app_access", {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    appId: text("app_id").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("org_app_access_org_app_unique").on(t.orgId, t.appId),
    index("org_app_access_org_id_idx").on(t.orgId),
    index("org_app_access_app_id_idx").on(t.appId),
  ]
);

export const insertAppSchema = createInsertSchema(appsTable).omit({ createdAt: true, updatedAt: true });
export const insertAppPlanSchema = createInsertSchema(appPlansTable).omit({ createdAt: true });
export const insertUserAppAccessSchema = createInsertSchema(userAppAccessTable).omit({ createdAt: true, updatedAt: true, grantedAt: true });
export type InsertApp = z.infer<typeof insertAppSchema>;
export type InsertAppPlan = z.infer<typeof insertAppPlanSchema>;
export type InsertUserAppAccess = z.infer<typeof insertUserAppAccessSchema>;
export type App = typeof appsTable.$inferSelect;
export type AppPlan = typeof appPlansTable.$inferSelect;
export type UserAppAccess = typeof userAppAccessTable.$inferSelect;
export type OrgAppAccess = typeof orgAppAccessTable.$inferSelect;
