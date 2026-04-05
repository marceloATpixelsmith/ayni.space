import crypto, { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import {
  db,
  mfaFactorsTable,
  mfaRecoveryCodesTable,
  trustedDevicesTable,
  usedMfaTotpCodesTable,
  userAuthSecurityTable,
  orgMembershipsTable,
  usersTable,
} from "@workspace/db";
import { hashOpaqueToken } from "./passwordAuth.js";

const TRUSTED_DEVICE_COOKIE_NAME = "ayni_trusted_device";
const TRUSTED_DEVICE_TTL_MS = 20 * 24 * 60 * 60 * 1000;
const TOTP_ALLOWED_WINDOW_STEPS = 2;
const POSTGRES_FOREIGN_KEY_VIOLATION = "23503";

function normalizeTotpCode(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

function getEncryptionKey(): Buffer {
  const raw = process.env["MFA_TOTP_ENCRYPTION_KEY"] ?? "";
  if (!/^[a-fA-F0-9]{64}$/.test(raw)) throw new Error("MFA_TOTP_ENCRYPTION_KEY must be 64 hex chars");
  return Buffer.from(raw, "hex");
}

function base32Encode(buffer: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let acc = 0;
  const out: number[] = [];
  for (const c of value.replace(/=+$/g, "").toUpperCase()) {
    const idx = alphabet.indexOf(c);
    if (idx < 0) continue;
    acc = (acc << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((acc >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function encryptSecret(secret: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: tag.toString("base64") };
}

function decryptSecret(ciphertext: string, iv: string, tag: string): string {
  const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]);
  return plain.toString("utf8");
}

function generateTotp(secret: string, timeStep: number): string {
  const key = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(timeStep));
  const digest = crypto.createHmac("sha1", key).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code = ((digest[offset]! & 0x7f) << 24) | ((digest[offset + 1]! & 0xff) << 16) | ((digest[offset + 2]! & 0xff) << 8) | (digest[offset + 3]! & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

export function getTrustedDeviceCookieName() {
  return TRUSTED_DEVICE_COOKIE_NAME;
}

export function getTrustedDeviceCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: process.env["NODE_ENV"] === "production" ? "none" as const : "lax" as const,
    path: "/",
    maxAge: TRUSTED_DEVICE_TTL_MS,
  };
}

export function buildTotpOtpauthUrl({ issuer, accountName, secret }: { issuer: string; accountName: string; secret: string }) {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export async function beginTotpEnrollment(userId: string) {
  const secret = base32Encode(crypto.randomBytes(20));
  const encrypted = encryptSecret(secret);
  const insertedFactorId = randomUUID();
  try {
    return await db.transaction(async (tx) => {
      const lockedUser = await tx.execute<{ id: string }>(
        sql`select id from platform.users where id = ${userId} for update`,
      );
      if (lockedUser.rows.length === 0) {
        return null;
      }

      const upserted = await tx
        .insert(mfaFactorsTable)
        .values({
          id: insertedFactorId,
          userId,
          factorType: "totp",
          status: "pending",
          secretCiphertext: encrypted.ciphertext,
          secretIv: encrypted.iv,
          secretTag: encrypted.tag,
        })
        .onConflictDoUpdate({
          target: [mfaFactorsTable.userId, mfaFactorsTable.factorType],
          set: {
            status: "pending",
            secretCiphertext: encrypted.ciphertext,
            secretIv: encrypted.iv,
            secretTag: encrypted.tag,
            updatedAt: new Date(),
          },
        })
        .returning({ id: mfaFactorsTable.id });

      const factorId = upserted[0]?.id ?? insertedFactorId;
      return { factorId, secret };
    });
  } catch (error) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "cause" in error &&
      typeof (error as { cause?: unknown }).cause === "object" &&
      (error as { cause?: { code?: string } }).cause?.code
        ? (error as { cause?: { code?: string } }).cause?.code
        : undefined;
    if (code === POSTGRES_FOREIGN_KEY_VIOLATION) {
      return null;
    }
    throw error;
  }
}

function generateRecoveryCodes() {
  return Array.from({ length: 8 }, () => crypto.randomBytes(5).toString("hex").toUpperCase());
}

export async function activateTotpEnrollment(userId: string, factorId: string, code: string) {
  const factor = await db.query.mfaFactorsTable.findFirst({ where: and(eq(mfaFactorsTable.id, factorId), eq(mfaFactorsTable.userId, userId)) });
  if (!factor) return null;
  const secret = decryptSecret(factor.secretCiphertext, factor.secretIv, factor.secretTag);
  const ok = await verifyTotpCode(userId, factor.id, secret, normalizeTotpCode(code));
  if (!ok) return null;

  await db.update(mfaFactorsTable).set({ status: "active", enrolledAt: new Date(), lastUsedAt: new Date() }).where(eq(mfaFactorsTable.id, factor.id));
  await db.delete(mfaRecoveryCodesTable).where(eq(mfaRecoveryCodesTable.userId, userId));
  const recoveryCodes = generateRecoveryCodes();
  await db.insert(mfaRecoveryCodesTable).values(recoveryCodes.map((value) => ({ id: randomUUID(), userId, factorId: factor.id, codeHash: hashOpaqueToken(`mfa-recovery:${value}`) })));
  await db.insert(userAuthSecurityTable).values({ userId, mfaRequired: true, forceMfaEnrollment: false }).onConflictDoUpdate({ target: userAuthSecurityTable.userId, set: { mfaRequired: true, forceMfaEnrollment: false, highRiskUntilMfaAt: null, riskReason: null, updatedAt: new Date() } });
  await revokeTrustedDevicesForUser(userId, "mfa_changed");
  return { recoveryCodes };
}

async function verifyTotpCode(userId: string, factorId: string, secret: string, code: string): Promise<boolean> {
  const nowStep = Math.floor(Date.now() / 30_000);
  for (let offset = -TOTP_ALLOWED_WINDOW_STEPS; offset <= TOTP_ALLOWED_WINDOW_STEPS; offset += 1) {
    const step = nowStep + offset;
    if (generateTotp(secret, step) !== code) continue;
    const existing = await db.query.usedMfaTotpCodesTable.findFirst({ where: and(eq(usedMfaTotpCodesTable.factorId, factorId), eq(usedMfaTotpCodesTable.timeStep, step)) });
    if (existing) return false;
    await db.insert(usedMfaTotpCodesTable).values({ id: randomUUID(), userId, factorId, timeStep: step });
    return true;
  }
  return false;
}

export async function hasActiveMfaFactor(userId: string): Promise<boolean> {
  try {
    const row = await db.query.mfaFactorsTable.findFirst({ where: and(eq(mfaFactorsTable.userId, userId), eq(mfaFactorsTable.status, "active"), eq(mfaFactorsTable.factorType, "totp")) });
    return Boolean(row);
  } catch {
    return false;
  }
}

export async function verifyMfaChallenge(userId: string, code: string): Promise<boolean> {
  const factor = await db.query.mfaFactorsTable.findFirst({ where: and(eq(mfaFactorsTable.userId, userId), eq(mfaFactorsTable.status, "active"), eq(mfaFactorsTable.factorType, "totp")) });
  if (!factor) return false;
  const normalizedTotp = normalizeTotpCode(code);
  if (/^[0-9]{6}$/.test(normalizedTotp)) {
    const secret = decryptSecret(factor.secretCiphertext, factor.secretIv, factor.secretTag);
    const ok = await verifyTotpCode(userId, factor.id, secret, normalizedTotp);
    if (ok) {
      await db.update(mfaFactorsTable).set({ lastUsedAt: new Date() }).where(eq(mfaFactorsTable.id, factor.id));
      return true;
    }
  }

  const recoveryNormalized = code.trim().toUpperCase();
  const recoveryHash = hashOpaqueToken(`mfa-recovery:${recoveryNormalized}`);
  const recovery = await db.query.mfaRecoveryCodesTable.findFirst({ where: and(eq(mfaRecoveryCodesTable.userId, userId), eq(mfaRecoveryCodesTable.codeHash, recoveryHash), isNull(mfaRecoveryCodesTable.consumedAt)) });
  if (!recovery) return false;
  await db.update(mfaRecoveryCodesTable).set({ consumedAt: new Date() }).where(eq(mfaRecoveryCodesTable.id, recovery.id));
  return true;
}

export async function rememberTrustedDevice(userId: string) {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashOpaqueToken(`trusted-device:${rawToken}`);
  const now = new Date();
  await db.insert(trustedDevicesTable).values({
    id: randomUUID(),
    userId,
    tokenHash,
    createdAt: now,
    expiresAt: new Date(now.getTime() + TRUSTED_DEVICE_TTL_MS),
    lastSeenAt: now,
  });
  return rawToken;
}

export async function isTrustedDevice(userId: string, rawToken: string | null | undefined): Promise<boolean> {
  if (!rawToken) return false;
  const tokenHash = hashOpaqueToken(`trusted-device:${rawToken}`);
  const now = new Date();
  let row = null;
  try {
    row = await db.query.trustedDevicesTable.findFirst({ where: and(eq(trustedDevicesTable.userId, userId), eq(trustedDevicesTable.tokenHash, tokenHash), isNull(trustedDevicesTable.revokedAt), gt(trustedDevicesTable.expiresAt, now)) });
  } catch {
    return false;
  }
  if (!row) return false;
  await db.update(trustedDevicesTable).set({ lastSeenAt: now }).where(eq(trustedDevicesTable.id, row.id));
  return true;
}

export async function revokeTrustedDevicesForUser(userId: string, reason: string) {
  await db.update(trustedDevicesTable).set({ revokedAt: new Date(), revokeReason: reason }).where(and(eq(trustedDevicesTable.userId, userId), isNull(trustedDevicesTable.revokedAt)));
}

export async function getUserAuthSecurity(userId: string) {
  try {
    return await db.query.userAuthSecurityTable.findFirst({ where: eq(userAuthSecurityTable.userId, userId) });
  } catch {
    return null;
  }
}

export async function markUserHighRiskStepUp(userId: string, reason: "ipqs_step_up" | "ipqs_failure_step_up") {
  await db.insert(userAuthSecurityTable).values({
    userId,
    mfaRequired: true,
    forceMfaEnrollment: true,
    highRiskUntilMfaAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    riskReason: reason,
  }).onConflictDoUpdate({ target: userAuthSecurityTable.userId, set: { mfaRequired: true, forceMfaEnrollment: true, highRiskUntilMfaAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), riskReason: reason, updatedAt: new Date() } });
}

export async function markPasswordResetSecurityEvent(userId: string) {
  await db.insert(userAuthSecurityTable).values({ userId, mfaRequired: true, firstAuthAfterResetPending: true, lastPasswordResetAt: new Date(), forceMfaEnrollment: true, riskReason: "post_password_reset" }).onConflictDoUpdate({ target: userAuthSecurityTable.userId, set: { firstAuthAfterResetPending: true, lastPasswordResetAt: new Date(), forceMfaEnrollment: true, riskReason: "post_password_reset", updatedAt: new Date() } });
  await revokeTrustedDevicesForUser(userId, "password_reset");
}

export async function isMfaRequiredForUser(userId: string, _activeOrgId?: string | null): Promise<boolean> {
  const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
  if (!user) return false;
  if (user.isSuperAdmin) return true;

  const security = await getUserAuthSecurity(userId);
  if (security?.mfaRequired || security?.forceMfaEnrollment) return true;

  try {
    const orgRole = await db.query.orgMembershipsTable.findFirst({
      where: and(
        eq(orgMembershipsTable.userId, userId),
        eq(orgMembershipsTable.membershipStatus, "active"),
        sql`${orgMembershipsTable.role} in ('org_owner','org_admin')`,
      ),
    });
    if (orgRole) return true;
  } catch {
    // fail open for role read outages
  }

  return false;
}

export async function clearFirstAuthAfterReset(userId: string) {
  await db.update(userAuthSecurityTable).set({ firstAuthAfterResetPending: false, updatedAt: new Date() }).where(eq(userAuthSecurityTable.userId, userId));
}
