import test from "node:test";
import assert from "node:assert/strict";

import { resolveAuthenticatedPostAuthDestination } from "../lib/postAuthDestination.js";
import { resolvePostAuthContinuation } from "../lib/postAuthContinuation.js";

test("post-auth resolver prioritizes onboarding over continuation path", () => {
  const destination = resolveAuthenticatedPostAuthDestination({
    continuation: resolvePostAuthContinuation({
      appSlug: "admin",
      returnPath: "/invitations/token-1/accept",
    }),
    flowDecision: {
      canAccess: true,
      normalizedAccessProfile: "organization",
      requiredOnboarding: "organization",
      destination: "/onboarding/organization",
    },
    fallbackPath: "/dashboard",
    stage: "post_auth",
  });

  assert.equal(destination, "/onboarding/organization");
});

test("post-auth resolver falls back to flow decision destination when continuation is missing", () => {
  const destination = resolveAuthenticatedPostAuthDestination({
    continuation: null,
    flowDecision: {
      canAccess: true,
      normalizedAccessProfile: "organization",
      requiredOnboarding: "user",
      destination: "/onboarding/user",
    },
    fallbackPath: "/dashboard",
    stage: "post_auth",
  });

  assert.equal(destination, "/onboarding/user");
});

test("post-auth resolver prioritizes continuation when onboarding is not required", () => {
  const destination = resolveAuthenticatedPostAuthDestination({
    continuation: resolvePostAuthContinuation({
      appSlug: "admin",
      returnPath: "/invitations/token-1/accept",
    }),
    flowDecision: {
      canAccess: true,
      normalizedAccessProfile: "organization",
      requiredOnboarding: "none",
      destination: "/dashboard",
    },
    fallbackPath: "/dashboard",
    stage: "post_auth",
  });

  assert.equal(destination, "/invitations/token-1/accept");
});

test("post-auth resolver falls back to default destination when continuation is missing and onboarding is not required", () => {
  const destination = resolveAuthenticatedPostAuthDestination({
    continuation: null,
    flowDecision: {
      canAccess: true,
      normalizedAccessProfile: "organization",
      requiredOnboarding: "none",
      destination: "/dashboard",
    },
    fallbackPath: "/dashboard",
    stage: "post_auth",
  });

  assert.equal(destination, "/dashboard");
});

test("post-auth resolver returns fallback path when flow decision is unavailable", () => {
  const destination = resolveAuthenticatedPostAuthDestination({
    continuation: resolvePostAuthContinuation({
      appSlug: "admin",
      returnPath: "https://example.com/evil",
    }),
    flowDecision: null,
    fallbackPath: "/dashboard",
    stage: "post_auth",
  });

  assert.equal(destination, "/dashboard");
});

test("post-onboarding resolver resumes continuation before default destination", () => {
  const destination = resolveAuthenticatedPostAuthDestination({
    continuation: resolvePostAuthContinuation({
      appSlug: "admin",
      returnPath: "/register/client",
      continuationType: "client_registration",
    }),
    flowDecision: {
      canAccess: true,
      normalizedAccessProfile: "organization",
      requiredOnboarding: "none",
      destination: "/dashboard",
    },
    fallbackPath: "/dashboard",
    stage: "post_onboarding",
  });

  assert.equal(destination, "/register/client");
});
