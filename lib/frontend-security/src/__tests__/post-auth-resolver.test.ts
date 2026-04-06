import test from "node:test";
import assert from "node:assert/strict";

import { resolveAuthenticatedNextStep } from "../index";

test("shared post-auth resolver keeps MFA precedence before continuation", () => {
  const result = resolveAuthenticatedNextStep({
    authStatus: "authenticated_mfa_pending_enrolled",
    user: null,
    continuationPath: "/invitations/token-1/accept",
    deniedLoginPath: "/login?error=access_denied",
  });

  assert.equal(result.destination, "/mfa/challenge");
  assert.equal(result.reason, "mfa_pending");
});

test("shared post-auth resolver prioritizes continuation before onboarding/default", () => {
  const result = resolveAuthenticatedNextStep({
    authStatus: "authenticated_fully",
    user: {
      id: "user-1",
      email: "u@example.com",
      isSuperAdmin: false,
      appAccess: {
        normalizedAccessProfile: "organization",
        canAccess: false,
        requiredOnboarding: "organization",
      },
    } as never,
    continuationPath: "/invitations/token-1/accept",
    deniedLoginPath: "/login?error=access_denied",
  });

  assert.equal(result.destination, "/invitations/token-1/accept");
  assert.equal(result.reason, "continuation");
});

test("shared post-auth resolver preserves superadmin deny path", () => {
  const result = resolveAuthenticatedNextStep({
    authStatus: "authenticated_fully",
    user: {
      id: "user-1",
      email: "u@example.com",
      isSuperAdmin: false,
      appAccess: {
        normalizedAccessProfile: "superadmin",
        canAccess: false,
        requiredOnboarding: "none",
      },
    } as never,
    deniedLoginPath: "/login?error=access_denied",
  });

  assert.equal(result.destination, "/login?error=access_denied");
  assert.equal(result.reason, "superadmin_policy");
});
