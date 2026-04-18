import test from "node:test";
import assert from "node:assert/strict";

import { ensureTestDatabaseEnv, createSessionApp, patchProperty, performJsonRequest } from "./helpers.js";
import { resolvePostAuthContinuation } from "../lib/postAuthContinuation.js";
import { resolveAuthenticatedPostAuthDestination } from "../lib/postAuthDestination.js";

ensureTestDatabaseEnv();

const { db } = await import("@workspace/db");
const { default: authRouter } = await import("../routes/auth.js");

function resolveFinalDestination(options: {
  appSlug: string;
  returnPath?: string;
  continuationType?: string;
  requiredOnboarding: "none" | "organization" | "user";
  canAccess?: boolean;
  destination?: string;
  stage?: "post_auth" | "post_onboarding";
}) {
  const continuation = resolvePostAuthContinuation({
    appSlug: options.appSlug,
    returnPath: options.returnPath,
    continuationType: options.continuationType,
  });

  return resolveAuthenticatedPostAuthDestination({
    continuation,
    stage: options.stage,
    flowDecision: {
      appSlug: options.appSlug,
      canAccess: options.canAccess ?? true,
      normalizedAccessProfile: "organization",
      requiredOnboarding: options.requiredOnboarding,
      destination: options.destination ?? "/dashboard",
    },
    fallbackPath: "/dashboard",
  });
}

test("phase 1c login and onboarding destination matrix remains backend-authoritative", () => {
  // password login -> no MFA -> dashboard
  assert.equal(
    resolveFinalDestination({
      appSlug: "admin",
      requiredOnboarding: "none",
      destination: "/dashboard",
    }),
    "/dashboard",
  );

  // password login -> MFA required -> challenge -> dashboard (after MFA)
  assert.equal(
    resolveFinalDestination({
      appSlug: "admin",
      requiredOnboarding: "none",
      destination: "/dashboard",
    }),
    "/dashboard",
  );

  // Google login -> MFA required -> onboarding -> dashboard (after onboarding)
  assert.equal(
    resolveFinalDestination({
      appSlug: "admin",
      requiredOnboarding: "organization",
      destination: "/onboarding/organization",
      stage: "post_auth",
    }),
    "/onboarding/organization",
  );
  assert.equal(
    resolveFinalDestination({
      appSlug: "admin",
      requiredOnboarding: "organization",
      destination: "/onboarding/organization",
      stage: "post_onboarding",
    }),
    "/onboarding/organization",
  );
});

test("phase 1c verify-email and invitation continuation precedence is enforced", () => {
  // verify -> MFA required (after MFA, onboarding not required)
  assert.equal(
    resolveFinalDestination({
      appSlug: "admin",
      requiredOnboarding: "none",
      destination: "/dashboard",
    }),
    "/dashboard",
  );

  // verify -> onboarding required
  assert.equal(
    resolveFinalDestination({
      appSlug: "admin",
      requiredOnboarding: "user",
      destination: "/onboarding/user",
      stage: "post_auth",
    }),
    "/onboarding/user",
  );

  // verify -> continuation respected
  assert.equal(
    resolveFinalDestination({
      appSlug: "admin",
      requiredOnboarding: "none",
      returnPath: "/register/client",
      continuationType: "client_registration",
      destination: "/dashboard",
    }),
    "/register/client",
  );

  // invitation create_password -> MFA -> onboarding -> continuation
  assert.equal(
    resolveFinalDestination({
      appSlug: "admin",
      requiredOnboarding: "organization",
      returnPath: "/invitations/token-1/accept",
      destination: "/onboarding/organization",
      stage: "post_auth",
    }),
    "/onboarding/organization",
  );
  assert.equal(
    resolveFinalDestination({
      appSlug: "admin",
      requiredOnboarding: "organization",
      returnPath: "/invitations/token-1/accept",
      destination: "/onboarding/organization",
      stage: "post_onboarding",
    }),
    "/invitations/token-1/accept",
  );

  // invitation sign_in existing user -> continuation preserved
  assert.equal(
    resolveFinalDestination({
      appSlug: "admin",
      requiredOnboarding: "none",
      returnPath: "/invitations/token-2/accept",
      destination: "/dashboard",
    }),
    "/invitations/token-2/accept",
  );

  // OAuth invite -> MFA -> onboarding -> continuation (post onboarding)
  assert.equal(
    resolveFinalDestination({
      appSlug: "admin",
      requiredOnboarding: "organization",
      returnPath: "/invitations/token-3/accept",
      destination: "/onboarding/organization",
      stage: "post_onboarding",
    }),
    "/invitations/token-3/accept",
  );
});

test("phase 1c continuation validation remains fail-closed", () => {
  // invalid path rejected
  const invalidContinuation = resolvePostAuthContinuation({
    appSlug: "admin",
    returnPath: "/totally-invalid",
  });
  assert.equal(invalidContinuation, null);

  // mismatched appSlug rejected
  const mismatchedDestination = resolveAuthenticatedPostAuthDestination({
    continuation: resolvePostAuthContinuation({
      appSlug: "shipibo",
      returnPath: "/invitations/token-shipibo/accept",
    }),
    currentAppSlug: "admin",
    flowDecision: {
      appSlug: "admin",
      canAccess: true,
      normalizedAccessProfile: "organization",
      requiredOnboarding: "none",
      destination: "/dashboard",
    },
  });
  assert.equal(mismatchedDestination, "/dashboard");

  // access denied overrides continuation
  const deniedDestination = resolveAuthenticatedPostAuthDestination({
    continuation: resolvePostAuthContinuation({
      appSlug: "admin",
      returnPath: "/invitations/token-1/accept",
    }),
    flowDecision: {
      appSlug: "admin",
      canAccess: false,
      normalizedAccessProfile: "organization",
      requiredOnboarding: "none",
      destination: "/login?error=access_denied",
    },
  });
  assert.equal(deniedDestination, "/login?error=access_denied");
});

test("phase 1c /api/auth/me state matrix returns expected auth/session markers", async () => {
  const commonRestores = [
    patchProperty(db.query.orgMembershipsTable, "findMany", async () => []),
    patchProperty(db.query.organizationsTable, "findFirst", async () => null),
    patchProperty(db.query.orgAppAccessTable, "findMany", async () => []),
    patchProperty(db.query.appsTable, "findFirst", async () => null),
    patchProperty(db, "select", () => ({
      from: () => ({
        innerJoin: () => ({
          where: async () => [],
        }),
      }),
    } as never)),
    patchProperty(db, "update", () => ({
      set: () => ({
        where: async () => [],
      }),
    } as never)),
  ];

  try {
    // unauthenticated
    {
      const restores = [
        ...commonRestores,
        patchProperty(db.query.usersTable, "findFirst", async () => null),
      ];
      try {
        const app = createSessionApp(authRouter, {});
        const response = await performJsonRequest(app, "GET", "/api/auth/me");
        assert.equal(response.status, 401);
        assert.equal(response.body?.error, "Unauthorized. Please sign in.");
      } finally {
        restores.reverse().forEach((restore) => restore());
      }
    }

    // authenticated_fully
    {
      const restores = [
        ...commonRestores,
        patchProperty(db.query.usersTable, "findFirst", async () => ({
          id: "user-1",
          email: "user@example.com",
          name: "User",
          avatarUrl: null,
          isSuperAdmin: false,
          activeOrgId: null,
          suspended: false,
          deletedAt: null,
          active: true,
        })),
        patchProperty(db.query.userAuthSecurityTable, "findFirst", async () => ({
          mfaRequired: false,
          forceMfaEnrollment: false,
          firstAuthAfterResetPending: false,
          highRiskUntilMfaAt: null,
        })),
        patchProperty(db.query.mfaFactorsTable, "findFirst", async () => ({
          id: "factor-1",
          userId: "user-1",
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      ];
      try {
        const app = createSessionApp(authRouter, {
          userId: "user-1",
          appSlug: "admin",
          sessionGroup: "admin",
        });
        const response = await performJsonRequest(app, "GET", "/api/auth/me");
        assert.equal(response.status, 200);
        assert.equal(response.body?.authState, "authenticated");
        assert.equal(response.body?.sessionState, "authenticated");
        assert.equal(response.body?.nextStep, null);
        assert.equal(response.body?.needsEnrollment, false);
      } finally {
        restores.reverse().forEach((restore) => restore());
      }
    }

    // mfa_pending_enrolled
    {
      const restores = [
        ...commonRestores,
        patchProperty(db.query.usersTable, "findFirst", async () => ({
          id: "user-2",
          email: "pending@example.com",
          name: "Pending User",
          avatarUrl: null,
          isSuperAdmin: false,
          activeOrgId: null,
          suspended: false,
          deletedAt: null,
          active: true,
        })),
        patchProperty(db.query.mfaFactorsTable, "findFirst", async () => ({
          id: "factor-2",
          userId: "user-2",
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      ];
      try {
        const app = createSessionApp(authRouter, {
          pendingUserId: "user-2",
          pendingMfaReason: "challenge_required",
          sessionGroup: "admin",
        });
        const response = await performJsonRequest(app, "GET", "/api/auth/me");
        assert.equal(response.status, 200);
        assert.equal(response.body?.authState, "mfa_pending");
        assert.equal(response.body?.sessionState, "pending_second_factor");
        assert.equal(response.body?.nextStep, "mfa_challenge");
        assert.equal(response.body?.needsEnrollment, false);
      } finally {
        restores.reverse().forEach((restore) => restore());
      }
    }

    // mfa_pending_unenrolled
    {
      const restores = [
        ...commonRestores,
        patchProperty(db.query.usersTable, "findFirst", async () => ({
          id: "user-3",
          email: "pending2@example.com",
          name: "Pending User 2",
          avatarUrl: null,
          isSuperAdmin: false,
          activeOrgId: null,
          suspended: false,
          deletedAt: null,
          active: true,
        })),
        patchProperty(db.query.mfaFactorsTable, "findFirst", async () => null),
      ];
      try {
        const app = createSessionApp(authRouter, {
          pendingUserId: "user-3",
          pendingMfaReason: "enrollment_required",
          sessionGroup: "admin",
        });
        const response = await performJsonRequest(app, "GET", "/api/auth/me");
        assert.equal(response.status, 200);
        assert.equal(response.body?.authState, "mfa_pending");
        assert.equal(response.body?.sessionState, "pending_second_factor");
        assert.equal(response.body?.nextStep, "mfa_enroll");
        assert.equal(response.body?.needsEnrollment, true);
      } finally {
        restores.reverse().forEach((restore) => restore());
      }
    }
  } finally {
    commonRestores.reverse().forEach((restore) => restore());
  }
});
