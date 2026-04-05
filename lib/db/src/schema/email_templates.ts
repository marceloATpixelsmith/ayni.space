import { boolean, index, pgEnum, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { platform } from "./_schemas";

export const emailTemplateTypeEnum = pgEnum("email_template_type", ["invitation", "email_verification", "password_reset"]);

export const emailTemplatesTable = platform.table(
  "email_templates",
  {
    id: text("id").primaryKey(),
    appId: text("app_id"),
    templateType: emailTemplateTypeEnum("template_type").notNull(),
    subjectTemplate: text("subject_template").notNull(),
    htmlTemplate: text("html_template").notNull(),
    textTemplate: text("text_template"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("email_templates_app_type_unique").on(t.appId, t.templateType),
    index("email_templates_app_idx").on(t.appId),
    index("email_templates_template_type_idx").on(t.templateType),
  ],
);

export type EmailTemplate = typeof emailTemplatesTable.$inferSelect;
