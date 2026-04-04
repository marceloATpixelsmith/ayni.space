import test from "node:test";
import assert from "node:assert/strict";
import { ensureTestDatabaseEnv, patchProperty } from "./helpers.js";

ensureTestDatabaseEnv();

const ipqs = await import("../lib/ipqs.js");
const mfa = await import("../lib/mfa.js");

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

test("MFA trusted-device cookie policy uses 20 day max-age", () => {
  const options = mfa.getTrustedDeviceCookieOptions();
  assert.equal(options.maxAge, 20 * 24 * 60 * 60 * 1000);
});
