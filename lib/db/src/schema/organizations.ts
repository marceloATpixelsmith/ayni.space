import { text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { platform } from "./_schemas";

// Organizations are tenant containers for organization-mode apps.
export const organizationsTable = platform.table(
  "organizations",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    appId: text("app_id").notNull().default("ayni"),
    ownerUserId: text("owner_user_id"),
    logoUrl: text("logo_url"),
    website: text("website"),
    billingEmail: text("billing_email"),
    stripeCustomerId: text("stripe_customer_id").unique(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index("organizations_slug_idx").on(t.slug), index("organizations_app_id_idx").on(t.appId)]
);

export const insertOrganizationSchema = createInsertSchema(organizationsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Organization = typeof organizationsTable.$inferSelect;
