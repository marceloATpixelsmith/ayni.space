import { text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { platform } from "./_schemas";
import { appsTable } from "./apps";

export const settingValueTypeEnumValues = ["string", "number", "boolean", "json"] as const;

export const settingsTable = platform.table(
  "settings",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    valueType: text("value_type").notNull().$type<(typeof settingValueTypeEnumValues)[number]>(),
    description: text("description"),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("settings_key_unique").on(t.key)],
);

export const appSettingsTable = platform.table(
  "app_settings",
  {
    id: text("id").primaryKey(),
    appId: text("app_id").notNull().references(() => appsTable.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    valueType: text("value_type").notNull().$type<(typeof settingValueTypeEnumValues)[number]>(),
    description: text("description"),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("app_settings_app_key_unique").on(t.appId, t.key)],
);

export type SettingValueType = (typeof settingValueTypeEnumValues)[number];
export type PlatformSetting = typeof settingsTable.$inferSelect;
export type AppSetting = typeof appSettingsTable.$inferSelect;
