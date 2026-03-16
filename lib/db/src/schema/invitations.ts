import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const INVITATION_STATUSES = ["pending", "accepted", "cancelled", "expired"] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

// Invitations to join an organization
export const invitationsTable = pgTable("invitations", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  orgId: text("org_id").notNull(),
  role: text("role").notNull().default("member"),
  token: text("token").notNull().unique(), // secure token sent in invite link
  status: text("status").notNull().default("pending"),
  invitedByUserId: text("invited_by_user_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertInvitationSchema = createInsertSchema(invitationsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertInvitation = z.infer<typeof insertInvitationSchema>;
export type Invitation = typeof invitationsTable.$inferSelect;
