import { text, uuid, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { platform } from "./_schemas";

export const usersTable = platform.table("users",
{
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  googleId: text("google_id").unique(),
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  activeOrgId: uuid("active_org_id"),
  // --- SaaS status fields ---
  active: boolean("active").notNull().default(true),
  suspended: boolean("suspended").notNull().default(false),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit(
{
  createdAt: true,
  updatedAt: true,
});

export type User = typeof usersTable.$inferSelect;
export type NewUser = typeof usersTable.$inferInsert;