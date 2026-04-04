import { text, timestamp, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { platform } from "./_schemas";

export const credentialTypeEnum = pgEnum("credential_type", ["password"]);
export const authTokenTypeEnum = pgEnum("auth_token_type", ["email_verification", "password_reset"]);

export const userCredentialsTable = platform.table(
  "user_credentials",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    credentialType: credentialTypeEnum("credential_type").notNull().default("password"),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("user_credentials_user_type_unique").on(t.userId, t.credentialType),
    index("user_credentials_user_idx").on(t.userId),
  ],
);

export const authTokensTable = platform.table(
  "auth_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    tokenType: authTokenTypeEnum("token_type").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("auth_tokens_hash_unique").on(t.tokenHash),
    index("auth_tokens_user_type_idx").on(t.userId, t.tokenType),
    index("auth_tokens_expires_idx").on(t.expiresAt),
  ],
);
