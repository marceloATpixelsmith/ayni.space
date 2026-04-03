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

test("validateLane2Request rejects metadata for brevo", () => {
  assert.throws(
    () => validateLane2Request("brevo", { ...baseRequest, metadata: { key: "value" } }),
    (error) => error instanceof EmailValidationError && error.code === "unsupported_metadata"
  );
});

test("validateLane2Request accepts brevo numeric templateRef", () => {
  assert.doesNotThrow(() => validateLane2Request("brevo", { ...baseRequest, subject: undefined, textBody: undefined, templateRef: 42 }));
});

test("validateLane2Request rejects brevo string templateRef", () => {
  assert.throws(
    () => validateLane2Request("brevo", { ...baseRequest, subject: undefined, textBody: undefined, templateRef: "42" }),
    (error) => error instanceof EmailValidationError && error.code === "invalid_template_ref"
  );
});

test("validateLane2Request rejects brevo NaN templateRef", () => {
  assert.throws(
    () => validateLane2Request("brevo", { ...baseRequest, subject: undefined, textBody: undefined, templateRef: Number.NaN }),
    (error) => error instanceof EmailValidationError && error.code === "invalid_template_ref"
  );
});

test("validateLane2Request rejects invalid attachments shape", () => {
  assert.throws(
    () =>
      validateLane2Request("brevo", {
        ...baseRequest,
        attachments: [{ filename: "a.txt", contentBase64: "abc", inline: true }],
      }),
    (error) => error instanceof EmailValidationError && error.code === "invalid_inline_attachment"
  );
});

test("validateLane2Request rejects invalid template params shape", () => {
  assert.throws(
    () => validateLane2Request("brevo", { ...baseRequest, templateParams: [] as unknown as Record<string, unknown> }),
    (error) => error instanceof EmailValidationError && error.code === "invalid_template_params_shape"
  );
});
