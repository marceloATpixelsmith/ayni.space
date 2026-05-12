import test from "node:test";
import assert from "node:assert/strict";

import {
  resolvePostAuthContinuation,
} from "../lib/postAuthContinuation.js";

import {
  resolveAuthenticatedPostAuthDestination,
} from "../lib/postAuthDestination.js";

import type {
  PostAuthFlowDecision,
} from "../lib/postAuthFlow.js";

function buildFlowDecision(
  overrides: Partial<PostAuthFlowDecision>,
): PostAuthFlowDecision
{
  return {
    appSlug: "workspace",
    canAccess: true,
    requiredOnboarding: "none",
    normalizedAccessProfile: "organization",
    destination: "/dashboard",
    ...overrides,
  };
}

test(
  "post-auth destination keeps superadmin access-denied ahead of continuation",
  () =>
  {
    const continuation = resolvePostAuthContinuation({
      appSlug: "admin",
      returnPath: "/invitations/token-1/accept",
    });

    const destination = resolveAuthenticatedPostAuthDestination({
      continuation,
      currentAppSlug: "admin",
      flowDecision: buildFlowDecision({
        appSlug: "admin",
        canAccess: false,
        requiredOnboarding: "none",
        normalizedAccessProfile: "superadmin",
        destination: "/login?error=access_denied",
      }),
    });

    assert.equal(destination, "/login?error=access_denied");
  },
);

test(
  "post-auth destination keeps organization onboarding ahead of invitation continuation",
  () =>
  {
    const continuation = resolvePostAuthContinuation({
      appSlug: "workspace",
      returnPath: "/invitations/token-1/accept",
    });

    const destination = resolveAuthenticatedPostAuthDestination({
      continuation,
      currentAppSlug: "workspace",
      flowDecision: buildFlowDecision({
        appSlug: "workspace",
        canAccess: true,
        requiredOnboarding: "organization",
        normalizedAccessProfile: "organization",
        destination: "/onboarding/organization",
      }),
    });

    assert.equal(destination, "/onboarding/organization");
  },
);

test(
  "post-auth destination keeps solo user onboarding ahead of client continuation",
  () =>
  {
    const continuation = resolvePostAuthContinuation({
      appSlug: "workspace-solo",
      returnPath: "/register/client",
    });

    const destination = resolveAuthenticatedPostAuthDestination({
      continuation,
      currentAppSlug: "workspace-solo",
      flowDecision: buildFlowDecision({
        appSlug: "workspace-solo",
        canAccess: true,
        requiredOnboarding: "user",
        normalizedAccessProfile: "solo",
        destination: "/onboarding/user",
      }),
    });

    assert.equal(destination, "/onboarding/user");
  },
);

test(
  "post-auth destination resumes invitation continuation only when app slug matches",
  () =>
  {
    const continuation = resolvePostAuthContinuation({
      appSlug: "workspace",
      returnPath: "/invitations/token-1/accept",
    });

    const matchingDestination = resolveAuthenticatedPostAuthDestination({
      continuation,
      currentAppSlug: "workspace",
      flowDecision: buildFlowDecision({
        appSlug: "workspace",
        canAccess: true,
        requiredOnboarding: "none",
        normalizedAccessProfile: "organization",
        destination: "/dashboard",
      }),
    });

    assert.equal(matchingDestination, "/invitations/token-1/accept");

    const mismatchedDestination = resolveAuthenticatedPostAuthDestination({
      continuation,
      currentAppSlug: "other-app",
      flowDecision: buildFlowDecision({
        appSlug: "other-app",
        canAccess: true,
        requiredOnboarding: "none",
        normalizedAccessProfile: "organization",
        destination: "/dashboard",
      }),
    });

    assert.equal(mismatchedDestination, "/dashboard");
  },
);

test(
  "post-auth continuation allowlist accepts client and public registration routes",
  () =>
  {
    const allowedPaths = [
      "/register/client",
      "/registration/client",
      "/register/public",
      "/registration/public",
    ];

    for (const returnPath of allowedPaths)
    {
      const continuation = resolvePostAuthContinuation({
        appSlug: "workspace",
        returnPath,
      });

      assert.equal(continuation?.type, "client_registration");
      assert.equal(continuation?.returnPath, returnPath);
    }
  },
);

test(
  "post-auth continuation rejects client registration type when path does not match allowlist",
  () =>
  {
    const continuation = resolvePostAuthContinuation({
      appSlug: "workspace",
      continuationType: "client_registration",
      returnPath: "/signup",
    });

    assert.equal(continuation, null);
  },
);

test(
  "post-auth continuation rejects arbitrary and malformed paths",
  () =>
  {
    const paths = [
      "/admin/internal",
      "/dashboard/../admin",
      "https://evil.example/path",
      "//evil.example/path",
      "/register/org",
      "/registration/organization",
    ];

    for (const returnPath of paths)
    {
      const continuation = resolvePostAuthContinuation({
        appSlug: "workspace",
        returnPath,
      });

      assert.equal(continuation, null);
    }
  },
);

test(
  "post-onboarding destination resumes invitation continuation after organization onboarding",
  () =>
  {
    const continuation = resolvePostAuthContinuation({
      appSlug: "workspace",
      returnPath: "/invitations/token-1/accept",
    });

    const destination = resolveAuthenticatedPostAuthDestination({
      continuation,
      currentAppSlug: "workspace",
      stage: "post_onboarding",
      flowDecision: buildFlowDecision({
        appSlug: "workspace",
        canAccess: true,
        requiredOnboarding: "organization",
        normalizedAccessProfile: "organization",
        destination: "/onboarding/organization",
      }),
    });

    assert.equal(destination, "/invitations/token-1/accept");
  },
);

test(
  "post-onboarding destination keeps user onboarding until user onboarding is complete",
  () =>
  {
    const continuation = resolvePostAuthContinuation({
      appSlug: "workspace-solo",
      returnPath: "/register/client",
    });

    const destination = resolveAuthenticatedPostAuthDestination({
      continuation,
      currentAppSlug: "workspace-solo",
      stage: "post_onboarding",
      flowDecision: buildFlowDecision({
        appSlug: "workspace-solo",
        canAccess: true,
        requiredOnboarding: "user",
        normalizedAccessProfile: "solo",
        destination: "/onboarding/user",
      }),
    });

    assert.equal(destination, "/onboarding/user");
  },
);
