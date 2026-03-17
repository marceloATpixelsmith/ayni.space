import { text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { platform } from "./_schemas";

// Audit log for all significant platform actions
export const auditLogsTable = platform.table("audit_logs", {
  id: text("id").primaryKey(),
  orgId: text("org_id"), // null for platform-level events
  userId: text("user_id"), // null for system events
  userEmail: text("user_email"),
  action: text("action").notNull(), // e.g. "org.member.invited", "subscription.created"
  resourceType: text("resource_type").notNull(), // e.g. "user", "organization", "subscription"
  resourceId: text("resource_id"),
  metadata: jsonb("metadata"), // additional context data
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({
  createdAt: true,
});
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogsTable.$inferSelect;
