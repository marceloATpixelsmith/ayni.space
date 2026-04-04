import { text, timestamp, pgEnum, uniqueIndex, index, integer, boolean } from "drizzle-orm/pg-core";
import { platform } from "./_schemas";

export const credentialTypeEnum = pgEnum("credential_type", ["password"]);
export const authTokenTypeEnum = pgEnum("auth_token_type", ["email_verification", "password_reset"]);
export const mfaFactorTypeEnum = pgEnum("mfa_factor_type", ["totp"]);
export const mfaFactorStatusEnum = pgEnum("mfa_factor_status", ["pending", "active", "disabled"]);
export const authRiskReasonEnum = pgEnum("auth_risk_reason", [
  "ipqs_step_up",
  "ipqs_failure_step_up",
  "privileged_role",
  "org_client_registration",
  "new_device",
  "post_password_reset",
  "suspicious_context",
]);

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

export const sessionGroupsTable = platform.table(
  "session_groups",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("session_groups_display_name_unique").on(t.displayName)],
);

export const mfaFactorsTable = platform.table(
  "mfa_factors",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    factorType: mfaFactorTypeEnum("factor_type").notNull().default("totp"),
    status: mfaFactorStatusEnum("status").notNull().default("pending"),
    secretCiphertext: text("secret_ciphertext").notNull(),
    secretIv: text("secret_iv").notNull(),
    secretTag: text("secret_tag").notNull(),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("mfa_factors_user_active_totp_unique").on(t.userId, t.factorType),
    index("mfa_factors_user_idx").on(t.userId),
  ],
);

export const mfaRecoveryCodesTable = platform.table(
  "mfa_recovery_codes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    factorId: text("factor_id").notNull(),
    codeHash: text("code_hash").notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("mfa_recovery_codes_hash_unique").on(t.codeHash),
    index("mfa_recovery_codes_user_idx").on(t.userId),
    index("mfa_recovery_codes_factor_idx").on(t.factorId),
  ],
);

export const trustedDevicesTable = platform.table(
  "trusted_devices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokeReason: text("revoke_reason"),
  },
  (t) => [
    uniqueIndex("trusted_devices_token_hash_unique").on(t.tokenHash),
    index("trusted_devices_user_idx").on(t.userId),
    index("trusted_devices_expires_idx").on(t.expiresAt),
  ],
);

export const userAuthSecurityTable = platform.table(
  "user_auth_security",
  {
    userId: text("user_id").primaryKey(),
    mfaRequired: boolean("mfa_required").notNull().default(false),
    forceMfaEnrollment: boolean("force_mfa_enrollment").notNull().default(false),
    lastPasswordResetAt: timestamp("last_password_reset_at", { withTimezone: true }),
    firstAuthAfterResetPending: boolean("first_auth_after_reset_pending").notNull().default(false),
    highRiskUntilMfaAt: timestamp("high_risk_until_mfa_at", { withTimezone: true }),
    riskReason: authRiskReasonEnum("risk_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index("user_auth_security_mfa_required_idx").on(t.mfaRequired)],
);

export const usedMfaTotpCodesTable = platform.table(
  "used_mfa_totp_codes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    factorId: text("factor_id").notNull(),
    timeStep: integer("time_step").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("used_mfa_totp_codes_factor_step_unique").on(t.factorId, t.timeStep),
    index("used_mfa_totp_codes_user_idx").on(t.userId),
  ],
);
