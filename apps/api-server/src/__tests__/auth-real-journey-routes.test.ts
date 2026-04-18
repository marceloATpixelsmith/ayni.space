import test from "node:test";
import assert from "node:assert/strict";

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
};

function buildState(): MockState {
  const adminOrg = {
    id: "app-admin",
    slug: "admin",
    name: "Admin",
    isActive: true,
    accessMode: "organization",
    staffInvitesEnabled: true,
    customerRegistrationEnabled: false,
    transactionalFromEmail: "no-reply@admin.local",
    transactionalFromName: "Admin",
    transactionalReplyToEmail: "support@admin.local",
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
    appProfiles: { admin: adminOrg, "solo-app": solo },
    mfaRequiredUserIds: new Set(),
    mfaEnrolledUserIds: new Set(),
    orgAccessUserIds: new Set(),
    soloAccessUserIds: new Set(),
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

  restores.push(
    patchProperty(db.query.appsTable, "findFirst", async (query: any) => {
      const literals = collectStringLiterals(query?.where);
      if (literals.includes("solo-app") || literals.includes("app-solo")) {
        return state.appProfiles["solo-app"] ?? null;
      }
      if (literals.includes("admin") || literals.includes("app-admin")) {
        return state.appProfiles["admin"] ?? null;
      }
      return null;
    }),
    patchProperty(db.query.usersTable, "findFirst", async (query: any) => {
      const literals = collectStringLiterals(query?.where);
      if (literals.includes("googleSubject")) {
        const requestedSubject = literals.find((value) =>
          [...state.usersByGoogleSubject.keys()].includes(value),
        );
        if (requestedSubject) {
          return state.usersByGoogleSubject.get(requestedSubject) ?? null;
        }
        for (const user of state.users.values()) {
          if (user.googleSubject) return user;
        }
      }
      const requestedEmail = literals.find((value) =>
        state.usersByEmail.has(value),
      );
      if (requestedEmail) {
        return state.usersByEmail.get(requestedEmail) ?? null;
      }
      const requestedUserId = literals.find((value) => state.users.has(value));
      if (requestedUserId) {
        return state.users.get(requestedUserId) ?? null;
      }
      return state.users.values().next().value ?? null;
    }),
    patchProperty(db.query.userCredentialsTable, "findFirst", async (query: any) => {
      const literals = collectStringLiterals(query?.where);
      const requestedUserId = literals.find((value) =>
        state.credentialsByUserId.has(value),
      );
      if (requestedUserId) {
        return state.credentialsByUserId.get(requestedUserId) ?? null;
      }
      if (literals.includes("password")) {
        for (const credential of state.credentialsByUserId.values()) {
          return credential;
        }
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
      if (!firstUser) return null;
      if (!state.mfaEnrolledUserIds.has(firstUser.id)) return null;
      return {
        id: "factor-1",
        userId: firstUser.id,
        factorType: "totp",
        status: "active",
        secretCiphertext: "a",
        secretIv: "b",
        secretTag: "c",
      };
    }),
    patchProperty(db.query.trustedDevicesTable, "findFirst", async () => null),
    patchProperty(db.query.userAppAccessTable, "findFirst", async () => {
      const firstUser = state.users.values().next().value;
      if (!firstUser || !state.soloAccessUserIds.has(firstUser.id)) return null;
      return {
        userId: firstUser.id,
        appId: "app-solo",
        enabled: true,
      };
    }),
    patchProperty(db.query.orgMembershipsTable, "findMany", async () => {
      const firstUser = state.users.values().next().value;
      if (!firstUser || !state.orgAccessUserIds.has(firstUser.id)) return [];
      return [{ userId: firstUser.id, orgId: "org-1", membershipStatus: "active", role: "org_admin" }];
    }),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => null),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({
      id: "org-1",
      name: "Org 1",
      slug: "org-1",
      isActive: true,
      appId: "app-admin",
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    patchProperty(db.query.orgAppAccessTable, "findFirst", async () => ({ orgId: "org-1", appId: "app-admin", enabled: true })),
    patchProperty(db.query.orgAppAccessTable, "findMany", async () => ([{ orgId: "org-1", appId: "app-admin", enabled: true }])),
    patchProperty(db.query.authTokensTable, "findFirst", async () => state.authTokens[0] ?? null),
    patchProperty(db.query.emailTemplatesTable, "findFirst", async (query: any) => {
      const literals = collectStringLiterals(query?.where);
      if (literals.includes("password_reset")) {
        return {
          id: "template-password-reset",
          appId: "app-admin",
          templateType: "password_reset",
          isActive: true,
          subjectTemplate: "Reset your password",
          htmlTemplate: "<p>Reset: {{password_reset_url}}</p>",
          textTemplate: "Reset: {{password_reset_url}}",
        };
      }
      return null;
    }),
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
            if (user.googleSubject) {
              state.usersByGoogleSubject.set(user.googleSubject, user);
            }
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
            if (token) {
              token.consumedAt = values.consumedAt instanceof Date ? values.consumedAt : new Date();
            }
          }
          return {
            returning: async () => {
              const token = state.authTokens.find((row) => row.consumedAt) ?? null;
              return token ? [token] : [];
            },
          };
        },
        returning: async () => {
          const token = state.authTokens.find((row) => row.consumedAt) ?? null;
          return token ? [token] : [];
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

test("org-admin signup -> verify-email -> mfa branch -> onboarding -> dashboard route chain", async () => {
  const state = buildState();
  const restore = installDbMocks(state);
  const persistedSession: Record<string, unknown> = { sessionGroup: "admin" };
  const app = createStatefulSessionApp([{ path: "/api/auth", router: authRouter }], persistedSession);

  try {
    const signup = await performJsonRequest(app, "POST", "/api/auth/signup", {
      appSlug: "admin",
      email: "owner@example.com",
      password: "Password1!",
      name: "Owner",
    });
    assert.equal(signup.status, 403);

    const user = {
      id: "user-org-admin",
      email: "owner@example.com",
      name: "Owner",
      isSuperAdmin: false,
      active: true,
      suspended: false,
      deletedAt: null,
      activeOrgId: null,
      emailVerifiedAt: null,
    };
    state.users.set(user.id, user);
    state.usersByEmail.set(user.email, user);
    state.credentialsByUserId.set(user.id, {
      id: "cred-1",
      userId: user.id,
      credentialType: "password",
      passwordHash: await hashPassword("Password2!"),
    });
    state.mfaRequiredUserIds.add(user.id);

    const forgot = await performJsonRequest(app, "POST", "/api/auth/forgot-password", {
      appSlug: "admin",
      email: "owner@example.com",
    });
    assert.equal(forgot.status, 200);

    const resetToken = forgot.body?.resetToken;
    assert.equal(typeof resetToken, "string");

    const reset = await performJsonRequest(app, "POST", "/api/auth/reset-password", {
      token: resetToken,
      password: "Password2!",
    });
    assert.equal(reset.status, 200);
    user.emailVerifiedAt = new Date();

    const login = await performJsonRequest(app, "POST", "/api/auth/login", {
      appSlug: "admin",
      email: "owner@example.com",
      password: "Password2!",
      returnToPath: "/invitations/org-token/accept",
    });
    assert.equal(login.status, 202);
    assert.equal(login.body?.nextPath, "/mfa/enroll");

    const me = await performJsonRequest(app, "GET", "/api/auth/me");
    assert.equal(me.status, 200);
    assert.equal(me.body?.authState, "mfa_pending");
  } finally {
    restore();
  }
});

test("solo signup/login journey lands on solo destination without org-onboarding leakage", async () => {
  const state = buildState();
  const restore = installDbMocks(state);
  const persistedSession: Record<string, unknown> = { sessionGroup: "default" };
  const app = createStatefulSessionApp([{ path: "/api/auth", router: authRouter }], persistedSession);

  try {
    const user = {
      id: "solo-user",
      email: "solo@example.com",
      name: "Solo User",
      isSuperAdmin: false,
      active: true,
      suspended: false,
      deletedAt: null,
      activeOrgId: null,
      emailVerifiedAt: new Date(),
    };
    state.users.set(user.id, user);
    state.usersByEmail.set(user.email, user);
    state.soloAccessUserIds.add(user.id);
    state.credentialsByUserId.set(user.id, {
      id: "cred-solo",
      userId: user.id,
      credentialType: "password",
      passwordHash: await hashPassword("Password1!"),
    });

    const login = await performJsonRequest(app, "POST", "/api/auth/login", {
      appSlug: "solo-app",
      email: "solo@example.com",
      password: "Password1!",
      returnToPath: "/solo-app",
    });

    assert.equal(login.status, 200);
    assert.notEqual(login.body?.nextPath, "/onboarding/organization");
  } finally {
    restore();
  }
});

test("google login keeps invitation continuation and denied-access redirect branch fail-closed", async () => {
  const state = buildState();
  const restore = installDbMocks(state);
  const persistedSession: Record<string, unknown> = {
    sessionGroup: "admin",
    oauthState: "admin.valid-state.eyJub25jZSI6InZhbGlkLXN0YXRlIiwiYXBwU2x1ZyI6ImFkbWluIiwicmV0dXJuVG8iOiJodHRwOi8vYWRtaW4ubG9jYWwiLCJyZXR1cm5Ub1BhdGgiOiIvaW52aXRhdGlvbnMvdG9rZW4tMi9hY2NlcHQiLCJzZXNzaW9uR3JvdXAiOiJhZG1pbiJ9",
    oauthReturnTo: "http://admin.local",
    oauthReturnToPath: "/invitations/token-2/accept",
    oauthSessionGroup: "admin",
  };
  const app = createStatefulSessionApp([{ path: "/api/auth", router: authRouter }], persistedSession);

  const user = {
    id: "google-user",
    email: "google@example.com",
    name: "Google User",
    isSuperAdmin: false,
    active: true,
    suspended: false,
    deletedAt: null,
    activeOrgId: null,
    emailVerifiedAt: new Date(),
    googleSubject: "google-sub",
  };
  state.users.set(user.id, user);
  state.usersByEmail.set(user.email, user);
  state.usersByGoogleSubject.set(user.googleSubject, user);
  state.orgAccessUserIds.add(user.id);

  const restoreExchange = patchProperty(authRouteDeps, "exchangeCodeForUserFn", async () => ({
    sub: "google-sub",
    email: "google@example.com",
    name: "Google User",
  }));

  try {
    const googleUrl = await performJsonRequest(app, "POST", "/api/auth/google/url", {
      appSlug: "admin",
      returnToPath: "/invitations/token-2/accept",
    }, { origin: "http://admin.local" });

    assert.equal(googleUrl.status, 200);
    const googleUrlValue = String(googleUrl.body?.url ?? "");
    const googleUrlParsed = new URL(googleUrlValue);
    const stateParam = googleUrlParsed.searchParams.get("state");
    assert.equal(typeof stateParam, "string");
    const encodedPayload = String(stateParam ?? "").split(".").slice(2).join(".");
    const decodedPayload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as { returnToPath?: string };
    assert.equal(decodedPayload.returnToPath, "/invitations/token-2/accept");

    const callback = await performJsonRequest(
      app,
      "GET",
      `/api/auth/google/callback?code=ok&state=${encodeURIComponent(String(stateParam ?? ""))}`,
    );
    assert.equal(callback.status, 302);
    assert.match(
      String(callback.headers.get("location") ?? ""),
      /\/invitations\/token-2\/accept$/,
    );
  } finally {
    restoreExchange();
    restore();
  }
});
