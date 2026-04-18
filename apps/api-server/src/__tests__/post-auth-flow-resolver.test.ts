import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_POST_AUTH_PATH as DEFAULT_POST_AUTH_PATH_FROM_DESTINATION,
  resolveAuthenticatedPostAuthDestination,
} from "../lib/postAuthDestination.js";
import { resolvePostAuthContinuation } from "../lib/postAuthContinuation.js";
import {
  DEFAULT_POST_AUTH_PATH as DEFAULT_POST_AUTH_PATH_FROM_REDIRECT,
  buildAccessDeniedLoginPath as buildAccessDeniedLoginPathFromRedirect,
} from "../lib/postAuthRedirect.js";
import {
  AUTH_LOGIN_PATH as AUTH_LOGIN_PATH_CANONICAL,
  buildAccessDeniedLoginPath as buildAccessDeniedLoginPathCanonical,
  DEFAULT_POST_AUTH_PATH as DEFAULT_POST_AUTH_PATH_CANONICAL,
} from "@workspace/auth";

test("post-auth redirect helper exports remain consistent with canonical auth contract", () => {
  assert.equal(
    DEFAULT_POST_AUTH_PATH_FROM_REDIRECT,
    DEFAULT_POST_AUTH_PATH_CANONICAL,
  );
  assert.equal(
    DEFAULT_POST_AUTH_PATH_FROM_DESTINATION,
    DEFAULT_POST_AUTH_PATH_CANONICAL,
  );

  assert.equal(buildAccessDeniedLoginPathFromRedirect(), buildAccessDeniedLoginPathCanonical());
  assert.equal(buildAccessDeniedLoginPathFromRedirect(), `${AUTH_LOGIN_PATH_CANONICAL}?error=access_denied`);
});

test("post-auth resolver prioritizes onboarding over continuation path", () => {
  const destination = resolveAuthenticatedPostAuthDestination({
    continuation: resolvePostAuthContinuation({
      appSlug: "admin",
      returnPath: "/invitations/token-1/accept",
    }),
    flowDecision: {
      appSlug: "admin",
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
      appSlug: "admin",
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
      appSlug: "admin",
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

test("login without onboarding and with continuation resolves continuation destination", () => {
  const continuation = resolvePostAuthContinuation({
    appSlug: "admin",
    returnPath: "/invitations/token-2/accept",
  });

  const destination = resolveAuthenticatedPostAuthDestination({
    continuation,
    flowDecision: {
      appSlug: "admin",
      canAccess: true,
      normalizedAccessProfile: "organization",
      requiredOnboarding: "none",
      destination: "/dashboard",
    },
    fallbackPath: "/dashboard",
    stage: "post_auth",
  });

  assert.equal(continuation?.type, "invitation_acceptance");
  assert.equal(destination, "/invitations/token-2/accept");
});

test("verify-email without onboarding and with continuation resolves continuation destination", () => {
  const continuation = resolvePostAuthContinuation({
    appSlug: "admin",
    returnPath: "/register/client",
    continuationType: "client_registration",
  });

  const destination = resolveAuthenticatedPostAuthDestination({
    continuation,
    flowDecision: {
      appSlug: "admin",
      canAccess: true,
      normalizedAccessProfile: "organization",
      requiredOnboarding: "none",
      destination: "/dashboard",
    },
    fallbackPath: "/dashboard",
    stage: "post_auth",
  });

  assert.equal(continuation?.type, "client_registration");
  assert.equal(destination, "/register/client");
});

test("login with onboarding and continuation resolves onboarding first, then continuation post-onboarding", () => {
  const continuation = resolvePostAuthContinuation({
    appSlug: "admin",
    returnPath: "/invitations/token-3/accept",
  });
  const flowDecision = {
    appSlug: "admin",
    canAccess: true,
    normalizedAccessProfile: "organization" as const,
    requiredOnboarding: "organization" as const,
    destination: "/onboarding/organization",
  };

  const postAuthDestination = resolveAuthenticatedPostAuthDestination({
    continuation,
    flowDecision,
    fallbackPath: "/dashboard",
    stage: "post_auth",
  });
  const postOnboardingDestination = resolveAuthenticatedPostAuthDestination({
    continuation,
    flowDecision,
    fallbackPath: "/dashboard",
    stage: "post_onboarding",
  });

  assert.equal(postAuthDestination, "/onboarding/organization");
  assert.equal(postOnboardingDestination, "/invitations/token-3/accept");
});

test("post-auth resolver falls back to default destination when continuation is missing and onboarding is not required", () => {
  const destination = resolveAuthenticatedPostAuthDestination({
    continuation: null,
    flowDecision: {
      appSlug: "admin",
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
      appSlug: "admin",
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

test("post-auth resolver ignores invalid continuation paths and falls back safely", () => {
  const destination = resolveAuthenticatedPostAuthDestination({
    continuation: {
      type: "default_app_entry",
      appSlug: "admin",
      returnPath: "/not-an-allowed-route",
    },
    flowDecision: {
      appSlug: "admin",
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

test("post-onboarding resolver uses default destination when continuation is missing", () => {
  const destination = resolveAuthenticatedPostAuthDestination({
    continuation: null,
    flowDecision: {
      appSlug: "admin",
      canAccess: true,
      normalizedAccessProfile: "organization",
      requiredOnboarding: "none",
      destination: "/dashboard",
    },
    fallbackPath: "/dashboard",
    stage: "post_onboarding",
  });

  assert.equal(destination, "/dashboard");
});

test("post-auth resolver ignores continuation when app access is denied", () => {
  const destination = resolveAuthenticatedPostAuthDestination({
    continuation: resolvePostAuthContinuation({
      appSlug: "workspace",
      returnPath: "/invitations/token-99/accept",
    }),
    flowDecision: {
      appSlug: "workspace",
      canAccess: false,
      normalizedAccessProfile: "superadmin",
      requiredOnboarding: "none",
      destination: "/login?error=access_denied",
    },
    fallbackPath: "/dashboard",
    stage: "post_auth",
  });

  assert.equal(destination, "/login?error=access_denied");
});

test("post-auth resolver ignores continuation when continuation app does not match resolved app", () => {
  const destination = resolveAuthenticatedPostAuthDestination({
    continuation: resolvePostAuthContinuation({
      appSlug: "admin",
      returnPath: "/invitations/token-100/accept",
    }),
    flowDecision: {
      appSlug: "workspace",
      canAccess: true,
      normalizedAccessProfile: "organization",
      requiredOnboarding: "none",
      destination: "/workspace/home",
    },
    fallbackPath: "/workspace/home",
    stage: "post_auth",
  });

  assert.equal(destination, "/workspace/home");
});

test("post-onboarding resolver still blocks continuation when onboarding is still required", () => {
  const destination = resolveAuthenticatedPostAuthDestination({
    continuation: resolvePostAuthContinuation({
      appSlug: "admin",
      returnPath: "/invitations/token-101/accept",
    }),
    flowDecision: {
      appSlug: "admin",
      canAccess: true,
      normalizedAccessProfile: "organization",
      requiredOnboarding: "user",
      destination: "/onboarding/user",
    },
    fallbackPath: "/dashboard",
    stage: "post_onboarding",
  });

  assert.equal(destination, "/onboarding/user");
});
