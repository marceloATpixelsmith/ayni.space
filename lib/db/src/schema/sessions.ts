import { text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { platform } from "./_schemas";

// Persistent session store for express-session
export const sessionsTable = platform.table("sessions", {
  sid: text("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire", { withTimezone: true, mode: "date" }).notNull(),
});

// Application-level session data shape (stored in sess JSON)
export interface SessionData {
  userId: string;
  activeOrgId?: string;
  oauthState?: string;
}

export const insertSessionSchema = createInsertSchema(sessionsTable);
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessionsTable.$inferSelect;
