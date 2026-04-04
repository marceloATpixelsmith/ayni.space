import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, generateOpaqueToken, hashOpaqueToken } from "../lib/passwordAuth.js";

test("password hash and verify", async () => {
  const hash = await hashPassword("StrongPassword123!");
  assert.equal(await verifyPassword(hash, "StrongPassword123!"), true);
  assert.equal(await verifyPassword(hash, "wrong"), false);
});

test("opaque token hashing is deterministic", () => {
  const token = generateOpaqueToken();
  assert.equal(hashOpaqueToken(token), hashOpaqueToken(token));
});
