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
    })) as typeof db.update),
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
