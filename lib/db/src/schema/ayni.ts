import { pgTable, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Ayni Ceremony Management - ceremonies
export const ayniCeremoniesTable = pgTable("ayni_ceremonies", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  location: text("location"),
  status: text("status").notNull().default("draft"),
  // draft | scheduled | in_progress | completed | cancelled
  capacity: integer("capacity"),
  createdByUserId: text("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// Ayni - participants registered to ceremonies
export const ayniParticipantsTable = pgTable("ayni_participants", {
  id: text("id").primaryKey(),
  ceremonyId: text("ceremony_id").notNull(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  status: text("status").notNull().default("registered"),
  // registered | screened | confirmed | attended | cancelled
  notes: text("notes"),
  screenerUserId: text("screener_user_id"),
  screenedAt: timestamp("screened_at", { withTimezone: true }),
  registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// Ayni - staff members associated with an organization
export const ayniStaffTable = pgTable("ayni_staff", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  userId: text("user_id"), // optional link to platform user
  name: text("name").notNull(),
  email: text("email"),
  role: text("role").notNull(), // e.g. facilitator, assistant, screener
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// Ayni - ceremony-staff assignments
export const ayniCeremonyStaffTable = pgTable("ayni_ceremony_staff", {
  id: text("id").primaryKey(),
  ceremonyId: text("ceremony_id").notNull(),
  staffId: text("staff_id").notNull(),
  role: text("role"), // role for this specific ceremony
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAyniCeremonySchema = createInsertSchema(ayniCeremoniesTable).omit({ createdAt: true, updatedAt: true });
export const insertAyniParticipantSchema = createInsertSchema(ayniParticipantsTable).omit({ updatedAt: true });
export const insertAyniStaffSchema = createInsertSchema(ayniStaffTable).omit({ createdAt: true, updatedAt: true });
export type InsertAyniCeremony = z.infer<typeof insertAyniCeremonySchema>;
export type InsertAyniParticipant = z.infer<typeof insertAyniParticipantSchema>;
export type InsertAyniStaff = z.infer<typeof insertAyniStaffSchema>;
export type AyniCeremony = typeof ayniCeremoniesTable.$inferSelect;
export type AyniParticipant = typeof ayniParticipantsTable.$inferSelect;
export type AyniStaff = typeof ayniStaffTable.$inferSelect;
