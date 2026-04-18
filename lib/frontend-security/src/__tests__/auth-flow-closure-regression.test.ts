import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveAppAuthRoutePolicy,
  getDisallowedAuthRouteRedirect,
  isSafePostAuthNavigationPath,
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

test("ORG ADMIN SIGNUP + SOLO SIGNUP journey destinations stay deterministic across MFA/onboarding transitions", () => {
  const orgPostVerify = resolveAuthenticatedNextStep({
    authStatus: "authenticated_mfa_pending_unenrolled",
    user: null,
    continuationPath: "/invitations/org-token/accept",
    deniedLoginPath: "/login?error=access_denied",
  });
  assert.equal(orgPostVerify.destination, "/mfa/enroll");

  const orgPostMfa = resolveAuthenticatedNextStep({
    authStatus: "authenticated_fully",
    user: {
      isSuperAdmin: false,
      appAccess: {
        normalizedAccessProfile: "organization",
        canAccess: false,
        requiredOnboarding: "organization",
      },
    } as never,
    continuationPath: "/invitations/org-token/accept",
    deniedLoginPath: "/login?error=access_denied",
    defaultPath: "/dashboard",
  });
  assert.equal(orgPostMfa.destination, "/onboarding/organization");

  const soloPostVerify = resolveAuthenticatedNextStep({
    authStatus: "authenticated_mfa_pending_enrolled",
    user: null,
    continuationPath: "/dashboard/apps",
    deniedLoginPath: "/login?error=access_denied",
  });
  assert.equal(soloPostVerify.destination, "/mfa/challenge");

  const soloPostMfa = resolveAuthenticatedNextStep({
    authStatus: "authenticated_fully",
    user: {
      isSuperAdmin: false,
      appAccess: {
        normalizedAccessProfile: "solo",
        canAccess: true,
        requiredOnboarding: "none",
      },
    } as never,
    continuationPath: "/dashboard/apps",
    deniedLoginPath: "/login?error=access_denied",
    defaultPath: "/dashboard",
  });
  assert.equal(soloPostMfa.destination, "/dashboard/apps");
  assert.notEqual(soloPostMfa.destination, "/onboarding/organization");
});

test("INVITATION FLOW branches (create-password, sign-in, google) keep continuation through MFA and onboarding", () => {
  const continuationPath = "/invitations/token-44/accept";

  const createPasswordBranch = resolveAuthenticatedNextStep({
    authStatus: "authenticated_mfa_pending_unenrolled",
    user: null,
    continuationPath,
    deniedLoginPath: "/login?error=access_denied",
  });
  assert.equal(createPasswordBranch.destination, "/mfa/enroll");

  const existingSignInBranch = resolveAuthenticatedNextStep({
    authStatus: "authenticated_mfa_pending_enrolled",
    user: null,
    continuationPath,
    deniedLoginPath: "/login?error=access_denied",
  });
  assert.equal(existingSignInBranch.destination, "/mfa/challenge");

  const googleBranchPostMfa = resolveAuthenticatedNextStep({
    authStatus: "authenticated_fully",
    user: {
      isSuperAdmin: false,
      appAccess: {
        normalizedAccessProfile: "organization",
        canAccess: true,
        requiredOnboarding: "none",
      },
    } as never,
    continuationPath,
    deniedLoginPath: "/login?error=access_denied",
  });
  assert.equal(googleBranchPostMfa.destination, continuationPath);
});

test("stale-state safety and continuation validation stay fail-closed after auth transitions", () => {
  const transitionContinuations = [
    "/invitations/token-verify/accept",
    "/dashboard/apps",
    "/events/event-1/register",
    "/register/client",
  ];
  for (const continuationPath of transitionContinuations) {
    assert.equal(
      isSafePostAuthNavigationPath(continuationPath),
      true,
      `Expected safe continuation for ${continuationPath}.`,
    );
  }

  const unsafe = [
    "https://evil.example/path",
    "//evil.example/path",
    "/admin/internal",
  ];
  for (const continuationPath of unsafe) {
    assert.equal(
      isSafePostAuthNavigationPath(continuationPath),
      false,
      `Expected fail-closed continuation rejection for ${continuationPath}.`,
    );
  }
});
