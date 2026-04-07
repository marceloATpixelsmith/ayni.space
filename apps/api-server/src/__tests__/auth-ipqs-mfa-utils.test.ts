import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { ensureTestDatabaseEnv, patchProperty } from "./helpers.js";

ensureTestDatabaseEnv();

const ipqs = await import("../lib/ipqs.js");
const mfa = await import("../lib/mfa.js");
const sessionGroupCompatibility = await import("../lib/sessionGroupCompatibility.js");
const { db } = await import("@workspace/db");

test("IPQS provider failures fail-soft to step_up", async () => {
  const restore = patchProperty(globalThis, "fetch", (async () => {
    throw new Error("network down");
  }) as typeof fetch);

  try {
    process.env["IPQS_API_KEY"] = "test-key";
    const result = await ipqs.assessSignupRiskWithIpqs("user@example.com", "127.0.0.1");
    assert.equal(result.decision, "step_up");
    assert.equal(result.reason, "ipqs_failure");
  } finally {
    restore();
  }
});

test("IPQS disposable email is blocked", async () => {
  const restore = patchProperty(globalThis, "fetch", (async () => new Response(JSON.stringify({ disposable: true, valid: true, fraud_score: 10 }), { status: 200 })) as typeof fetch);

  try {
    process.env["IPQS_API_KEY"] = "test-key";
    const result = await ipqs.assessSignupRiskWithIpqs("user@example.com", "127.0.0.1");
    assert.equal(result.decision, "block");
    assert.equal(result.reason, "disposable_email");
  } finally {
    restore();
  }
});

test("IPQS high fraud score is advisory step_up and not block", async () => {
  const restore = patchProperty(globalThis, "fetch", (async () => new Response(JSON.stringify({ disposable: false, valid: true, fraud_score: 99 }), { status: 200 })) as typeof fetch);

  try {
    process.env["IPQS_API_KEY"] = "test-key";
    const result = await ipqs.assessSignupRiskWithIpqs("user@example.com", "127.0.0.1");
    assert.equal(result.decision, "step_up");
    assert.equal(result.reason, "score");
  } finally {
    restore();
  }
});

test("IPQS undeliverable signal is advisory step_up and not block", async () => {
  const restore = patchProperty(globalThis, "fetch", (async () => new Response(JSON.stringify({ disposable: false, valid: false, fraud_score: 10, smtp_score: 0.1 }), { status: 200 })) as typeof fetch);

  try {
    process.env["IPQS_API_KEY"] = "test-key";
    const result = await ipqs.assessSignupRiskWithIpqs("user@example.com", "127.0.0.1");
    assert.equal(result.decision, "step_up");
    assert.equal(result.reason, "undeliverable_email");
  } finally {
    restore();
  }
});

test("MFA trusted-device cookie policy uses 20 day max-age", () => {
  const options = mfa.getTrustedDeviceCookieOptions();
  assert.equal(options.maxAge, 20 * 24 * 60 * 60 * 1000);
});

test("MFA requirement applies to org owner/admin even when no activeOrgId is set", async () => {
  const restore = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-1",
      isSuperAdmin: false,
    })),
    patchProperty(db.query.userAuthSecurityTable, "findFirst", async () => null),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => ({
      id: "membership-1",
      userId: "user-1",
      role: "org_owner",
      membershipStatus: "active",
    })),
  ];

  try {
    const required = await mfa.isMfaRequiredForUser("user-1", null);
    assert.equal(required, true);
  } finally {
    restore.reverse().forEach((undo) => undo());
  }
});

test("apps with unknown metadata sessionGroup fail closed to default group", () => {
  const resolved = sessionGroupCompatibility.resolveSessionGroupForApp({
    slug: "ayni",
    metadata: { sessionGroup: "nonexistent-group" },
  } as never);
  assert.equal(resolved, "default");
});


test("MFA enrollment start refuses unknown users before factor insert", async () => {
  const previousKey = process.env["MFA_TOTP_ENCRYPTION_KEY"];
  process.env["MFA_TOTP_ENCRYPTION_KEY"] = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  const restoreTx = patchProperty(db, "transaction", (async (fn: (tx: unknown) => Promise<unknown>) => fn({
    execute: async () => ({ rows: [] }),
    query: { mfaFactorsTable: { findFirst: async () => null } },
    update: () => ({ set: () => ({ where: async () => [] }) }),
    insert: () => ({ values: async () => [] }),
  })) as typeof db.transaction);
  const restore = [
    patchProperty(db.query.usersTable, "findFirst", async () => null),
  ];

  try {
    const started = await mfa.beginTotpEnrollment("missing-user");
    assert.equal(started, null);
  } finally {
    if (previousKey === undefined) delete process.env["MFA_TOTP_ENCRYPTION_KEY"];
    else process.env["MFA_TOTP_ENCRYPTION_KEY"] = previousKey;
    restoreTx();
    restore.reverse().forEach((undo) => undo());
  }
});

test("MFA enrollment start returns factor id and secret for valid users", async () => {
  const previousKey = process.env["MFA_TOTP_ENCRYPTION_KEY"];
  process.env["MFA_TOTP_ENCRYPTION_KEY"] = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  const restoreTx = patchProperty(db, "transaction", (async (fn: (tx: unknown) => Promise<unknown>) => fn({
    execute: async () => ({ rows: [{ id: "user-1" }] }),
    query: { mfaFactorsTable: { findFirst: async () => null } },
    update: () => ({ set: () => ({ where: async () => [] }) }),
    insert: () => ({ values: async () => [] }),
  })) as typeof db.transaction);
  const restore = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({ id: "user-1", email: "user@example.com" })),
    patchProperty(db.query.mfaFactorsTable, "findFirst", async () => null),
  ];

  try {
    const started = await mfa.beginTotpEnrollment("user-1");
    assert.equal(Boolean(started?.factorId), true);
    assert.equal(Boolean(started?.secret), true);
  } finally {
    if (previousKey === undefined) delete process.env["MFA_TOTP_ENCRYPTION_KEY"];
    else process.env["MFA_TOTP_ENCRYPTION_KEY"] = previousKey;
    restoreTx();
    restore.reverse().forEach((undo) => undo());
  }
});

function generateTotpCodeFromBase32Secret(secret: string, timeStep: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const char of normalized) {
    const index = alphabet.indexOf(char);
    if (index < 0) continue;
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  const key = Buffer.from(bytes);

  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(timeStep));

  const hmac = crypto.createHmac("sha1", key).update(counter).digest();
  const dynamicOffset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[dynamicOffset]! & 0x7f) << 24) |
    ((hmac[dynamicOffset + 1]! & 0xff) << 16) |
    ((hmac[dynamicOffset + 2]! & 0xff) << 8) |
    (hmac[dynamicOffset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

test("MFA challenge accepts valid RFC6238-style TOTP from stored base32 secret", async () => {
  const secret = "JBSWY3DPEHPK3PXP";
  const nowMs = Date.UTC(2026, 3, 5, 12, 0, 0);
  const step = Math.floor(nowMs / 30_000);
  const validCode = generateTotpCodeFromBase32Secret(secret, step);

  const previousKey = process.env["MFA_TOTP_ENCRYPTION_KEY"];
  process.env["MFA_TOTP_ENCRYPTION_KEY"] = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(process.env["MFA_TOTP_ENCRYPTION_KEY"], "hex"), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const restore = [
    patchProperty(db.query.mfaFactorsTable, "findFirst", async () => ({
      id: "factor-1",
      userId: "user-1",
      factorType: "totp",
      status: "active",
      secretCiphertext: ciphertext.toString("base64"),
      secretIv: iv.toString("base64"),
      secretTag: tag.toString("base64"),
    })),
    patchProperty(db.query.usedMfaTotpCodesTable, "findFirst", async () => null),
    patchProperty(db, "insert", ((_table: unknown) => ({
      values: async () => {
        return [];
      },
    })) as unknown as typeof db.insert),
    patchProperty(db, "update", (() => ({
      set: () => ({
        where: async () => [],
      }),
    })) as unknown as typeof db.update),
    patchProperty(Date, "now", () => nowMs),
  ];

  try {
    const ok = await mfa.verifyMfaChallenge("user-1", validCode);
    assert.equal(ok, true);
  } finally {
    if (previousKey === undefined) delete process.env["MFA_TOTP_ENCRYPTION_KEY"];
    else process.env["MFA_TOTP_ENCRYPTION_KEY"] = previousKey;
    restore.reverse().forEach((undo) => undo());
  }
});

test("MFA challenge does not accept pending factor rows", async () => {
  const previousKey = process.env["MFA_TOTP_ENCRYPTION_KEY"];
  process.env["MFA_TOTP_ENCRYPTION_KEY"] = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(process.env["MFA_TOTP_ENCRYPTION_KEY"], "hex"), iv);
  const ciphertext = Buffer.concat([cipher.update("JBSWY3DPEHPK3PXP", "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const restore = [
    patchProperty(db.query.mfaFactorsTable, "findFirst", async () => ({
      id: "factor-legacy",
      userId: "user-legacy",
      factorType: "totp",
      status: "pending",
      secretCiphertext: ciphertext.toString("base64"),
      secretIv: iv.toString("base64"),
      secretTag: tag.toString("base64"),
      enrolledAt: new Date("2026-04-01T00:00:00.000Z"),
    })),
  ];

  try {
    const ok = await mfa.verifyMfaChallenge("user-legacy", "123456");
    assert.equal(ok, false);
  } finally {
    if (previousKey === undefined) delete process.env["MFA_TOTP_ENCRYPTION_KEY"];
    else process.env["MFA_TOTP_ENCRYPTION_KEY"] = previousKey;
    restore.reverse().forEach((undo) => undo());
  }
});
