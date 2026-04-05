import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { createMountedSessionApp, ensureTestDatabaseEnv, patchProperty, performJsonRequest } from "./helpers.js";

ensureTestDatabaseEnv();

const { db } = await import("@workspace/db");
const { default: authRouter } = await import("../routes/auth.js");

const scryptAsync = promisify(crypto.scrypt);

async function hashLegacyScrypt(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

test("legacy scrypt login transparently upgrades stored hash to current versioned format", async () => {
  const legacyHash = await hashLegacyScrypt("StrongPassword123!");
  let upgradedHash: string | null = null;

  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-1",
      email: "user@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
      emailVerifiedAt: new Date(),
    })),
    patchProperty(db.query.userCredentialsTable, "findFirst", async () => ({
      id: "cred-1",
      userId: "user-1",
      credentialType: "password",
      passwordHash: legacyHash,
    })),
    patchProperty(db, "update", (() => ({
      set: (values: Record<string, unknown>) => {
        if (typeof values["passwordHash"] === "string") {
          upgradedHash = values["passwordHash"] as string;
        }
        return {
          where: async () => undefined,
        };
      },
    })) as unknown as typeof db.update),
  ];

  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {});
    const response = await performJsonRequest(app, "POST", "/api/auth/login", {
      email: "user@example.com",
      password: "StrongPassword123!",
    });

    assert.equal(response.status, 200);
    assert.equal(typeof upgradedHash, "string");
    assert.equal((upgradedHash ?? "").startsWith("scrypt-v2$"), true);
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("login returns mfa_challenge for users with active MFA factor", async () => {
  const legacyHash = await hashLegacyScrypt("StrongPassword123!");

  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-1",
      email: "user@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
      emailVerifiedAt: new Date(),
      isSuperAdmin: false,
    })),
    patchProperty(db.query.userCredentialsTable, "findFirst", async () => ({
      id: "cred-1",
      userId: "user-1",
      credentialType: "password",
      passwordHash: legacyHash,
    })),
    patchProperty(db.query.userAuthSecurityTable, "findFirst", async () => ({
      userId: "user-1",
      mfaRequired: true,
      forceMfaEnrollment: false,
      firstAuthAfterResetPending: false,
      highRiskUntilMfaAt: null,
    })),
    patchProperty(db.query.mfaFactorsTable, "findFirst", async () => ({
      id: "factor-1",
      userId: "user-1",
      factorType: "totp",
      status: "active",
      secretCiphertext: "cipher",
      secretIv: "iv",
      secretTag: "tag",
    })),
    patchProperty(db, "update", (() => ({
      set: () => ({
        where: async () => undefined,
      }),
    })) as unknown as typeof db.update),
  ];

  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {});
    const response = await performJsonRequest(app, "POST", "/api/auth/login", {
      email: "user@example.com",
      password: "StrongPassword123!",
    });

    assert.equal(response.status, 202);
    assert.equal(response.body?.mfaRequired, true);
    assert.equal(response.body?.needsEnrollment, false);
    assert.equal(response.body?.nextStep, "mfa_challenge");
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("login fails closed to mfa_challenge when active factor lookup errors", async () => {
  const legacyHash = await hashLegacyScrypt("StrongPassword123!");

  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-1",
      email: "user@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
      emailVerifiedAt: new Date(),
      isSuperAdmin: false,
    })),
    patchProperty(db.query.userCredentialsTable, "findFirst", async () => ({
      id: "cred-1",
      userId: "user-1",
      credentialType: "password",
      passwordHash: legacyHash,
    })),
    patchProperty(db.query.userAuthSecurityTable, "findFirst", async () => ({
      userId: "user-1",
      mfaRequired: true,
      forceMfaEnrollment: false,
      firstAuthAfterResetPending: false,
      highRiskUntilMfaAt: null,
    })),
    patchProperty(db.query.mfaFactorsTable, "findFirst", async () => {
      throw new Error("temporary mfa factor read failure");
    }),
    patchProperty(db, "update", (() => ({
      set: () => ({
        where: async () => undefined,
      }),
    })) as unknown as typeof db.update),
  ];

  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {});
    const response = await performJsonRequest(app, "POST", "/api/auth/login", {
      email: "user@example.com",
      password: "StrongPassword123!",
    });

    assert.equal(response.status, 202);
    assert.equal(response.body?.mfaRequired, true);
    assert.equal(response.body?.needsEnrollment, false);
    assert.equal(response.body?.nextStep, "mfa_challenge");
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("mfa enroll start returns mfa_challenge hint when pending session already has an active factor", async () => {
  const restores = [
    patchProperty(db.query.mfaFactorsTable, "findFirst", async () => ({
      id: "factor-1",
      userId: "user-1",
      factorType: "totp",
      status: "active",
      secretCiphertext: "cipher",
      secretIv: "iv",
      secretTag: "tag",
    })),
  ];

  try {
    const app = createMountedSessionApp(
      [{ path: "/api/auth", router: authRouter }],
      {
        pendingUserId: "user-1",
        pendingAppSlug: "admin",
        pendingMfaReason: "challenge_required",
      },
    );
    const response = await performJsonRequest(app, "POST", "/api/auth/mfa/enroll/start", {});

    assert.equal(response.status, 409);
    assert.equal(response.body?.mfaRequired, true);
    assert.equal(response.body?.needsEnrollment, false);
    assert.equal(response.body?.nextStep, "mfa_challenge");
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});
