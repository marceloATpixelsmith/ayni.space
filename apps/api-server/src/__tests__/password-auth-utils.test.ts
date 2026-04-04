import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { hashPassword, verifyPassword, generateOpaqueToken, getPasswordAuthOpaqueIdentifier, hashOpaqueToken } from "../lib/passwordAuth.js";

const scryptAsync = promisify(crypto.scrypt);

async function hashLegacyScrypt(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

test("current versioned password hash and verify", async () => {
  const hash = await hashPassword("StrongPassword123!");
  assert.equal(hash.startsWith("scrypt-v2$"), true);

  const valid = await verifyPassword(hash, "StrongPassword123!");
  assert.equal(valid.ok, true);
  assert.equal(valid.needsRehash, false);

  const invalid = await verifyPassword(hash, "wrong");
  assert.equal(invalid.ok, false);
  assert.equal(invalid.needsRehash, false);
});

test("legacy scrypt password hashes still verify and require upgrade", async () => {
  const legacy = await hashLegacyScrypt("StrongPassword123!");
  const verified = await verifyPassword(legacy, "StrongPassword123!");

  assert.equal(verified.ok, true);
  assert.equal(verified.needsRehash, true);
  assert.equal(typeof verified.upgradedHash, "string");
  assert.equal(verified.upgradedHash?.startsWith("scrypt-v2$"), true);

  const bad = await verifyPassword(legacy, "bad-password");
  assert.equal(bad.ok, false);
  assert.equal(bad.needsRehash, false);
});

test("opaque token hashing is deterministic", () => {
  const token = generateOpaqueToken();
  assert.equal(hashOpaqueToken(token), hashOpaqueToken(token));
});

test("password auth opaque identifier is deterministic and normalized", () => {
  const a = getPasswordAuthOpaqueIdentifier("USER@Example.com");
  const b = getPasswordAuthOpaqueIdentifier("user@example.com");
  assert.equal(a, b);
  assert.equal(typeof a, "string");
});
