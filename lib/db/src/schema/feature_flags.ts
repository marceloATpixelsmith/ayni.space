import { text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { platform } from "./_schemas";

// Feature flags - platform-wide or per-org feature toggles
export const featureFlagsTable = platform.table("feature_flags", {
  id: text("id").primaryKey(),
  key: text("key").notNull(), // e.g. "shipibo.comments", "ayni.scheduling"
  value: boolean("value").notNull().default(false),
  orgId: text("org_id"), // null = global flag; set = per-org override
  description: text("description"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertFeatureFlagSchema = createInsertSchema(featureFlagsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertFeatureFlag = z.infer<typeof insertFeatureFlagSchema>;
export type FeatureFlag = typeof featureFlagsTable.$inferSelect;
