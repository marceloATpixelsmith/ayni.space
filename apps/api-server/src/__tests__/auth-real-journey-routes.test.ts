import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  createStatefulSessionApp,
  ensureTestDatabaseEnv,
  patchProperty,
  performJsonRequest,
} from "./helpers.js";

ensureTestDatabaseEnv();
process.env["SESSION_SECRET"] ??= "test-session-secret";
process.env["ALLOWED_ORIGINS"] = "http://admin.local,http://workspace.local";
process.env["ADMIN_FRONTEND_ORIGINS"] = "http://admin.local";
process.env["GOOGLE_CLIENT_ID"] = "test-client";
process.env["GOOGLE_CLIENT_SECRET"] = "test-secret";
process.env["GOOGLE_REDIRECT_URI"] = "http://localhost:3000/api/auth/google/callback";
process.env["RATE_LIMIT_ENABLED"] = "false";
process.env["MFA_TOTP_ENCRYPTION_KEY"] = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env["NODE_ENV"] = "test";

const { db, pool } = await import("@workspace/db");
const { default: authRouter, authRouteDeps } = await import("../routes/auth.js");
const { default: invitationsRouter } = await import("../routes/invitations.js");
const { hashPassword } = await import("../lib/passwordAuth.js");

type MockState = {
  users: Map<string, any>;
  usersByEmail: Map<string, any>;
  usersByGoogleSubject: Map<string, any>;
  credentialsByUserId: Map<string, any>;
  authTokens: Array<any>;
  appProfiles: Record<string, any>;
  mfaRequiredUserIds: Set<string>;
  mfaEnrolledUserIds: Set<string>;
  orgAccessUserIds: Set<string>;
  soloAccessUserIds: Set<string>;
  invitationsByToken: Map<string, any>;
};

function buildState(): MockState {
  const orgOpen = {
    id: "app-org-open",
    slug: "org-open",
    name: "Org Open",
    isActive: true,
    accessMode: "organization",
    staffInvitesEnabled: true,
    customerRegistrationEnabled: true,
    transactionalFromEmail: "no-reply@org-open.local",
    transactionalFromName: "Org Open",
    transactionalReplyToEmail: "support@org-open.local",
    metadata: {},
  };
  const solo = {
    id: "app-solo",
    slug: "solo-app",
    name: "Solo",
    isActive: true,
    accessMode: "solo",
    staffInvitesEnabled: false,
    customerRegistrationEnabled: true,
    transactionalFromEmail: "no-reply@solo.local",
    transactionalFromName: "Solo",
    transactionalReplyToEmail: "support@solo.local",
    metadata: {},
  };

  return {
    users: new Map(),
    usersByEmail: new Map(),
    usersByGoogleSubject: new Map(),
    credentialsByUserId: new Map(),
    authTokens: [],
    appProfiles: { "org-open": orgOpen, "solo-app": solo },
    mfaRequiredUserIds: new Set(),
    mfaEnrolledUserIds: new Set(),
    orgAccessUserIds: new Set(),
    soloAccessUserIds: new Set(),
    invitationsByToken: new Map(),
  };
}

function collectStringLiterals(input: unknown): string[] {
  const results: string[] = [];
  const visited = new Set<unknown>();
  const stack: unknown[] = [input];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current == null) continue;
    if (typeof current === "string") {
      results.push(current);
      continue;
    }
    if (typeof current !== "object") continue;
    if (visited.has(current)) continue;
    visited.add(current);

    if (Array.isArray(current)) {
      for (const value of current) stack.push(value);
      continue;
    }

    for (const value of Object.values(current as Record<string, unknown>)) {
      stack.push(value);
    }
  }

  return results;
}

function installDbMocks(state: MockState) {
  const restores: Array<() => void> = [];

  const resolveUserFromQuery = (query: any) => {
    const literals = collectStringLiterals(query?.where);
    const requestedSubject = literals.find((value) => state.usersByGoogleSubject.has(value));
    if (requestedSubject) return state.usersByGoogleSubject.get(requestedSubject) ?? null;
    const requestedEmail = literals.find((value) => state.usersByEmail.has(value));
    if (requestedEmail) return state.usersByEmail.get(requestedEmail) ?? null;
    const requestedUserId = literals.find((value) => state.users.has(value));
    if (requestedUserId) return state.users.get(requestedUserId) ?? null;
    return state.users.values().next().value ?? null;
  };

  restores.push(
    patchProperty(db.query.appsTable, "findFirst", async (query: any) => {
      const literals = collectStringLiterals(query?.where);
      const byId = Object.values(state.appProfiles).find((app) => literals.includes(app.id));
      if (byId) return byId;
      const bySlug = Object.values(state.appProfiles).find((app) => literals.includes(app.slug));
      if (bySlug) return bySlug;
      return null;
    }),
    patchProperty(db.query.usersTable, "findFirst", async (query: any) => resolveUserFromQuery(query)),
    patchProperty(db.query.userCredentialsTable, "findFirst", async (query: any) => {
      const literals = collectStringLiterals(query?.where);
      const requestedUserId = literals.find((value) => state.credentialsByUserId.has(value));
      if (requestedUserId) return state.credentialsByUserId.get(requestedUserId) ?? null;
      const resolvedUser = resolveUserFromQuery(query);
      if (resolvedUser?.id && state.credentialsByUserId.has(resolvedUser.id)) {
        return state.credentialsByUserId.get(resolvedUser.id) ?? null;
      }
      return null;
    }),
    patchProperty(db.query.userAuthSecurityTable, "findFirst", async () => {
      const firstUser = state.users.values().next().value;
      if (!firstUser) return null;
      return state.mfaRequiredUserIds.has(firstUser.id)
        ? {
            userId: firstUser.id,
            mfaRequired: true,
            forceMfaEnrollment: !state.mfaEnrolledUserIds.has(firstUser.id),
            firstAuthAfterResetPending: false,
            highRiskUntilMfaAt: null,
          }
        : null;
    }),
    patchProperty(db.query.mfaFactorsTable, "findFirst", async () => {
      const firstUser = state.users.values().next().value;
      if (!firstUser || !state.mfaEnrolledUserIds.has(firstUser.id)) return null;
      return {
        id: "factor-1",
        userId: firstUser.id,
        factorType: "totp",
        status: "active",
        secretCiphertext: "cipher",
        secretIv: "iv",
        secretTag: "tag",
      };
    }),
    patchProperty(db.query.mfaRecoveryCodesTable, "findFirst", async () => ({ id: "recovery-1", userId: "test-user", consumedAt: null })),
    patchProperty(db.query.trustedDevicesTable, "findFirst", async () => null),
    patchProperty(db.query.userAppAccessTable, "findFirst", async (query: any) => {
      const user = resolveUserFromQuery(query);
      if (!user || !state.soloAccessUserIds.has(user.id)) return null;
      return { userId: user.id, appId: "app-solo", enabled: true };
    }),
    patchProperty(db.query.orgMembershipsTable, "findMany", async (query: any) => {
      const user = resolveUserFromQuery(query);
      if (!user || !state.orgAccessUserIds.has(user.id)) return [];
      return [{ userId: user.id, orgId: "org-1", membershipStatus: "active", role: "org_admin" }];
    }),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async (query: any) => {
      const user = resolveUserFromQuery(query);
      if (!user || !state.orgAccessUserIds.has(user.id)) return null;
      return { userId: user.id, orgId: "org-1", membershipStatus: "active", role: "org_admin" };
    }),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({
      id: "org-1",
      name: "Org 1",
      slug: "org-1",
      isActive: true,
      appId: "app-org-open",
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    patchProperty(db.query.orgAppAccessTable, "findFirst", async () => ({ orgId: "org-1", appId: "app-org-open", enabled: true })),
    patchProperty(db.query.orgAppAccessTable, "findMany", async () => ([{ orgId: "org-1", appId: "app-org-open", enabled: true }])),
    patchProperty(db.query.invitationsTable, "findFirst", async (query: any) => {
      const literals = collectStringLiterals(query?.where);
      const requested = [...state.invitationsByToken.entries()].find(([token]) => {
        const hashed = createHash("sha256").update(token).digest("hex");
        return literals.includes(hashed) || literals.includes(token);
      });
      if (requested) return requested[1];
      return null;
    }),
    patchProperty(db.query.authTokensTable, "findFirst", async (query: any) => {
      const literals = collectStringLiterals(query?.where);
      const type = literals.find((value) => value === "email_verification" || value === "password_reset");
      return state.authTokens.find((row) => row.tokenType === type && !row.consumedAt) ?? state.authTokens[0] ?? null;
    }),
    patchProperty(db.query.emailTemplatesTable, "findFirst", async () => ({
      id: "template-1",
      appId: "app-org-open",
      templateType: "password_reset",
      isActive: true,
      subjectTemplate: "Template",
      htmlTemplate: "<p>{{password_reset_url}}</p>",
      textTemplate: "{{password_reset_url}}",
    })),
    patchProperty(db, "select", () => ({
      from: () => ({
        innerJoin: () => ({
          where: async () => [],
        }),
      }),
    }) as never),
    patchProperty(db, "insert", () => ({
      values: (value: any) => {
        const values = Array.isArray(value) ? value : [value];
        for (const row of values) {
          if (row?.tokenType) state.authTokens.push({ ...row, consumedAt: null });
          if (row?.email) {
            const user = {
              ...row,
              active: true,
              suspended: false,
              deletedAt: null,
              isSuperAdmin: false,
              activeOrgId: null,
              emailVerifiedAt: row.emailVerifiedAt ?? null,
            };
            state.users.set(user.id, user);
            state.usersByEmail.set(user.email, user);
          }
          if (row?.credentialType === "password") {
            state.credentialsByUserId.set(row.userId, row);
          }
        }
        return {
          returning: async () => values,
          onConflictDoUpdate: async () => undefined,
        };
      },
    }) as never),
    patchProperty(db, "update", () => ({
      set: (values: any) => ({
        where: () => {
          const firstUser = state.users.values().next().value;
          if (firstUser && "emailVerifiedAt" in values) firstUser.emailVerifiedAt = new Date();
          if (firstUser && "lastLoginAt" in values) firstUser.lastLoginAt = new Date();
          if ("consumedAt" in values) {
            const token = state.authTokens.find((row) => !row.consumedAt) ?? null;
            if (token) token.consumedAt = new Date();
          }
          return {
            returning: async () => {
              const token = state.authTokens.find((row) => row.consumedAt) ?? null;
              return token ? [token] : [];
            },
          };
        },
      }),
    }) as never),
    patchProperty(db, "delete", () => ({ where: async () => undefined }) as never),
    patchProperty(pool, "query", async () => ({ rowCount: 0, rows: [] }) as never),
  );

  return () => {
    restores.reverse().forEach((restore) => restore());
  };
}

test("org signup -> verify-email route -> MFA challenge -> onboarding -> dashboard", async () => {
  const state = buildState();
  const restore = installDbMocks(state);
  const session: Record<string, unknown> = { sessionGroup: "admin" };
  const app = createStatefulSessionApp(
    [
      { path: "/api/auth", router: authRouter },
      { path: "/api", router: invitationsRouter },
    ],
    session,
  );

  try {
    const signup = await performJsonRequest(app, "POST", "/api/auth/signup", {
      appSlug: "org-open",
      email: "owner@example.com",
      password: "Password1!",
      name: "Org Owner",
    });
    assert.equal(signup.status, 201);
    const verifyToken = signup.body?.verifyToken;
    assert.equal(typeof verifyToken, "string");

    const createdUser = state.usersByEmail.get("owner@example.com");
    assert.ok(createdUser);
    state.mfaRequiredUserIds.add(createdUser.id);
    state.mfaEnrolledUserIds.add(createdUser.id);

    const verify = await performJsonRequest(app, "POST", "/api/auth/verify-email", {
      token: verifyToken,
      appSlug: "org-open",
    });
    assert.equal(verify.status, 202);
    assert.equal(verify.body?.mfaRequired, true);
    assert.equal(verify.body?.nextPath, "/mfa/challenge");

    const mfaChallenge = await performJsonRequest(app, "POST", "/api/auth/mfa/challenge", {
      code: "RECOVERY-CODE",
      stayLoggedIn: true,
    });
    assert.equal(mfaChallenge.status, 200);
    assert.equal(mfaChallenge.body?.nextPath, "/onboarding/organization");

    state.orgAccessUserIds.add(createdUser.id);
    const postOnboardingLogin = await performJsonRequest(app, "POST", "/api/auth/login", {
      appSlug: "org-open",
      email: "owner@example.com",
      password: "Password1!",
    });
    assert.equal(postOnboardingLogin.status, 200);
    assert.equal(postOnboardingLogin.body?.nextPath, "/dashboard");
  } finally {
    restore();
  }
});

test("solo signup -> verify-email route -> authenticated destination without org onboarding", async () => {
  const state = buildState();
  const restore = installDbMocks(state);
  const session: Record<string, unknown> = { sessionGroup: "default" };
  const app = createStatefulSessionApp([{ path: "/api/auth", router: authRouter }], session);

  try {
    const signup = await performJsonRequest(app, "POST", "/api/auth/signup", {
      appSlug: "solo-app",
      email: "solo@example.com",
      password: "Password1!",
    });
    assert.equal(signup.status, 201);

    const soloUser = state.usersByEmail.get("solo@example.com");
    assert.ok(soloUser);
    state.soloAccessUserIds.add(soloUser.id);

    const verify = await performJsonRequest(app, "POST", "/api/auth/verify-email", {
      token: signup.body?.verifyToken,
      appSlug: "solo-app",
    });
    assert.equal(verify.status, 200);
    assert.equal(verify.body?.mfaRequired, false);
    assert.equal(verify.body?.nextPath, "/dashboard");
    assert.notEqual(verify.body?.nextPath, "/onboarding/organization");
  } finally {
    restore();
  }
});

test("invitation password + existing sign-in + google continuation branches preserve invitation route and post-auth stages", async () => {
  const state = buildState();
  const restore = installDbMocks(state);
  const session: Record<string, unknown> = { sessionGroup: "admin" };
  const app = createStatefulSessionApp(
    [
      { path: "/api/auth", router: authRouter },
      { path: "/api", router: invitationsRouter },
    ],
    session,
  );

  const invitationPassword = {
    id: "inv-password",
    token: "invite-password-token",
    orgId: "org-1",
    appId: "app-org-open",
    email: "invitee-password@example.com",
    invitedRole: "staff",
    invitationStatus: "pending",
    expiresAt: new Date(Date.now() + 60_000),
    acceptedAt: null,
  };
  const invitationSignin = {
    ...invitationPassword,
    id: "inv-signin",
    token: "invite-signin-token",
    email: "invitee-existing@example.com",
  };
  state.invitationsByToken.set(invitationPassword.token, invitationPassword);
  state.invitationsByToken.set(invitationSignin.token, invitationSignin);

  const existingUser = {
    id: "existing-user",
    email: "invitee-existing@example.com",
    name: "Existing Invitee",
    isSuperAdmin: false,
    active: true,
    suspended: false,
    deletedAt: null,
    activeOrgId: null,
    emailVerifiedAt: new Date(),
    googleSubject: "invitee-google-sub",
  };
  state.users.set(existingUser.id, existingUser);
  state.usersByEmail.set(existingUser.email, existingUser);
  state.usersByGoogleSubject.set(existingUser.googleSubject, existingUser);
  state.credentialsByUserId.set(existingUser.id, {
    id: "cred-existing",
    userId: existingUser.id,
    credentialType: "password",
    passwordHash: await hashPassword("Password1!"),
  });
  state.mfaRequiredUserIds.add(existingUser.id);
  state.mfaEnrolledUserIds.add(existingUser.id);

  const restoreExchange = patchProperty(authRouteDeps, "exchangeCodeForUserFn", async () => ({
    sub: "invitee-google-sub",
    email: "invitee-existing@example.com",
    name: "Existing Invitee",
  }));

  try {
    const resolvePassword = await performJsonRequest(app, "GET", "/api/invitations/invite-password-token/resolve");
    assert.equal(resolvePassword.status, 200);
    assert.equal(resolvePassword.body?.emailMode, "create_password");

    const acceptPassword = await performJsonRequest(app, "POST", "/api/invitations/invite-password-token/accept-email", {
      password: "Password1!",
    });
    assert.equal(acceptPassword.status, 202);
    assert.equal(acceptPassword.body?.mfaRequired, true);
    assert.equal(acceptPassword.body?.nextPath, "/mfa/challenge");

    const mfaAfterPassword = await performJsonRequest(app, "POST", "/api/auth/mfa/challenge", {
      code: "RECOVERY-CODE",
    });
    assert.equal(mfaAfterPassword.status, 200);
    assert.equal(mfaAfterPassword.body?.nextPath, "/onboarding/organization");

    const resolveSignin = await performJsonRequest(app, "GET", "/api/invitations/invite-signin-token/resolve");
    assert.equal(resolveSignin.status, 200);
    assert.equal(resolveSignin.body?.emailMode, "sign_in");

    const signInContinuation = await performJsonRequest(app, "POST", "/api/auth/login", {
      appSlug: "org-open",
      email: "invitee-existing@example.com",
      password: "Password1!",
      returnToPath: "/invitations/invite-signin-token/accept",
      continuationType: "invitation_acceptance",
      continuationOrgId: "org-1",
      continuationResourceId: "invite-signin-token",
    });
    assert.equal(signInContinuation.status, 202);
    assert.equal(signInContinuation.body?.nextPath, "/mfa/challenge");

    const mfaAfterSignin = await performJsonRequest(app, "POST", "/api/auth/mfa/challenge", {
      code: "RECOVERY-CODE",
    });
    assert.equal(mfaAfterSignin.status, 200);
    assert.equal(mfaAfterSignin.body?.nextPath, "/onboarding/organization");

    const googleStart = await performJsonRequest(
      app,
      "POST",
      "/api/auth/google/url",
      {
        appSlug: "org-open",
        returnToPath: "/invitations/invite-signin-token/accept",
      },
      { origin: "http://admin.local" },
    );
    assert.equal(googleStart.status, 200);
    const googleUrl = String(googleStart.body?.url ?? "");
    const stateParam = new URL(googleUrl).searchParams.get("state");
    assert.ok(stateParam);

    const googleCallback = await performJsonRequest(
      app,
      "GET",
      `/api/auth/google/callback?code=ok&state=${encodeURIComponent(String(stateParam))}`,
    );
    assert.equal(googleCallback.status, 302);
    assert.match(String(googleCallback.headers.get("location") ?? ""), /\/mfa\/challenge$/);
  } finally {
    restoreExchange();
    restore();
  }
});

test("forgot/reset password route journey invalidates stale auth and boots through fresh login", async () => {
  const state = buildState();
  const restore = installDbMocks(state);
  const session: Record<string, unknown> = {
    sessionGroup: "default",
    userId: "stale-user",
    appSlug: "solo-app",
    pendingPostAuthContinuation: {
      type: "invitation_acceptance",
      appSlug: "solo-app",
      returnPath: "/invitations/legacy/accept",
      orgId: "org-legacy",
      resourceId: "legacy",
    },
  };
  const app = createStatefulSessionApp([{ path: "/api/auth", router: authRouter }], session);

  try {
    state.users.set("stale-user", {
      id: "stale-user",
      email: "reset@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
      isSuperAdmin: false,
      activeOrgId: null,
      emailVerifiedAt: new Date(),
    });
    state.usersByEmail.set("reset@example.com", state.users.get("stale-user"));

    const forgot = await performJsonRequest(app, "POST", "/api/auth/forgot-password", {
      appSlug: "solo-app",
      email: "reset@example.com",
    });
    assert.equal(forgot.status, 200);
    assert.equal(typeof forgot.body?.resetToken, "string");

    const reset = await performJsonRequest(app, "POST", "/api/auth/reset-password", {
      token: forgot.body?.resetToken,
      password: "Password1!",
    });
    assert.equal(reset.status, 200);
    assert.equal(session.userId, undefined);
    assert.equal(session.pendingPostAuthContinuation, undefined);

    const relogin = await performJsonRequest(app, "POST", "/api/auth/login", {
      appSlug: "solo-app",
      email: "reset@example.com",
      password: "Password1!",
    });
    assert.equal(relogin.status, 200);
    assert.equal(relogin.body?.nextPath, "/dashboard");
  } finally {
    restore();
  }
});
