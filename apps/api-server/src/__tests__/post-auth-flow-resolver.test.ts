import test from "node:test";
import assert from "node:assert/strict";

import { resolveAuthenticatedPostAuthDestination } from "../lib/postAuthDestination.js";

test("post-auth resolver prioritizes continuation path over app flow destination", () => {
  const destination = resolveAuthenticatedPostAuthDestination({
    continuationPath: "/invitations/token-1/accept",
    flowDecision: {
      canAccess: true,
      normalizedAccessProfile: "organization",
      requiredOnboarding: "organization",
      destination: "/onboarding/organization",
    },
    fallbackPath: "/dashboard",
  });

  assert.equal(destination, "/invitations/token-1/accept");
});

test("post-auth resolver falls back to flow decision destination when continuation is missing", () => {
  const destination = resolveAuthenticatedPostAuthDestination({
    continuationPath: null,
    flowDecision: {
      canAccess: true,
      normalizedAccessProfile: "organization",
      requiredOnboarding: "user",
      destination: "/onboarding/user",
    },
    fallbackPath: "/dashboard",
  });

  assert.equal(destination, "/onboarding/user");
});

test("post-auth resolver returns fallback path when flow decision is unavailable", () => {
  const destination = resolveAuthenticatedPostAuthDestination({
    continuationPath: "https://example.com/evil",
    flowDecision: null,
    fallbackPath: "/dashboard",
  });

  assert.equal(destination, "/dashboard");
});
