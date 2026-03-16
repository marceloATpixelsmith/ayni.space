import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Platform users - shared across all apps
export const usersTable = pgTable("users", {
  id: text("id").primaryKey(), // UUID from Google sub or generated
  email: text("email").notNull().unique(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  googleId: text("google_id").unique(), // Google OAuth subject ID
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  activeOrgId: text("active_org_id"), // FK set after refs are defined
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
