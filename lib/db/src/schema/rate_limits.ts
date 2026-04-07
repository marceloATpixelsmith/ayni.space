import { integer, text, timestamp } from "drizzle-orm/pg-core";
import { platform } from "./_schemas";

export const rateLimitsTable = platform.table("rate_limits", {
  bucketKey: text("bucket_key").primaryKey(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true, mode: "date" }).notNull(),
  count: integer("count").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
});
