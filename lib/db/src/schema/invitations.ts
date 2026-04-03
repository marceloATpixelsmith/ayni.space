import { text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { platform } from "./_schemas";

export const INVITATION_STATUSES = ["pending", "accepted", "expired", "revoked"] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const invitationsTable = platform.table(
  "invitations",
  {
    id: text("id").primaryKey(),
    appId: text("app_id").notNull(),
    orgId: text("org_id"),
    email: text("email").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    invitedRole: text("invited_role").notNull().default("staff"),
    token: text("token").notNull().unique(),
    invitationStatus: text("invitation_status").notNull().default("pending"),
    invitedByUserId: text("invited_by_user_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedUserId: text("accepted_user_id"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index("invitations_email_idx").on(t.email), index("invitations_token_idx").on(t.token)]
);

export const insertInvitationSchema = createInsertSchema(invitationsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertInvitation = z.infer<typeof insertInvitationSchema>;
export type Invitation = typeof invitationsTable.$inferSelect;
