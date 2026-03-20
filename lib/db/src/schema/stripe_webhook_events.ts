import { text, timestamp } from "drizzle-orm/pg-core";
import { platform } from "./_schemas";

export const stripeWebhookEventsTable = platform.table("stripe_webhook_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});
