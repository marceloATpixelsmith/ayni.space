import test from "node:test";
import assert from "node:assert/strict";

import { deriveTurnstileUiState } from "../turnstile";

test("turnstile reports retrying guidance after callback error", () => {
  const result = deriveTurnstileUiState({
    enabled: true,
    ready: true,
    widgetRenderAttempted: true,
    tokenPresent: false,
    hasError: true,
    expired: false,
    callbackError: true,
    retrying: true,
  });

  assert.equal(result.status, "error");
  assert.equal(result.guidanceMessage, "Verification failed. Please wait a few seconds while we retry.");
  assert.equal(result.canSubmit, false);
});

test("turnstile reports expired guidance and blocks submit until token exists", () => {
  const expired = deriveTurnstileUiState({
    enabled: true,
    ready: true,
    widgetRenderAttempted: true,
    tokenPresent: false,
    hasError: true,
    expired: true,
    callbackError: false,
    retrying: false,
  });
  assert.equal(expired.status, "expired");
  assert.equal(expired.guidanceMessage, "Security check expired. Please complete the new verification challenge.");
  assert.equal(expired.canSubmit, false);

  const recovered = deriveTurnstileUiState({
    enabled: true,
    ready: true,
    widgetRenderAttempted: true,
    tokenPresent: true,
    hasError: false,
    expired: false,
    callbackError: false,
    retrying: false,
  });
  assert.equal(recovered.status, "verified");
  assert.equal(recovered.guidanceMessage, null);
  assert.equal(recovered.canSubmit, true);
});

