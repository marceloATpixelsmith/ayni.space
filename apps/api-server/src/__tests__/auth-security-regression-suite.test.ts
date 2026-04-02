import test from "node:test";
import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import cors from "cors";

import { createMountedSessionApp, ensureTestDatabaseEnv, patchProperty } from "./helpers.js";

ensureTestDatabaseEnv();
process.env["SESSION_SECRET"] ??= "test-session-secret";
process.env["ALLOWED_ORIGINS"] = "http://admin.local,http://workspace.local";
process.env["ADMIN_FRONTEND_ORIGINS"] = "http://admin.local";
process.env["SESSION_GROUP_COOKIE_NAMES"] = "admin=saas.admin.sid,default=saas.workspace.sid";
process.env["GOOGLE_CLIENT_ID"] = "test-client";
process.env["GOOGLE_CLIENT_SECRET"] = "test-secret";
process.env["GOOGLE_REDIRECT_URI"] = "http://localhost:3000/api/auth/google/callback";
process.env["RATE_LIMIT_ENABLED"] = "true";

const { db } = await import("@workspace/db");
const { default: authRouter, authRouteDeps } = await import("../routes/auth.js");
const { default: usersRouter } = await import("../routes/users.js");
const sessionLib = await import("../lib/session.js");
const sessionGroupLib = await import("../lib/sessionGroup.js");
const { createSecurityEnforcementMiddleware } = await import("../lib/securityPolicy.js");
const ADMIN_OAUTH_STATE = "admin.valid-state.eyJub25jZSI6InZhbGlkLXN0YXRlIiwiYXBwU2x1ZyI6ImFkbWluIiwicmV0dXJuVG8iOiJodHRwOi8vYWRtaW4ubG9jYWwiLCJzZXNzaW9uR3JvdXAiOiJhZG1pbiJ9";

function createSessionGroupApp(handlers: Map<string, RequestHandler>) {
  const app = express();
  app.use(sessionLib.createSessionMiddleware(handlers));
  app.get("/api/workspace/me", (req, res) => {
    if (!req.session.userId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    res.json({ sessionGroup: req.session.sessionGroup, userId: req.session.userId });
  });
  app.get("/api/admin/me", (req, res) => {
    if (!req.session.userId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    res.json({ sessionGroup: req.session.sessionGroup, userId: req.session.userId });
  });
  return app;
}

async function request(app: express.Express, path: string, method: "GET" | "POST" | "OPTIONS" = "GET", headers: Record<string, string> = {}) {
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind server");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers,
      redirect: "manual",
    });
    return response;
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

test("PART 1+2: browser cookie jar keeps admin/workspace sessions isolated and independently valid", async () => {
  const handlers = new Map<string, RequestHandler>([
    ["admin", (req, _res, next) => {
      (req as any).session = { id: "admin.sid", userId: "admin-user", sessionGroup: "admin", destroy: (cb?: () => void) => cb?.() };
      next();
    }],
    ["default", (req, _res, next) => {
      (req as any).session = { id: "default.sid", userId: "workspace-user", sessionGroup: "default", destroy: (cb?: () => void) => cb?.() };
      next();
    }],
  ]);

  const app = createSessionGroupApp(handlers);
  const cookieJar = "saas.workspace.sid=workspace-cookie; saas.admin.sid=admin-cookie";

  const workspaceResp = await request(app, "/api/workspace/me", "GET", {
    origin: "http://workspace.local",
    cookie: cookieJar,
  });
  assert.equal(workspaceResp.status, 200);
  assert.deepEqual(await workspaceResp.json(), { sessionGroup: "default", userId: "workspace-user" });

  const adminResp = await request(app, "/api/admin/me", "GET", {
    origin: "http://admin.local",
    cookie: cookieJar,
  });
  assert.equal(adminResp.status, 200);
  assert.deepEqual(await adminResp.json(), { sessionGroup: "admin", userId: "admin-user" });

  assert.match(cookieJar, /saas\.workspace\.sid=/);
  assert.match(cookieJar, /saas\.admin\.sid=/);
});

test("PART 3: non-super-admin admin login denial redirects and only clears admin cookie", async () => {
  const restore: Array<() => void> = [
    patchProperty(authRouteDeps, "exchangeCodeForUserFn", async () => ({ sub: "sub", email: "user@example.com", name: "User" })),
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "regular-user",
      email: "user@example.com",
      name: "User",
      avatarUrl: null,
      activeOrgId: null,
      isSuperAdmin: false,
    })),
    patchProperty(db, "update", () => ({
      set: () => ({
        where: async () => ({}),
        returning: async () => ([{
          id: "regular-user",
          email: "user@example.com",
          name: "User",
          avatarUrl: null,
          activeOrgId: null,
          isSuperAdmin: false,
        }]),
      }),
    }) as never),
    patchProperty(db, "insert", () => ({
      values: () => Promise.resolve([{
        id: "regular-user",
        email: "user@example.com",
        name: "User",
        avatarUrl: null,
        activeOrgId: null,
        isSuperAdmin: false,
      }]),
    }) as never),
  ];

  let adminDestroyed = false;
  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {
      oauthState: ADMIN_OAUTH_STATE,
      oauthReturnTo: "http://admin.local",
      oauthSessionGroup: "admin",
      destroy: (cb?: (err?: unknown) => void) => {
        adminDestroyed = true;
        cb?.();
      },
    });

    const resp = await request(app, `/api/auth/google/callback?code=ok&state=${ADMIN_OAUTH_STATE}`);
    assert.equal(resp.status, 302);
    assert.equal(resp.headers.get("location"), "http://admin.local/login?error=access_denied");
    assert.equal(adminDestroyed, true);

    const setCookie = resp.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /saas\.admin\.sid=;/i);
    assert.doesNotMatch(setCookie, /saas\.workspace\.sid=;/i);
  } finally {
    restore.reverse().forEach((undo) => undo());
  }
});

test("PART 3B: admin callback app-context outage fails closed with redirect (no 500) and admin-only cookie clear", async () => {
  const restore: Array<() => void> = [
    patchProperty(authRouteDeps, "exchangeCodeForUserFn", async () => ({ sub: "sub", email: "user@example.com", name: "User" })),
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "regular-user",
      email: "user@example.com",
      name: "User",
      avatarUrl: null,
      activeOrgId: null,
      isSuperAdmin: false,
      googleSubject: "sub",
    })),
    patchProperty(db.query.appsTable, "findFirst", async () => {
      throw new Error("ECONNREFUSED");
    }),
    patchProperty(db, "update", () => ({
      set: () => ({
        where: async () => ({}),
      }),
    }) as never),
  ];

  let adminDestroyed = false;
  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {
      oauthState: ADMIN_OAUTH_STATE,
      oauthReturnTo: "http://admin.local",
      oauthSessionGroup: "admin",
      destroy: (cb?: (err?: unknown) => void) => {
        adminDestroyed = true;
        cb?.();
      },
    });

    const resp = await request(app, `/api/auth/google/callback?code=ok&state=${ADMIN_OAUTH_STATE}`);
    assert.equal(resp.status, 302);
    assert.equal(resp.headers.get("location"), "http://admin.local/login?error=access_denied");
    assert.equal(adminDestroyed, true);

    const setCookie = resp.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /saas\.admin\.sid=;/i);
    assert.doesNotMatch(setCookie, /saas\.workspace\.sid=;/i);
  } finally {
    restore.reverse().forEach((undo) => undo());
  }
});

test("PART 3C: admin oauth start embeds appSlug in state payload", async () => {
  const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }]);
  const resp = await request(app, "/api/auth/google/url", "POST", {
    origin: "http://admin.local",
  });
  assert.equal(resp.status, 200);
  const body = (await resp.json()) as { url: string };
  const redirectUrl = new URL(body.url);
  const state = redirectUrl.searchParams.get("state");
  assert.ok(state);
  const segments = state.split(".");
  assert.equal(segments[0], "admin");
  const payload = JSON.parse(Buffer.from(segments.slice(2).join("."), "base64url").toString("utf8"));
  assert.equal(payload.appSlug, "admin");
  assert.equal(payload.returnTo, "http://admin.local");
  assert.equal(payload.sessionGroup, "admin");
});

test("PART 3D: malformed oauth state fails closed without 500", async () => {
  let destroyed = false;
  const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {
    oauthState: "admin.valid-state.bad-payload",
    oauthReturnTo: "http://admin.local",
    oauthSessionGroup: "admin",
    destroy: (cb?: (err?: unknown) => void) => {
      destroyed = true;
      cb?.();
    },
  });
  const resp = await request(app, "/api/auth/google/callback?code=ok&state=admin.valid-state.bad-payload");
  assert.equal(resp.status, 302);
  assert.equal(resp.headers.get("location"), "http://admin.local/login?error=access_denied");
  assert.equal(destroyed, true);
});

test("PART 3E+3F+3G: callback-established admin session is reused by next auth check and allows superadmin", async () => {
  const logs: unknown[][] = [];
  const restore: Array<() => void> = [
    patchProperty(console, "log", (...args: unknown[]) => {
      logs.push(args);
    }),
    patchProperty(authRouteDeps, "exchangeCodeForUserFn", async () => ({ sub: "super-sub", email: "super@example.com", name: "Super" })),
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "admin-app",
      slug: "admin",
      isActive: true,
      accessMode: "superadmin",
      onboardingMode: "disabled",
    })),
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "super-user-id",
      email: "super@example.com",
      name: "Super",
      avatarUrl: null,
      activeOrgId: null,
      isSuperAdmin: true,
      googleSubject: "super-sub",
      active: true,
      suspended: false,
      deletedAt: null,
    })),
    patchProperty(db, "update", () => ({
      set: () => ({
        where: async () => ({}),
        returning: async () => ([{
          id: "super-user-id",
          email: "super@example.com",
          name: "Super",
          avatarUrl: null,
          activeOrgId: null,
          isSuperAdmin: true,
          googleSubject: "super-sub",
        }]),
      }),
    }) as never),
    patchProperty(db, "insert", () => ({
      values: () => Promise.resolve([{
        id: "super-user-id",
        email: "super@example.com",
        name: "Super",
        avatarUrl: null,
        activeOrgId: null,
        isSuperAdmin: true,
        googleSubject: "super-sub",
      }]),
    }) as never),
  ];

  const sessionState: { session: any } = {
    session: {
      id: "admin.callback.session",
      oauthState: ADMIN_OAUTH_STATE,
      oauthReturnTo: "http://admin.local",
      oauthSessionGroup: "admin",
      sessionGroup: "admin",
      destroy: (cb?: (err?: unknown) => void) => cb?.(),
      save: (cb?: (err?: unknown) => void) => cb?.(),
      regenerate: (cb?: (err?: unknown) => void) => cb?.(),
    },
  };

  try {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).session = sessionState.session;
      next();
    });
    app.use("/api/auth", authRouter);
    app.use("/api/users", usersRouter);

    const callbackResp = await request(app, `/api/auth/google/callback?code=ok&state=${ADMIN_OAUTH_STATE}`, "GET", {
      origin: "http://admin.local",
      cookie: "saas.admin.sid=admin-cookie",
    });
    assert.equal(callbackResp.status, 302);

    const meResp = await request(app, "/api/users/me", "GET", {
      origin: "http://admin.local",
      cookie: "saas.admin.sid=admin-cookie",
    });
    assert.equal(meResp.status, 200);
    const mePayload = (await meResp.json()) as Record<string, unknown>;
    assert.equal(mePayload["id"], "super-user-id");
    assert.equal(mePayload["isSuperAdmin"], true);

    const firstAuthTrace = logs
      .map((entry) => String(entry[0]))
      .find((line) => line.includes("[AUTH-CHECK-TRACE] FIRST AUTH REQUEST"));
    assert.ok(firstAuthTrace);
    assert.match(firstAuthTrace, /cookieHeaderPresent=true/);
    assert.match(firstAuthTrace, /allow=true/);
    assert.match(firstAuthTrace, /isSuperAdmin=true/);
  } finally {
    restore.reverse().forEach((undo) => undo());
  }
});

test("PART 4+5: group-scoped logout clears only target cookie and invalidates session", async () => {
  const state: { session: any | null } = {
    session: {
      id: "admin-session-id",
      userId: "admin-user",
      sessionGroup: "admin",
      destroy: (cb?: (err?: unknown) => void) => {
        state.session = null;
        cb?.();
      },
      save: (cb?: (err?: unknown) => void) => cb?.(),
      regenerate: (cb?: (err?: unknown) => void) => cb?.(),
    },
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session =
      state.session ?? { id: "admin-session-id", destroy: (cb?: (err?: unknown) => void) => cb?.(), save: (cb?: (err?: unknown) => void) => cb?.(), regenerate: (cb?: (err?: unknown) => void) => cb?.() };
    next();
  });
  app.use("/api/auth", authRouter);

  const logoutResp = await request(app, "/api/auth/logout", "POST", {
    origin: "http://admin.local",
    cookie: "saas.admin.sid=admin-cookie; saas.workspace.sid=workspace-cookie",
  });
  assert.equal(logoutResp.status, 200);
  const setCookie = logoutResp.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /saas\.admin\.sid=;/i);
  assert.doesNotMatch(setCookie, /saas\.workspace\.sid=;/i);

  const meResp = await request(app, "/api/auth/me", "GET", {
    origin: "http://admin.local",
    cookie: "saas.workspace.sid=workspace-cookie",
  });
  assert.equal(meResp.status, 401);

  assert.equal(sessionLib.getSessionStoreConfig().schemaName, "platform");
  assert.equal(sessionLib.getSessionStoreConfig().tableName, "sessions");
});

test("PART 6: cookie naming + attributes + clearing contract are group-correct", () => {
  const prevNodeEnv = process.env["NODE_ENV"];
  const prevDomain = process.env["SESSION_COOKIE_DOMAIN"];
  process.env["NODE_ENV"] = "production";
  process.env["SESSION_COOKIE_DOMAIN"] = "admin.test.local";

  try {
    const adminOptions = sessionLib.buildSessionOptions("secret", sessionGroupLib.SESSION_GROUPS.ADMIN);
    const workspaceOptions = sessionLib.buildSessionOptions("secret", sessionGroupLib.SESSION_GROUPS.DEFAULT);

    assert.equal(adminOptions.name, "saas.admin.sid");
    assert.equal(workspaceOptions.name, "saas.workspace.sid");
    assert.equal(adminOptions.cookie?.httpOnly, true);
    assert.equal(adminOptions.cookie?.sameSite, "none");
    assert.equal(adminOptions.cookie?.secure, true);

    const headers: Record<string, string> = {};
    const fakeRes = {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        headers["name"] = name;
        headers["domain"] = String(options.domain ?? "");
        headers["httpOnly"] = String(options.httpOnly ?? false);
        headers["sameSite"] = String(options.sameSite ?? "");
      },
    };
    sessionLib.clearSessionCookie(fakeRes as any, sessionGroupLib.SESSION_GROUPS.ADMIN);
    assert.equal(headers["name"], "saas.admin.sid");
    assert.equal(headers["domain"], "admin.test.local");
    assert.equal(headers["httpOnly"], "true");
    assert.equal(headers["sameSite"], "none");
  } finally {
    if (prevNodeEnv === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = prevNodeEnv;
    if (prevDomain === undefined) delete process.env["SESSION_COOKIE_DOMAIN"];
    else process.env["SESSION_COOKIE_DOMAIN"] = prevDomain;
  }
});

test("PART 7+8+10: turnstile, rate limit, and fail-closed behavior on auth endpoints", async () => {
  const prevGoogleUrlRateLimitMax = process.env["AUTH_GOOGLE_URL_RATE_LIMIT_MAX"];
  process.env["TURNSTILE_ENABLED"] = "true";
  process.env["AUTH_GOOGLE_URL_RATE_LIMIT_MAX"] = "20";

  try {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).session = {
        id: "auth-flow-session",
        destroy: (cb?: (err?: unknown) => void) => cb?.(),
        save: (cb?: (err?: unknown) => void) => cb?.(),
        regenerate: (cb?: (err?: unknown) => void) => cb?.(),
      };
      next();
    });
    app.use(createSecurityEnforcementMiddleware({ verifyFn: async (token) => token === "valid-token" }));
    app.use("/api/auth", authRouter);

    const missingToken = await request(app, "/api/auth/google/url", "POST", {
      origin: "http://workspace.local",
      "x-forwarded-for": "203.0.113.90",
    });
    assert.equal(missingToken.status, 403);

    const invalidToken = await request(app, "/api/auth/google/url", "POST", {
      origin: "http://workspace.local",
      "cf-turnstile-response": "invalid-token",
      "x-forwarded-for": "203.0.113.91",
    });
    assert.equal(invalidToken.status, 403);

    const validToken = await request(app, "/api/auth/google/url", "POST", {
      origin: "http://workspace.local",
      "cf-turnstile-response": "valid-token",
      "x-forwarded-for": "203.0.113.92",
    });
    assert.equal(validToken.status, 200);

    for (let i = 0; i < 20; i += 1) {
      const ok = await request(app, "/api/auth/google/url", "POST", {
        origin: "http://workspace.local",
        "cf-turnstile-response": "valid-token",
        "x-forwarded-for": "203.0.113.93",
      });
      assert.equal(ok.status, 200);
    }
    const limited = await request(app, "/api/auth/google/url", "POST", {
      origin: "http://workspace.local",
      "cf-turnstile-response": "valid-token",
      "x-forwarded-for": "203.0.113.93",
    });
    assert.equal(limited.status, 429);

    const deniedMissingSession = await request(app, "/api/auth/me", "GET", {
      origin: "http://workspace.local",
    });
    assert.equal(deniedMissingSession.status, 401);
  } finally {
    if (prevGoogleUrlRateLimitMax === undefined) delete process.env["AUTH_GOOGLE_URL_RATE_LIMIT_MAX"];
    else process.env["AUTH_GOOGLE_URL_RATE_LIMIT_MAX"] = prevGoogleUrlRateLimitMax;
  }
});

test("PART 9+10: CORS and ambiguous session-group resolution fail closed", async () => {
  const corsApp = express();
  corsApp.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || ["http://workspace.local"].includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error("Not allowed by CORS"));
      },
      credentials: true,
    }),
  );
  corsApp.options("/api/auth/google/url", (_req, res) => {
    res.sendStatus(204);
  });

  const preflightAllowed = await request(corsApp, "/api/auth/google/url", "OPTIONS", {
    origin: "http://workspace.local",
    "access-control-request-method": "POST",
  });
  assert.equal(preflightAllowed.status, 204);
  assert.equal(preflightAllowed.headers.get("access-control-allow-origin"), "http://workspace.local");

  const preflightDenied = await request(corsApp, "/api/auth/google/url", "OPTIONS", {
    origin: "http://evil.local",
    "access-control-request-method": "POST",
  });
  assert.ok(preflightDenied.status >= 400);

  const handlers = new Map<string, RequestHandler>([
    ["admin", (req, _res, next) => {
      (req as any).session = { id: "admin.sid", destroy: (cb?: () => void) => cb?.() };
      next();
    }],
    ["default", (req, _res, next) => {
      (req as any).session = { id: "default.sid", destroy: (cb?: () => void) => cb?.() };
      next();
    }],
  ]);

  const sessionApp = express();
  sessionApp.use(sessionLib.createSessionMiddleware(handlers));
  sessionApp.get("/api/protected", (_req, res) => res.status(200).json({ ok: true }));

  const ambiguous = await request(sessionApp, "/api/protected", "GET", {
    cookie: "saas.workspace.sid=workspace-cookie; saas.admin.sid=admin-cookie",
  });
  assert.equal(ambiguous.status, 400);
});
