import test from "node:test";
import assert from "node:assert/strict";

import { resolveAuthenticatedPostAuthDestination } from "../lib/postAuthDestination.js";
import {
  resolvePostAuthContinuation,
  type PostAuthContinuation,
} from "../lib/postAuthContinuation.js";
import { buildAccessDeniedLoginPath } from "../lib/postAuthRedirect.js";

function flow(input: {
  appSlug: string;
  continuationPath?: string | null;
  canAccess?: boolean;
  requiredOnboarding?: "none" | "organization" | "user";
  destination?: string;
  stage?: "post_auth" | "post_onboarding";
  continuationAppSlug?: string;
}) {
  const continuation = input.continuationPath
    ? resolvePostAuthContinuation({
        appSlug: input.continuationAppSlug ?? input.appSlug,
        returnPath: input.continuationPath,
      })
    : null;

  return resolveAuthenticatedPostAuthDestination({
    continuation,
    flowDecision: {
      appSlug: input.appSlug,
      canAccess: input.canAccess ?? true,
      requiredOnboarding: input.requiredOnboarding ?? "none",
      normalizedAccessProfile: "organization",
      destination: input.destination ?? "/dashboard",
    },
    stage: input.stage ?? "post_auth",
    fallbackPath: "/dashboard",
  });
}

test("ORG ADMIN SIGNUP FLOW: verify -> MFA -> onboarding -> dashboard destination chain remains deterministic", () => {
  const invitationContinuation = "/invitations/org-token/accept";

  assert.equal(
    flow({
      appSlug: "admin",
      continuationPath: invitationContinuation,
      requiredOnboarding: "organization",
      destination: "/onboarding/organization",
      stage: "post_auth",
    }),
    "/onboarding/organization",
  );

  assert.equal(
    flow({
      appSlug: "admin",
      continuationPath: invitationContinuation,
      requiredOnboarding: "organization",
      destination: "/onboarding/organization",
      stage: "post_onboarding",
    }),
    invitationContinuation,
  );

  assert.equal(
    flow({
      appSlug: "admin",
      continuationPath: "/dashboard",
      requiredOnboarding: "none",
      destination: "/dashboard",
    }),
    "/dashboard",
  );
});

test("SOLO SIGNUP FLOW: verify/authenticated routes to user onboarding and never leaks organization onboarding", () => {
  assert.equal(
    resolveAuthenticatedPostAuthDestination({
      continuation: resolvePostAuthContinuation({
        appSlug: "solo-app",
        returnPath: "/dashboard/apps",
      }),
      flowDecision: {
        appSlug: "solo-app",
        canAccess: true,
        requiredOnboarding: "user",
        normalizedAccessProfile: "solo",
        destination: "/onboarding/user",
      },
      stage: "post_auth",
      fallbackPath: "/dashboard",
    }),
    "/onboarding/user",
  );

  assert.notEqual(
    flow({
      appSlug: "solo-app",
      continuationPath: "/dashboard/apps",
      requiredOnboarding: "user",
      destination: "/onboarding/user",
    }),
    "/onboarding/organization",
  );
});

test("INVITATION FLOW: password + google continuations survive MFA and onboarding before final destination", () => {
  const invitationPath = "/invitations/token-123/accept";
  const continuation = resolvePostAuthContinuation({
    appSlug: "admin",
    returnPath: invitationPath,
  });

  assert.equal(continuation?.type, "invitation_acceptance");

  assert.equal(
    resolveAuthenticatedPostAuthDestination({
      continuation,
      flowDecision: {
        appSlug: "admin",
        canAccess: true,
        requiredOnboarding: "organization",
        normalizedAccessProfile: "organization",
        destination: "/onboarding/organization",
      },
      stage: "post_auth",
      fallbackPath: "/dashboard",
    }),
    "/onboarding/organization",
  );

  assert.equal(
    resolveAuthenticatedPostAuthDestination({
      continuation,
      flowDecision: {
        appSlug: "admin",
        canAccess: true,
        requiredOnboarding: "organization",
        normalizedAccessProfile: "organization",
        destination: "/onboarding/organization",
      },
      stage: "post_onboarding",
      fallbackPath: "/dashboard",
    }),
    invitationPath,
  );
});

test("STANDARD LOGIN FLOW: email/password and google share denied-access override and onboarding branch precedence", () => {
  const denied = buildAccessDeniedLoginPath();

  assert.equal(
    resolveAuthenticatedPostAuthDestination({
      continuation: resolvePostAuthContinuation({
        appSlug: "admin",
        returnPath: "/dashboard",
      }),
      flowDecision: {
        appSlug: "admin",
        canAccess: false,
        requiredOnboarding: "none",
        normalizedAccessProfile: "superadmin",
        destination: denied,
      },
      stage: "post_auth",
      fallbackPath: "/dashboard",
    }),
    denied,
  );

  assert.equal(
    flow({
      appSlug: "admin",
      continuationPath: "/dashboard/apps",
      requiredOnboarding: "organization",
      destination: "/onboarding/organization",
    }),
    "/onboarding/organization",
  );
});

test("FORGOT/RESET + already-have-account continuity: default app entry stays canonical and stale continuation is rejected", () => {
  const resetDefault = resolvePostAuthContinuation({
    appSlug: "admin",
    returnPath: "/dashboard",
    continuationType: "default_app_entry",
  });
  assert.equal(resetDefault?.type, "default_app_entry");

  const stale = resolvePostAuthContinuation({
    appSlug: "admin",
    returnPath: "https://evil.example/reset",
    continuationType: "default_app_entry",
  });
  assert.equal(stale, null);
});

test("CONTINUATION COMPETITION: onboarding > continuation > default and invalid/mismatched appSlug are rejected", () => {
  const valid = resolvePostAuthContinuation({
    appSlug: "admin",
    returnPath: "/invitations/token-200/accept",
  }) as PostAuthContinuation;

  assert.equal(
    resolveAuthenticatedPostAuthDestination({
      continuation: valid,
      flowDecision: {
        appSlug: "admin",
        canAccess: true,
        requiredOnboarding: "organization",
        normalizedAccessProfile: "organization",
        destination: "/onboarding/organization",
      },
      stage: "post_auth",
      fallbackPath: "/dashboard",
    }),
    "/onboarding/organization",
  );

  assert.equal(
    resolveAuthenticatedPostAuthDestination({
      continuation: valid,
      flowDecision: {
        appSlug: "admin",
        canAccess: true,
        requiredOnboarding: "none",
        normalizedAccessProfile: "organization",
        destination: "/dashboard",
      },
      stage: "post_auth",
      fallbackPath: "/dashboard",
    }),
    "/invitations/token-200/accept",
  );

  assert.equal(
    resolveAuthenticatedPostAuthDestination({
      continuation: {
        ...valid,
        appSlug: "wrong-app",
      },
      flowDecision: {
        appSlug: "admin",
        canAccess: true,
        requiredOnboarding: "none",
        normalizedAccessProfile: "organization",
        destination: "/dashboard",
      },
      stage: "post_auth",
      fallbackPath: "/dashboard",
    }),
    "/dashboard",
  );

  assert.equal(
    resolveAuthenticatedPostAuthDestination({
      continuation: {
        type: "default_app_entry",
        appSlug: "admin",
        returnPath: "/malicious/internal",
      },
      flowDecision: {
        appSlug: "admin",
        canAccess: true,
        requiredOnboarding: "none",
        normalizedAccessProfile: "organization",
        destination: "/dashboard",
      },
      stage: "post_auth",
      fallbackPath: "/dashboard",
    }),
    "/dashboard",
  );
});
