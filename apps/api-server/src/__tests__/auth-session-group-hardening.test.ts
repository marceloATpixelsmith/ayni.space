import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { RequestHandler } from "express";

import { createMountedSessionApp, ensureTestDatabaseEnv, patchProperty } from "./helpers.js";

ensureTestDatabaseEnv();

const { db } = await import("@workspace/db");

process.env["ALLOWED_ORIGINS"] = "http://admin.local,http://workspace.local";
process.env["ADMIN_FRONTEND_ORIGINS"] = "http://admin.local";
process.env["SESSION_GROUP_COOKIE_NAMES"] = "admin=saas.admin.sid,default=saas.workspace.sid";
process.env["SESSION_SECRET"] ??= "test-secret";

const { default: authRouter } = await import("../routes/auth.js");
const { authRouteDeps } = await import("../routes/auth.js");
const sessionLib = await import("../lib/session.js");
const sessionGroupLib = await import("../lib/sessionGroup.js");
const { createSecurityEnforcementMiddleware } = await import("../lib/securityPolicy.js");
const { default: adminRouter } = await import("../routes/admin.js");
const ADMIN_OAUTH_STATE = "admin.valid-state.eyJub25jZSI6InZhbGlkLXN0YXRlIiwiYXBwU2x1ZyI6ImFkbWluIiwicmV0dXJuVG8iOiJodHRwOi8vYWRtaW4ubG9jYWwiLCJzZXNzaW9uR3JvdXAiOiJhZG1pbiJ9";

async function request(
  app: ReturnType<typeof createMountedSessionApp>,
  path: string,
  options: {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
  } = {},
) {
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind server");

  try {
    return await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: options.method ?? "GET",
      headers: options.headers,
      redirect: "manual",
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

function stubDbForCallback(isSuperAdmin: boolean) {
  const user = {
    id: isSuperAdmin ? "super-user" : "non-super-user",
    email: isSuperAdmin ? "super@example.com" : "user@example.com",
    name: "User",
    avatarUrl: null,
    activeOrgId: null,
    isSuperAdmin,
  };

  return [
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "admin-app",
      slug: "admin",
      isActive: true,
      accessMode: "superadmin",
      onboardingMode: false,
    })),
    patchProperty(db.query.usersTable, "findFirst", async () => user),
    patchProperty(db, "update", () => ({
      set: () => ({
        where: async () => ({})
      })
    }) as never),
  ];
}

function stubDbForCallbackSequence(options: {
  bySubjectUser: any | null;
  byEmailUser: any | null;
  updateReturnsUser?: any | null;
  isSuperadminApp?: boolean;
}) {
  const lookupCalls: string[] = [];
  const insertedRows: Array<Record<string, unknown>> = [];
  const updatedSets: Array<Record<string, unknown>> = [];
  const updatedWhereIds: Array<string> = [];
  let userLookupCount = 0;

  const restore = [
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "admin-app",
      slug: "admin",
      isActive: true,
      accessMode: options.isSuperadminApp === false ? "organization" : "superadmin",
      onboardingMode: false,
    })),
    patchProperty(db.query.usersTable, "findFirst", async (query: any) => {
      userLookupCount += 1;
      if (userLookupCount === 1) {
        lookupCalls.push("subject");
        return options.bySubjectUser;
      }
      if (userLookupCount === 2) {
        lookupCalls.push("email");
        return options.byEmailUser;
      }
      return options.bySubjectUser ?? options.byEmailUser;
    }),
    patchProperty(db, "update", () => ({
      set: (values: Record<string, unknown>) => {
        updatedSets.push(values);
        return {
          where: (clause: any) => ({
            returning: async () => {
              updatedWhereIds.push(String(clause));
              return options.updateReturnsUser ? [options.updateReturnsUser] : [];
            },
            then: async (resolve: (value: unknown) => unknown) => resolve({}),
          }),
        };
      },
    }) as never),
    patchProperty(db, "insert", (_table: any) => ({
      values: (row: Record<string, unknown>) => {
        if ("email" in row && "isSuperAdmin" in row) {
          insertedRows.push(row);
          return {
            returning: async () => [{ id: "created-user", ...row }],
          };
        }
        return {
          catch: () => undefined,
        };
      },
    }) as never),
  ];

  return { restore, lookupCalls, insertedRows, updatedSets, updatedWhereIds };
}

test("session-group resolver maps admin and default origins", () => {
  assert.equal(sessionGroupLib.resolveSessionGroupFromOrigin("http://admin.local"), sessionGroupLib.SESSION_GROUPS.ADMIN);
  assert.equal(sessionGroupLib.resolveSessionGroupFromOrigin("http://workspace.local"), sessionGroupLib.SESSION_GROUPS.DEFAULT);
  assert.equal(sessionGroupLib.getSessionCookieNameForGroup(sessionGroupLib.SESSION_GROUPS.ADMIN), "saas.admin.sid");
  assert.equal(sessionGroupLib.getSessionCookieNameForGroup(sessionGroupLib.SESSION_GROUPS.DEFAULT), "saas.workspace.sid");
  assert.equal(sessionLib.buildSessionOptions("secret", sessionGroupLib.SESSION_GROUPS.ADMIN).name, "saas.admin.sid");
  assert.equal(sessionLib.buildSessionOptions("secret", sessionGroupLib.SESSION_GROUPS.DEFAULT).name, "saas.workspace.sid");
});



test("session-group resolver infers admin group from admin.* host fallback", () => {
  const prevAdminOrigins = process.env["ADMIN_FRONTEND_ORIGINS"];
  delete process.env["ADMIN_FRONTEND_ORIGINS"];

  try {
    assert.equal(sessionGroupLib.resolveSessionGroupFromOrigin("https://admin.ayni.space"), sessionGroupLib.SESSION_GROUPS.ADMIN);
    assert.equal(sessionGroupLib.resolveSessionGroupFromOrigin("https://admin.preview.ayni.space"), sessionGroupLib.SESSION_GROUPS.ADMIN);
    assert.equal(sessionGroupLib.resolveSessionGroupFromOrigin("https://workspace.ayni.space"), sessionGroupLib.SESSION_GROUPS.DEFAULT);
  } finally {
    if (prevAdminOrigins === undefined) delete process.env["ADMIN_FRONTEND_ORIGINS"];
    else process.env["ADMIN_FRONTEND_ORIGINS"] = prevAdminOrigins;
  }
});

test("production session cookie config defaults to SameSite=None with secure=true", () => {
  const prevNodeEnv = process.env["NODE_ENV"];
  const prevSameSite = process.env["SESSION_COOKIE_SAME_SITE"];

  process.env["NODE_ENV"] = "production";
  delete process.env["SESSION_COOKIE_SAME_SITE"];

  try {
    const options = sessionLib.getSessionCookieOptions();
    assert.equal(options.sameSite, "none");
    assert.equal(options.secure, true);
  } finally {
    if (prevNodeEnv === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = prevNodeEnv;
    if (prevSameSite === undefined) delete process.env["SESSION_COOKIE_SAME_SITE"];
    else process.env["SESSION_COOKIE_SAME_SITE"] = prevSameSite;
  }
});
test("admin oauth start derives admin context and emits oauth-state trace log", async () => {
  const logs: unknown[][] = [];
  const prevClientId = process.env["GOOGLE_CLIENT_ID"];
  const prevClientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  const prevRedirect = process.env["GOOGLE_REDIRECT_URI"];
  process.env["GOOGLE_CLIENT_ID"] = "test-google-client-id";
  process.env["GOOGLE_CLIENT_SECRET"] = "test-google-client-secret";
  process.env["GOOGLE_REDIRECT_URI"] = "http://api.local/api/auth/google/callback";
  const restore: Array<() => void> = [
    patchProperty(console, "log", (...args: unknown[]) => {
      logs.push(args);
    }),
  ];

  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }]);
    const response = await request(app, "/api/auth/google/url", {
      method: "POST",
      headers: {
        referer: "http://admin.local/login",
      },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { url: string };
    const state = new URL(body.url).searchParams.get("state");
    assert.ok(state);
    const segments = state.split(".");
    const payload = JSON.parse(Buffer.from(segments.slice(2).join("."), "base64url").toString("utf8"));
    assert.equal(payload.appSlug, "admin");
    assert.equal(payload.sessionGroup, "admin");
    assert.equal(payload.returnTo, "http://admin.local");

    const oauthStateTrace = logs
      .map((entry) => String(entry[0]))
      .find((line) => line.includes("[AUTH-CHECK-TRACE] OAUTH STATE CREATED"));
    assert.ok(oauthStateTrace);
    assert.match(oauthStateTrace, /appSlug=admin/);
    assert.match(oauthStateTrace, /returnTo=http:\/\/admin\.local/);
    assert.match(oauthStateTrace, /sessionGroup=admin/);
  } finally {
    for (const undo of restore.reverse()) undo();
    if (prevClientId === undefined) delete process.env["GOOGLE_CLIENT_ID"];
    else process.env["GOOGLE_CLIENT_ID"] = prevClientId;
    if (prevClientSecret === undefined) delete process.env["GOOGLE_CLIENT_SECRET"];
    else process.env["GOOGLE_CLIENT_SECRET"] = prevClientSecret;
    if (prevRedirect === undefined) delete process.env["GOOGLE_REDIRECT_URI"];
    else process.env["GOOGLE_REDIRECT_URI"] = prevRedirect;
  }
});

test("admin oauth start ignores conflicting APP_SLUG_BY_ORIGIN mapping and keeps admin context", async () => {
  const prevMap = process.env["APP_SLUG_BY_ORIGIN"];
  process.env["APP_SLUG_BY_ORIGIN"] = "http://admin.local=workspace";

  const prevClientId = process.env["GOOGLE_CLIENT_ID"];
  const prevClientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  const prevRedirect = process.env["GOOGLE_REDIRECT_URI"];
  process.env["GOOGLE_CLIENT_ID"] = "test-google-client-id";
  process.env["GOOGLE_CLIENT_SECRET"] = "test-google-client-secret";
  process.env["GOOGLE_REDIRECT_URI"] = "http://api.local/api/auth/google/callback";

  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }]);
    const response = await request(app, "/api/auth/google/url", {
      method: "POST",
      headers: {
        origin: "http://admin.local",
      },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { url: string };
    const state = new URL(body.url).searchParams.get("state");
    assert.ok(state);
    const segments = state.split(".");
    const payload = JSON.parse(Buffer.from(segments.slice(2).join("."), "base64url").toString("utf8"));
    assert.equal(payload.appSlug, "admin");
    assert.equal(payload.sessionGroup, "admin");
    assert.equal(payload.returnTo, "http://admin.local");
  } finally {
    if (prevMap === undefined) delete process.env["APP_SLUG_BY_ORIGIN"];
    else process.env["APP_SLUG_BY_ORIGIN"] = prevMap;
    if (prevClientId === undefined) delete process.env["GOOGLE_CLIENT_ID"];
    else process.env["GOOGLE_CLIENT_ID"] = prevClientId;
    if (prevClientSecret === undefined) delete process.env["GOOGLE_CLIENT_SECRET"];
    else process.env["GOOGLE_CLIENT_SECRET"] = prevClientSecret;
    if (prevRedirect === undefined) delete process.env["GOOGLE_REDIRECT_URI"];
    else process.env["GOOGLE_REDIRECT_URI"] = prevRedirect;
  }
});

test("admin oauth start derives admin context from forwarded host when origin/referer are unavailable", async () => {
  const prevClientId = process.env["GOOGLE_CLIENT_ID"];
  const prevClientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  const prevRedirect = process.env["GOOGLE_REDIRECT_URI"];
  process.env["GOOGLE_CLIENT_ID"] = "test-google-client-id";
  process.env["GOOGLE_CLIENT_SECRET"] = "test-google-client-secret";
  process.env["GOOGLE_REDIRECT_URI"] = "http://api.local/api/auth/google/callback";

  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }]);
    const response = await request(app, "/api/auth/google/url", {
      method: "POST",
      headers: {
        "x-forwarded-host": "admin.local",
        "x-forwarded-proto": "http",
      },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { url: string };
    const state = new URL(body.url).searchParams.get("state");
    assert.ok(state);
    const segments = state.split(".");
    const payload = JSON.parse(Buffer.from(segments.slice(2).join("."), "base64url").toString("utf8"));
    assert.equal(payload.appSlug, "admin");
    assert.equal(payload.sessionGroup, "admin");
    assert.equal(payload.returnTo, "http://admin.local");
  } finally {
    if (prevClientId === undefined) delete process.env["GOOGLE_CLIENT_ID"];
    else process.env["GOOGLE_CLIENT_ID"] = prevClientId;
    if (prevClientSecret === undefined) delete process.env["GOOGLE_CLIENT_SECRET"];
    else process.env["GOOGLE_CLIENT_SECRET"] = prevClientSecret;
    if (prevRedirect === undefined) delete process.env["GOOGLE_REDIRECT_URI"];
    else process.env["GOOGLE_REDIRECT_URI"] = prevRedirect;
  }
});

test("super admin oauth callback in admin group lands on /dashboard", async () => {
  const restore: Array<() => void> = [
    patchProperty(authRouteDeps, "exchangeCodeForUserFn", async () => ({ sub: "sub", email: "super@example.com", name: "Super" })),
    ...stubDbForCallback(true),
  ];

  let destroyed = false;
  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {
      oauthState: ADMIN_OAUTH_STATE,
      oauthReturnTo: "http://admin.local",
      oauthSessionGroup: "admin",
      destroy: (cb?: (err?: unknown) => void) => {
        destroyed = true;
        cb?.();
      },
    });

    const response = await request(app, "/api/auth/google/callback?code=ok&state=admin.valid-state.eyJub25jZSI6InZhbGlkLXN0YXRlIiwiYXBwU2x1ZyI6ImFkbWluIiwicmV0dXJuVG8iOiJodHRwOi8vYWRtaW4ubG9jYWwiLCJzZXNzaW9uR3JvdXAiOiJhZG1pbiJ9");
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "http://admin.local/dashboard");
    assert.equal(destroyed, false);
  } finally {
    for (const undo of restore.reverse()) undo();
  }
});

test("non-super-admin oauth callback in admin group is denied and only admin cookie is cleared", async () => {
  const restore: Array<() => void> = [
    patchProperty(authRouteDeps, "exchangeCodeForUserFn", async () => ({ sub: "sub", email: "user@example.com", name: "User" })),
    ...stubDbForCallback(false),
  ];

  let destroyedAdminSession = false;
  let destroyedWorkspaceSession = false;

  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {
      oauthState: ADMIN_OAUTH_STATE,
      oauthReturnTo: "http://admin.local",
      oauthSessionGroup: "admin",
      destroy: (cb?: (err?: unknown) => void) => {
        destroyedAdminSession = true;
        cb?.();
      },
    });

    const response = await request(app, "/api/auth/google/callback?code=ok&state=admin.valid-state.eyJub25jZSI6InZhbGlkLXN0YXRlIiwiYXBwU2x1ZyI6ImFkbWluIiwicmV0dXJuVG8iOiJodHRwOi8vYWRtaW4ubG9jYWwiLCJzZXNzaW9uR3JvdXAiOiJhZG1pbiJ9");
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "http://admin.local/login?error=access_denied");
    assert.equal(destroyedAdminSession, true);
    assert.equal(destroyedWorkspaceSession, false);

    const setCookie = response.headers.get("set-cookie") ?? "";
    assert.match(setCookie, new RegExp(`${sessionLib.getSessionCookieName("admin")}=;`, "i"));
    assert.doesNotMatch(setCookie, /saas\.workspace\.sid=;/i);
  } finally {
    for (const undo of restore.reverse()) undo();
  }
});

test("non-super-admin admin callback fails closed when admin app lookup is unavailable", async () => {
  const restore: Array<() => void> = [
    patchProperty(authRouteDeps, "exchangeCodeForUserFn", async () => ({ sub: "sub", email: "user@example.com", name: "User" })),
    ...stubDbForCallback(false),
    patchProperty(db.query.appsTable, "findFirst", async () => {
      throw new Error("ECONNREFUSED");
    }),
  ];

  let destroyedAdminSession = false;

  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {
      oauthState: ADMIN_OAUTH_STATE,
      oauthReturnTo: "http://admin.local",
      oauthSessionGroup: "admin",
      destroy: (cb?: (err?: unknown) => void) => {
        destroyedAdminSession = true;
        cb?.();
      },
    });

    const response = await request(app, "/api/auth/google/callback?code=ok&state=admin.valid-state.eyJub25jZSI6InZhbGlkLXN0YXRlIiwiYXBwU2x1ZyI6ImFkbWluIiwicmV0dXJuVG8iOiJodHRwOi8vYWRtaW4ubG9jYWwiLCJzZXNzaW9uR3JvdXAiOiJhZG1pbiJ9");
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "http://admin.local/login?error=access_denied");
    assert.equal(destroyedAdminSession, true);

    const setCookie = response.headers.get("set-cookie") ?? "";
    assert.match(setCookie, new RegExp(`${sessionLib.getSessionCookieName("admin")}=;`, "i"));
    assert.doesNotMatch(setCookie, /saas\.workspace\.sid=;/i);
  } finally {
    for (const undo of restore.reverse()) undo();
  }
});

test("pre-provisioned superadmin with null google_subject binds successfully on first login", async () => {
  const existingUser = {
    id: "super-user",
    email: "super@example.com",
    name: "Super User",
    avatarUrl: null,
    activeOrgId: null,
    isSuperAdmin: true,
    googleSubject: null,
  };
  const boundUser = { ...existingUser, googleSubject: "google-super-sub" };

  const { restore, lookupCalls, insertedRows, updatedSets } = stubDbForCallbackSequence({
    bySubjectUser: null,
    byEmailUser: existingUser,
    updateReturnsUser: boundUser,
  });
  restore.unshift(
    patchProperty(authRouteDeps, "exchangeCodeForUserFn", async () => ({
      sub: "google-super-sub",
      email: "SUPER@example.com",
      name: "Super",
    })),
  );

  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {
      oauthState: ADMIN_OAUTH_STATE,
      oauthReturnTo: "http://admin.local",
      oauthSessionGroup: "admin",
    });

    const response = await request(app, "/api/auth/google/callback?code=ok&state=admin.valid-state.eyJub25jZSI6InZhbGlkLXN0YXRlIiwiYXBwU2x1ZyI6ImFkbWluIiwicmV0dXJuVG8iOiJodHRwOi8vYWRtaW4ubG9jYWwiLCJzZXNzaW9uR3JvdXAiOiJhZG1pbiJ9");
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "http://admin.local/dashboard");
    assert.deepEqual(lookupCalls, ["subject", "email"]);
    assert.equal(insertedRows.length, 0);
    assert.equal(updatedSets.some((values) => values.googleSubject === "google-super-sub"), true);
    assert.equal(updatedSets.some((values) => values.lastLoginAt instanceof Date), true);
  } finally {
    for (const undo of restore.reverse()) undo();
  }
});

test("pre-provisioned non-superadmin is denied in superadmin mode", async () => {
  const existingUser = {
    id: "non-super-user",
    email: "user@example.com",
    name: "User",
    avatarUrl: null,
    activeOrgId: null,
    isSuperAdmin: false,
    googleSubject: null,
  };
  const boundUser = { ...existingUser, googleSubject: "google-user-sub" };
  const { restore, lookupCalls, insertedRows, updatedSets } = stubDbForCallbackSequence({
    bySubjectUser: null,
    byEmailUser: existingUser,
    updateReturnsUser: boundUser,
  });
  restore.unshift(
    patchProperty(authRouteDeps, "exchangeCodeForUserFn", async () => ({
      sub: "google-user-sub",
      email: "user@example.com",
      name: "User",
    })),
  );

  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {
      oauthState: ADMIN_OAUTH_STATE,
      oauthReturnTo: "http://admin.local",
      oauthSessionGroup: "admin",
      destroy: (cb?: (err?: unknown) => void) => cb?.(),
    });

    const response = await request(app, "/api/auth/google/callback?code=ok&state=admin.valid-state.eyJub25jZSI6InZhbGlkLXN0YXRlIiwiYXBwU2x1ZyI6ImFkbWluIiwicmV0dXJuVG8iOiJodHRwOi8vYWRtaW4ubG9jYWwiLCJzZXNzaW9uR3JvdXAiOiJhZG1pbiJ9");
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "http://admin.local/login?error=access_denied");
    assert.deepEqual(lookupCalls, ["subject", "email"]);
    assert.equal(insertedRows.length, 0);
    assert.equal(updatedSets.some((values) => values.googleSubject === "google-user-sub"), true);
  } finally {
    for (const undo of restore.reverse()) undo();
  }
});

test("unknown user in superadmin mode is denied without creating a user row", async () => {
  const { restore, lookupCalls, insertedRows } = stubDbForCallbackSequence({
    bySubjectUser: null,
    byEmailUser: null,
  });
  restore.unshift(
    patchProperty(authRouteDeps, "exchangeCodeForUserFn", async () => ({
      sub: "unknown-sub",
      email: "unknown@example.com",
      name: "Unknown",
    })),
  );

  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {
      oauthState: ADMIN_OAUTH_STATE,
      oauthReturnTo: "http://admin.local",
      oauthSessionGroup: "admin",
      destroy: (cb?: (err?: unknown) => void) => cb?.(),
    });

    const response = await request(app, "/api/auth/google/callback?code=ok&state=admin.valid-state.eyJub25jZSI6InZhbGlkLXN0YXRlIiwiYXBwU2x1ZyI6ImFkbWluIiwicmV0dXJuVG8iOiJodHRwOi8vYWRtaW4ubG9jYWwiLCJzZXNzaW9uR3JvdXAiOiJhZG1pbiJ9");
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "http://admin.local/login?error=access_denied");
    assert.deepEqual(lookupCalls, ["subject", "email"]);
    assert.equal(insertedRows.length, 0);
  } finally {
    for (const undo of restore.reverse()) undo();
  }
});

test("second login matches by subject directly for pre-provisioned superadmin", async () => {
  const subjectUser = {
    id: "super-user",
    email: "super@example.com",
    name: "Super User",
    avatarUrl: null,
    activeOrgId: null,
    isSuperAdmin: true,
    googleSubject: "google-super-sub",
    active: true,
    suspended: false,
  };

  const { restore, lookupCalls, insertedRows, updatedSets } = stubDbForCallbackSequence({
    bySubjectUser: subjectUser,
    byEmailUser: null,
    updateReturnsUser: null,
  });
  restore.unshift(
    patchProperty(authRouteDeps, "exchangeCodeForUserFn", async () => ({
      sub: "google-super-sub",
      email: "super@example.com",
      name: "Super",
    })),
  );

  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {
      oauthState: ADMIN_OAUTH_STATE,
      oauthReturnTo: "http://admin.local",
      oauthSessionGroup: "admin",
    });

    const response = await request(app, "/api/auth/google/callback?code=ok&state=admin.valid-state.eyJub25jZSI6InZhbGlkLXN0YXRlIiwiYXBwU2x1ZyI6ImFkbWluIiwicmV0dXJuVG8iOiJodHRwOi8vYWRtaW4ubG9jYWwiLCJzZXNzaW9uR3JvdXAiOiJhZG1pbiJ9");
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "http://admin.local/dashboard");
    assert.equal(lookupCalls[0], "subject");
    assert.equal(insertedRows.length, 0);
    assert.equal(updatedSets.some((values) => values.googleSubject === "google-super-sub"), false);
    assert.equal(updatedSets.some((values) => values.lastLoginAt instanceof Date), true);
  } finally {
    for (const undo of restore.reverse()) undo();
  }
});

test("superadmin callback + downstream admin check emit trace checkpoints and allow protected route", async () => {
  const logs: unknown[][] = [];
  const superUser = {
    id: "super-user",
    email: "super@example.com",
    name: "Super User",
    avatarUrl: null,
    activeOrgId: null,
    isSuperAdmin: true,
    googleSubject: "sub",
    active: true,
    suspended: false,
  };
  const restore: Array<() => void> = [
    patchProperty(console, "log", (...args: unknown[]) => {
      logs.push(args);
    }),
    patchProperty(authRouteDeps, "exchangeCodeForUserFn", async () => ({ sub: "sub", email: "super@example.com", name: "Super" })),
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "admin-app",
      slug: "admin",
      isActive: true,
      accessMode: "superadmin",
      onboardingMode: false,
    })),
    patchProperty(db.query.usersTable, "findFirst", async () => superUser),
    patchProperty(db, "update", () => ({
      set: () => ({
        where: async () => ({})
      })
    }) as never),
    patchProperty(db, "select", () => ({
      from: async () => [{ count: 1 }],
    }) as never),
  ];

  try {
    const authApp = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {
      oauthState: ADMIN_OAUTH_STATE,
      oauthReturnTo: "http://admin.local",
      oauthSessionGroup: "admin",
    });

    const callbackResponse = await request(authApp, "/api/auth/google/callback?code=ok&state=admin.valid-state.eyJub25jZSI6InZhbGlkLXN0YXRlIiwiYXBwU2x1ZyI6ImFkbWluIiwicmV0dXJuVG8iOiJodHRwOi8vYWRtaW4ubG9jYWwiLCJzZXNzaW9uR3JvdXAiOiJhZG1pbiJ9");
    assert.equal(callbackResponse.status, 302);
    assert.equal(callbackResponse.headers.get("location"), "http://admin.local/dashboard");

    const adminApp = createMountedSessionApp([], {
      userId: "super-user",
      sessionGroup: "admin",
    });
    adminApp.use(createSecurityEnforcementMiddleware());
    adminApp.use("/api/admin", adminRouter);
    const adminResponse = await request(adminApp, "/api/admin/stats");
    assert.equal(adminResponse.status, 200);

    const traceLogs = logs
      .filter((entry) => typeof entry[0] === "string" && entry[0].includes("[SUPERADMIN-AUTH-TRACE]"))
      .map((entry) => String(entry[0]));
    const authCheckLogs = logs
      .filter((entry) => typeof entry[0] === "string" && entry[0].includes("[AUTH-CHECK-TRACE]"));
    assert.equal(traceLogs.some((line) => line.includes("A. CALLBACK ENTRY")), true);
    assert.equal(traceLogs.some((line) => line.includes("B. APP LOOKUP RESULT")), true);
    assert.equal(traceLogs.some((line) => line.includes("D1. SUBJECT LOOKUP AFTER")), true);
    assert.equal(traceLogs.some((line) => line.includes("G. FINAL USER CHOSEN FOR AUTH")), true);
    assert.equal(traceLogs.some((line) => line.includes("H. ACCESS PROFILE DECISION")), true);
    assert.equal(traceLogs.some((line) => line.includes("G0. SESSION WRITE BEFORE")), true);
    assert.equal(traceLogs.some((line) => line.includes("G1. SESSION WRITE AFTER")), true);
    assert.equal(traceLogs.some((line) => line.includes("J. CALLBACK EXIT")), true);

    const callbackBefore = authCheckLogs
      .map((entry) => String(entry[0]))
      .find((line) => line.includes("[AUTH-CHECK-TRACE] CALLBACK SESSION WRITE BEFORE_SAVE"));
    assert.ok(callbackBefore);
    assert.match(callbackBefore, /sessionGroup=admin/);
    assert.match(callbackBefore, /userId=super-user/);
    assert.match(callbackBefore, /isSuperAdmin=true/);
    assert.match(callbackBefore, /appSlug=admin/);
    assert.match(callbackBefore, /sessionKeys=.*userId/);

    const callbackAfter = authCheckLogs
      .map((entry) => String(entry[0]))
      .find((line) => line.includes("[AUTH-CHECK-TRACE] CALLBACK SESSION WRITE AFTER_SAVE"));
    assert.ok(callbackAfter);
    assert.match(callbackAfter, /sessionGroup=admin/);
    assert.match(callbackAfter, /userId=super-user/);
    assert.match(callbackAfter, /appSlug=admin/);
    assert.match(callbackAfter, /sessionKeys=.*userId/);

    const firstAuthRequest = authCheckLogs
      .map((entry) => String(entry[0]))
      .find((line) => line.includes("[AUTH-CHECK-TRACE] FIRST AUTH REQUEST"));
    assert.ok(firstAuthRequest);
    assert.match(firstAuthRequest, /cookieHeaderPresent=false/);
    assert.match(firstAuthRequest, /sessionId=test-session-id/);
    assert.match(firstAuthRequest, /sessionGroup=admin/);
    assert.match(firstAuthRequest, /allow=true/);
    assert.match(firstAuthRequest, /sessionKeys=.*userId/);

    const adminGuard = authCheckLogs
      .map((entry) => String(entry[0]))
      .find((line) => line.includes("[AUTH-CHECK-TRACE] ADMIN GUARD"));
    assert.ok(adminGuard);
    assert.match(adminGuard, /sessionGroup=admin/);
    assert.match(adminGuard, /allow=true/);
  } finally {
    for (const undo of restore.reverse()) undo();
  }
});



test("superadmin callback persists identity fields across next request and allows admin guard", async () => {
  const logs: unknown[][] = [];
  const persistedSession: Record<string, unknown> = {
    oauthState: ADMIN_OAUTH_STATE,
    oauthReturnTo: "http://admin.local",
    oauthSessionGroup: "admin",
  };

  const restore: Array<() => void> = [
    patchProperty(console, "log", (...args: unknown[]) => {
      logs.push(args);
    }),
    patchProperty(authRouteDeps, "exchangeCodeForUserFn", async () => ({ sub: "sub", email: "super@example.com", name: "Super" })),
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "admin-app",
      slug: "admin",
      isActive: true,
      accessMode: "superadmin",
      onboardingMode: false,
    })),
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "super-user",
      email: "super@example.com",
      name: "Super",
      avatarUrl: null,
      activeOrgId: null,
      isSuperAdmin: true,
      googleSubject: "sub",
      active: true,
      suspended: false,
      deletedAt: null,
    })),
    patchProperty(db, "update", () => ({
      set: () => ({
        where: async () => ({}),
      }),
    }) as never),
    patchProperty(db, "select", () => ({
      from: async () => [{ count: 1 }],
    }) as never),
  ];

  try {
    const app = express();
    app.use((req, _res, next) => {
      (req as unknown as { session: Record<string, unknown> }).session = {
        id: "test-session-id",
        destroy: (cb?: (err?: unknown) => void) => cb?.(),
        save(this: Record<string, unknown>, cb?: (err?: unknown) => void) {
          Object.assign(persistedSession, this);
          cb?.();
        },
        regenerate(this: Record<string, unknown>, cb?: (err?: unknown) => void) {
          for (const key of Object.keys(this)) {
            delete this[key];
          }
          this.id = "regenerated-session-id";
          this.destroy = (done?: (err?: unknown) => void) => done?.();
          this.save = (done?: (err?: unknown) => void) => {
            Object.assign(persistedSession, this);
            done?.();
          };
          this.regenerate = (done?: (err?: unknown) => void) => done?.();
          cb?.();
        },
        ...persistedSession,
      };
      next();
    });
    app.use("/api/auth", authRouter);
    app.use(createSecurityEnforcementMiddleware());
    app.use("/api/admin", adminRouter);

    const callbackResponse = await request(app, `/api/auth/google/callback?code=ok&state=${ADMIN_OAUTH_STATE}`);
    assert.equal(callbackResponse.status, 302);
    assert.equal(callbackResponse.headers.get("location"), "http://admin.local/dashboard");
    assert.equal(persistedSession.userId, "super-user");
    assert.equal(persistedSession.isSuperAdmin, true);
    assert.equal(persistedSession.sessionGroup, "admin");
    assert.equal(persistedSession.appSlug, "admin");

    const adminResponse = await request(app, "/api/admin/stats", {
      headers: {
        cookie: "saas.admin.sid=admin-cookie",
      },
    });
    assert.equal(adminResponse.status, 200);

    const authCheckLines = logs
      .filter((entry) => typeof entry[0] === "string" && entry[0].includes("[AUTH-CHECK-TRACE]"))
      .map((entry) => String(entry[0]));

    const adminGuard = authCheckLines.find((line) => line.includes("[AUTH-CHECK-TRACE] ADMIN GUARD"));
    assert.ok(adminGuard);
    assert.match(adminGuard, /userId=super-user/);
    assert.match(adminGuard, /allow=true/);
  } finally {
    for (const undo of restore.reverse()) undo();
  }
});
test("logout clears only the current request session-group cookie (admin)", async () => {
  let destroyed = false;

  const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {
    userId: "admin-user",
    sessionGroup: "admin",
    destroy: (cb?: (err?: unknown) => void) => {
      destroyed = true;
      cb?.();
    },
  });

  const response = await request(app, "/api/auth/logout", {
    method: "POST",
    headers: {
      origin: "http://admin.local",
      cookie: "saas.admin.sid=admin-cookie; saas.workspace.sid=workspace-cookie",
    },
  });

  assert.equal(response.status, 200);
  assert.equal(destroyed, true);

  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /saas\.admin\.sid=;/i);
  assert.doesNotMatch(setCookie, /saas\.workspace\.sid=;/i);
});

test("logout fails closed for ambiguous multi-group cookies when origin context is missing", async () => {
  const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {
    userId: "mixed-user",
    sessionGroup: "admin",
  });

  const response = await request(app, "/api/auth/logout", {
    method: "POST",
    headers: {
      cookie: "saas.admin.sid=admin-cookie; saas.workspace.sid=workspace-cookie",
    },
  });

  assert.equal(response.status, 400);
  const body = await response.json() as { error?: string };
  assert.equal(body.error, "Unable to resolve session group for logout");
});

test("request group resolution prefers trusted origin over spoofable cookie order", () => {
  const req = {
    path: "/api/auth/logout",
    headers: {
      origin: "http://admin.local",
      cookie: "saas.workspace.sid=workspace-cookie; saas.admin.sid=admin-cookie",
    },
    query: {},
  };

  const resolution = sessionGroupLib.resolveSessionGroupForRequest(req as any, { failOnAmbiguous: true });
  assert.equal(resolution.ok, true);
  if (resolution.ok) {
    assert.equal(resolution.sessionGroup, sessionGroupLib.SESSION_GROUPS.ADMIN);
    assert.equal(resolution.source, "origin");
  }
});

test("oauth callback can resolve group from state when multiple group cookies coexist", () => {
  const req = {
    path: "/api/auth/google/callback",
    headers: {
      cookie: "saas.workspace.sid=workspace-cookie; saas.admin.sid=admin-cookie",
    },
    query: {
      state: "admin.callback-state",
    },
  };

  const resolution = sessionGroupLib.resolveSessionGroupForRequest(req as any, { failOnAmbiguous: true });
  assert.equal(resolution.ok, true);
  if (resolution.ok) {
    assert.equal(resolution.sessionGroup, sessionGroupLib.SESSION_GROUPS.ADMIN);
    assert.equal(resolution.source, "state");
  }
});

test("session middleware selects the correct group handler per request and preserves multi-cookie coexistence", async () => {
  const selectedGroups: string[] = [];
  const handlers = new Map<string, RequestHandler>([
    ["admin", (req, _res, next) => {
      selectedGroups.push("admin");
      (req as any).session = { id: "admin.sid", destroy: (cb?: (err?: unknown) => void) => cb?.() };
      next();
    }],
    ["default", (req, _res, next) => {
      selectedGroups.push("default");
      (req as any).session = { id: "default.sid", destroy: (cb?: (err?: unknown) => void) => cb?.() };
      next();
    }],
  ]);

  const app = express();
  app.use(sessionLib.createSessionMiddleware(handlers));
  app.post("/echo", (req, res) => {
    res.json({
      resolved: req.resolvedSessionGroup,
      sessionGroup: req.session.sessionGroup,
      source: req.sessionGroupResolutionSource,
    });
  });

  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind server");

  try {
    const adminResp = await fetch(`http://127.0.0.1:${address.port}/echo`, {
      method: "POST",
      headers: {
        origin: "http://admin.local",
        cookie: "saas.admin.sid=admin-cookie; saas.workspace.sid=workspace-cookie",
      },
    });
    assert.equal(adminResp.status, 200);
    assert.deepEqual(await adminResp.json(), {
      resolved: "admin",
      sessionGroup: "admin",
      source: "origin",
    });

    const workspaceResp = await fetch(`http://127.0.0.1:${address.port}/echo`, {
      method: "POST",
      headers: {
        origin: "http://workspace.local",
        cookie: "saas.admin.sid=admin-cookie; saas.workspace.sid=workspace-cookie",
      },
    });
    assert.equal(workspaceResp.status, 200);
    assert.deepEqual(await workspaceResp.json(), {
      resolved: "default",
      sessionGroup: "default",
      source: "origin",
    });

    assert.deepEqual(selectedGroups, ["admin", "default"]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
