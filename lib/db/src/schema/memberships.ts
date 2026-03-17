import { text, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { platform } from "./_schemas";

// Roles that a member can have in an organization
export const MEMBER_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

// Organization memberships - users can belong to multiple orgs
export const orgMembershipsTable = platform.table(
  "org_memberships",
  {
    userId: text("user_id").notNull(),
    orgId: text("org_id").notNull(),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.userId, t.orgId] })]
);

export const insertOrgMembershipSchema = createInsertSchema(orgMembershipsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertOrgMembership = z.infer<typeof insertOrgMembershipSchema>;
export type OrgMembership = typeof orgMembershipsTable.$inferSelect;
