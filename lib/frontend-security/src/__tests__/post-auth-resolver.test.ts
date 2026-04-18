import test from "node:test";
import assert from "node:assert/strict";

import {
  isSafePostAuthNavigationPath,
  resolveAuthenticatedNextStep,
} from "../index";

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

test("shared post-auth resolver prioritizes onboarding before continuation/default", () => {
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

  assert.equal(result.destination, "/onboarding/organization");
  assert.equal(result.reason, "onboarding_organization");
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

test("shared post-auth resolver does not let continuation override access denial", () => {
  const result = resolveAuthenticatedNextStep({
    authStatus: "authenticated_fully",
    user: {
      id: "user-2",
      email: "denied@example.com",
      isSuperAdmin: false,
      appAccess: {
        normalizedAccessProfile: "organization",
        canAccess: false,
        requiredOnboarding: "none",
      },
    } as never,
    continuationPath: "/invitations/token-77/accept",
    deniedLoginPath: "/login?error=access_denied",
  });

  assert.equal(result.destination, "/login?error=access_denied");
  assert.equal(result.reason, "access_denied");
});

test("shared post-auth resolver rejects arbitrary continuation routes", () => {
  const result = resolveAuthenticatedNextStep({
    authStatus: "authenticated_fully",
    user: {
      id: "user-3",
      email: "ok@example.com",
      isSuperAdmin: false,
      appAccess: {
        normalizedAccessProfile: "organization",
        canAccess: true,
        requiredOnboarding: "none",
      },
    } as never,
    continuationPath: "/totally-invalid-path",
    deniedLoginPath: "/login?error=access_denied",
    defaultPath: "/dashboard",
  });

  assert.equal(result.destination, "/dashboard");
  assert.equal(result.reason, "default");
});

test("shared post-auth resolver preserves invitation continuation when safe", () => {
  const result = resolveAuthenticatedNextStep({
    authStatus: "authenticated_fully",
    user: {
      id: "user-4",
      email: "invitee@example.com",
      isSuperAdmin: false,
      appAccess: {
        normalizedAccessProfile: "organization",
        canAccess: true,
        requiredOnboarding: "none",
      },
    } as never,
    continuationPath: "/invitations/token-55/accept",
    deniedLoginPath: "/login?error=access_denied",
  });

  assert.equal(result.destination, "/invitations/token-55/accept");
  assert.equal(result.reason, "continuation");
});

test("safe post-auth path helper allows known onboarding and continuation routes", () => {
  assert.equal(isSafePostAuthNavigationPath("/onboarding/organization"), true);
  assert.equal(isSafePostAuthNavigationPath("/onboarding/user"), true);
  assert.equal(isSafePostAuthNavigationPath("/invitations/token-2/accept"), true);
  assert.equal(isSafePostAuthNavigationPath("/events/event-1/register"), true);
  assert.equal(isSafePostAuthNavigationPath("/register/client"), true);
});

test("safe post-auth path helper rejects unsafe and malformed routes", () => {
  assert.equal(isSafePostAuthNavigationPath("//evil.com"), false);
  assert.equal(isSafePostAuthNavigationPath("https://evil.com"), false);
  assert.equal(isSafePostAuthNavigationPath("/dashboard/../admin"), false);
  assert.equal(isSafePostAuthNavigationPath("/admin/internal"), false);
});
