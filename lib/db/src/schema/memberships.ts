import { text, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { platform } from "./_schemas";

export const MEMBERSHIP_STATUSES = ["invited", "active", "revoked", "suspended"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const ORG_APP_ROLES = ["org_owner", "org_admin", "staff"] as const;
export type OrgAppRole = (typeof ORG_APP_ROLES)[number];

export const orgMembershipsTable = platform.table(
  "org_memberships",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    orgId: text("org_id").notNull(),
    role: text("role").notNull().default("staff"),
    membershipStatus: text("membership_status").notNull().default("active"),
    invitedByUserId: text("invited_by_user_id"),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("org_memberships_org_user_unique").on(t.orgId, t.userId),
    index("org_memberships_org_id_idx").on(t.orgId),
    index("org_memberships_user_id_idx").on(t.userId),
  ]
);

export const insertOrgMembershipSchema = createInsertSchema(orgMembershipsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertOrgMembership = z.infer<typeof insertOrgMembershipSchema>;
export type OrgMembership = typeof orgMembershipsTable.$inferSelect;
