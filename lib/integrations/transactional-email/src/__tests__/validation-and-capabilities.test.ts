import test from "node:test";
import assert from "node:assert/strict";
import { validateLane2Request, EmailValidationError } from "../validation";
import { PROVIDER_CAPABILITIES } from "../capabilities";

const baseRequest = {
  orgId: "org_1",
  appId: "ayni",
  correlationId: "corr_1",
  fromEmail: "noreply@example.com",
  to: [{ email: "customer@example.com" }],
  subject: "hello",
  textBody: "body",
};

test("validateLane2Request accepts valid request", () => {
  assert.doesNotThrow(() => validateLane2Request("brevo", baseRequest));
});

test("validateLane2Request rejects empty recipients", () => {
  assert.throws(
    () => validateLane2Request("brevo", { ...baseRequest, to: [] }),
    (error) => error instanceof EmailValidationError && error.code === "missing_recipient"
  );
});

test("validateLane2Request enforces provider capability failures", () => {
  const original = PROVIDER_CAPABILITIES.brevo.supportsCcBcc;
  PROVIDER_CAPABILITIES.brevo.supportsCcBcc = false;
  try {
    assert.throws(
      () => validateLane2Request("brevo", { ...baseRequest, cc: [{ email: "cc@example.com" }] }),
      (error) => error instanceof EmailValidationError && error.code === "unsupported_cc_bcc"
    );
  } finally {
    PROVIDER_CAPABILITIES.brevo.supportsCcBcc = original;
  }
});
