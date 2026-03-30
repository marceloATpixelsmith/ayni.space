import test from "node:test";
import assert from "node:assert/strict";
import { mapGoogleSignInError } from "../index.tsx";

function makeResponse(status: number, retryAfter?: string): Response {
  const headers = new Headers();
  if (retryAfter) headers.set("retry-after", retryAfter);
  return new Response(null, { status, headers });
}

test("maps turnstile missing token to verification required", () => {
  const message = mapGoogleSignInError(makeResponse(403), {
    code: "TURNSTILE_MISSING_TOKEN",
    error: "Please complete the verification challenge.",
  });
  assert.equal(message, "Verification required. Please complete the challenge.");
});

test("maps rate limit responses with retry hint", () => {
  const message = mapGoogleSignInError(makeResponse(429, "12"), {
    code: "RATE_LIMITED",
    error: "Too many requests, please try again later.",
  });
  assert.match(message, /Too many attempts/);
  assert.match(message, /12 seconds/);
});

test("maps origin rejection and oauth config errors to specific text", () => {
  const originMessage = mapGoogleSignInError(makeResponse(400), {
    code: "ORIGIN_NOT_ALLOWED",
    error: "Request origin is missing or not allowed.",
  });
  assert.equal(originMessage, "Access origin is not allowed for sign-in.");

  const configMessage = mapGoogleSignInError(makeResponse(500), {
    code: "OAUTH_CONFIG_MISSING",
    error: "Google OAuth is not configured.",
  });
  assert.equal(configMessage, "Sign-in is temporarily unavailable due to configuration. Please contact support.");
});
