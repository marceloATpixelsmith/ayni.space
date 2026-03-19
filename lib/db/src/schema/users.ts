import { text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { platform } from "./_schemas";

export const usersTable = platform.table(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    name: text("name"),
    avatarUrl: text("avatar_url"),
    passwordHash: text("password_hash"),
    googleSubject: text("google_subject").unique(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    isSuperAdmin: boolean("is_super_admin").notNull().default(false),
    activeOrgId: text("active_org_id"),
    active: boolean("active").notNull().default(true),
    suspended: boolean("suspended").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index("users_active_idx").on(t.active), index("users_created_at_idx").on(t.createdAt)]
);

export const insertUserSchema = createInsertSchema(usersTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type User = typeof usersTable.$inferSelect;
export type NewUser = typeof usersTable.$inferInsert;
export type InsertUser = z.infer<typeof insertUserSchema>;
