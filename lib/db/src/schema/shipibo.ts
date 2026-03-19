import { text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { shipibo } from "./_schemas";

// Shipibo Dictionary - categories for organizing words
export const shipiboCategoriesTable = shipibo.table("shipibo_categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Shipibo Dictionary - word entries
export const shipiboWordsTable = shipibo.table("shipibo_words", {
  id: text("id").primaryKey(),
  word: text("word").notNull(), // Shipibo word
  translation: text("translation").notNull(), // Spanish/English translation
  definition: text("definition"),
  pronunciation: text("pronunciation"),
  partOfSpeech: text("part_of_speech"), // noun, verb, adjective, etc.
  categoryId: text("category_id"),
  examples: text("examples").array().notNull().default([]),
  status: text("status").notNull().default("draft"), // draft | published | review
  contributorUserId: text("contributor_user_id"),
  reviewedByUserId: text("reviewed_by_user_id"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertShipiboCategorySchema = createInsertSchema(shipiboCategoriesTable).omit({ createdAt: true });
export const insertShipiboWordSchema = createInsertSchema(shipiboWordsTable).omit({ createdAt: true, updatedAt: true });
export type InsertShipiboCategory = z.infer<typeof insertShipiboCategorySchema>;
export type InsertShipiboWord = z.infer<typeof insertShipiboWordSchema>;
export type ShipiboCategory = typeof shipiboCategoriesTable.$inferSelect;
export type ShipiboWord = typeof shipiboWordsTable.$inferSelect;
