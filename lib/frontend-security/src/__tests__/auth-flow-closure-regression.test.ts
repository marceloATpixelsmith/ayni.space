import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveAppAuthRoutePolicy,
  getDisallowedAuthRouteRedirect,
  isAuthRouteAllowed,
  resolveAuthenticatedNextStep,
} from "../index";

test("SIGNUP/LOGIN BRANCHING: superadmin create-account affordances remain absent while non-superadmin affordances remain present", () => {
  const superadminPolicy = deriveAppAuthRoutePolicy({
    slug: "admin",
    normalizedAccessProfile: "superadmin",
  });
  const orgPolicy = deriveAppAuthRoutePolicy({
    slug: "admin",
    normalizedAccessProfile: "organization",
  });

  assert.equal(superadminPolicy.allowCustomerRegistration, false);
  assert.equal(superadminPolicy.allowInvitations, false);
  assert.equal(orgPolicy.allowCustomerRegistration, false);
  assert.equal(orgPolicy.allowInvitations, true);
});

test("SOLO SIGNUP FLOW: fallback route policy keeps user-onboarding available when metadata authRoutePolicy is missing", () => {
  const soloPolicy = deriveAppAuthRoutePolicy({
    slug: "solo-app",
    normalizedAccessProfile: "solo",
  });
  assert.equal(soloPolicy.allowOnboarding, true);
  assert.equal(isAuthRouteAllowed({ slug: "solo-app", normalizedAccessProfile: "solo" }, "onboarding"), true);
});

test("AUTH/ME + ROUTE GUARDS: unauthenticated, fully authenticated, and MFA-pending states map to correct guard destination", () => {
  assert.equal(
    getDisallowedAuthRouteRedirect({
      app: { slug: "admin", normalizedAccessProfile: "organization" },
      authStatus: "unauthenticated",
    }),
    "/login",
  );

  assert.equal(
    getDisallowedAuthRouteRedirect({
      app: { slug: "admin", normalizedAccessProfile: "organization" },
      authStatus: "authenticated_fully",
    }),
    "/dashboard",
  );

  assert.equal(
    getDisallowedAuthRouteRedirect({
      app: { slug: "admin", normalizedAccessProfile: "organization" },
      authStatus: "authenticated_mfa_pending_enrolled",
    }),
    "/mfa/challenge",
  );

  assert.equal(
    getDisallowedAuthRouteRedirect({
      app: { slug: "admin", normalizedAccessProfile: "organization" },
      authStatus: "authenticated_mfa_pending_unenrolled",
    }),
    "/mfa/enroll",
  );
});

test("POST-AUTH CONTINUATION COMPETITION: MFA first, onboarding second, continuation third, default last", () => {
  const mfaFirst = resolveAuthenticatedNextStep({
    authStatus: "authenticated_mfa_pending_enrolled",
    user: null,
    continuationPath: "/invitations/token-1/accept",
    deniedLoginPath: "/login?error=access_denied",
  });
  assert.equal(mfaFirst.destination, "/mfa/challenge");

  const onboardingSecond = resolveAuthenticatedNextStep({
    authStatus: "authenticated_fully",
    user: {
      appAccess: {
        normalizedAccessProfile: "organization",
        canAccess: false,
        requiredOnboarding: "organization",
      },
    } as never,
    continuationPath: "/invitations/token-1/accept",
    deniedLoginPath: "/login?error=access_denied",
  });
  assert.equal(onboardingSecond.destination, "/onboarding/organization");

  const continuationThird = resolveAuthenticatedNextStep({
    authStatus: "authenticated_fully",
    user: {
      appAccess: {
        normalizedAccessProfile: "organization",
        canAccess: true,
        requiredOnboarding: "none",
      },
    } as never,
    continuationPath: "/invitations/token-1/accept",
    deniedLoginPath: "/login?error=access_denied",
  });
  assert.equal(continuationThird.destination, "/invitations/token-1/accept");

  const defaultLast = resolveAuthenticatedNextStep({
    authStatus: "authenticated_fully",
    user: {
      appAccess: {
        normalizedAccessProfile: "organization",
        canAccess: true,
        requiredOnboarding: "none",
      },
    } as never,
    continuationPath: "/totally-invalid",
    deniedLoginPath: "/login?error=access_denied",
    defaultPath: "/dashboard",
  });
  assert.equal(defaultLast.destination, "/dashboard");
});

test("STANDARD LOGIN ACCESS-DENIED BRANCH: denied access always overrides continuation", () => {
  const denied = resolveAuthenticatedNextStep({
    authStatus: "authenticated_fully",
    user: {
      isSuperAdmin: false,
      appAccess: {
        normalizedAccessProfile: "superadmin",
        canAccess: false,
        requiredOnboarding: "none",
      },
    } as never,
    continuationPath: "/invitations/token-88/accept",
    deniedLoginPath: "/login?error=access_denied",
  });

  assert.equal(denied.destination, "/login?error=access_denied");
});
