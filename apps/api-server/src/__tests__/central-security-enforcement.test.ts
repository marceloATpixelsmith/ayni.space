import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { patchProperty, ensureTestDatabaseEnv } from "./helpers.js";

ensureTestDatabaseEnv();
process.env["NODE_ENV"] = "development";
process.env["ALLOWED_ORIGINS"] = "http://localhost:5173";

const { createSecurityEnforcementMiddleware } = await import("../lib/securityPolicy.js");
const { getSecurityRuleForRequest } = await import("../lib/securityPolicy.js");
const { authTokensTable, db } = await import("@workspace/db");
const { default: adminRouter } = await import("../routes/admin.js");
const { default: usersRouter } = await import("../routes/users.js");
const { default: authRouter } = await import("../routes/auth.js");

function createApp(session: Record<string, unknown> = {}, turnstileOk = false) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: Record<string, unknown> }).session = {
      id: "test-session-id",
      destroy: (cb?: (err?: unknown) => void) => cb?.(),
      save: (cb?: (err?: unknown) => void) => cb?.(),
      regenerate: (cb?: (err?: unknown) => void) => cb?.(),
      ...session,
    };
    next();
  });
  app.use(createSecurityEnforcementMiddleware({ verifyFn: async () => turnstileOk }));
  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/admin", adminRouter);
  return app;
}

async function requestJson(app: express.Express, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        origin: "http://localhost:5173",
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return response;
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

function user(id: string, extras: Record<string, unknown> = {}) {
  return {
    id,
    email: `${id}@example.com`,
    name: id,
    avatarUrl: null,
    isSuperAdmin: false,
    activeOrgId: "org-a",
    active: true,
    suspended: false,
    deletedAt: null,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    ...extras,
  };
}

test("PUBLIC login endpoint requires turnstile via central enforcement", async () => {
  process.env["TURNSTILE_ENABLED"] = "true";

  const blocked = await requestJson(createApp({}, true), "POST", "/api/auth/google/url", {});
  assert.equal(blocked.status, 403);

  const allowed = await requestJson(createApp({}, true), "POST", "/api/auth/google/url", {}, {
    "cf-turnstile-response": "valid-token",
  });
  assert.notEqual(allowed.status, 403);
});

test("PUBLIC login endpoint accepts turnstile token from request body", async () => {
  process.env["TURNSTILE_ENABLED"] = "true";

  const allowed = await requestJson(
    createApp({}, true),
    "POST",
    "/api/auth/google/url",
    { "cf-turnstile-response": "valid-token" },
  );
  assert.notEqual(allowed.status, 403);
});

test("verify-email endpoint remains public without requiring turnstile token", async () => {
  process.env["TURNSTILE_ENABLED"] = "true";
  const response = await requestJson(createApp({}, true), "POST", "/api/auth/verify-email", { token: "fake-token" });
  assert.notEqual(response.status, 403);
});

test("verify-email reports expired and already-used token states distinctly", async () => {
  const originalUpdate = db.update.bind(db);
  const restoreUpdate = patchProperty(
    db,
    "update",
    ((table: unknown) => {
      if (table === authTokensTable) {
        return {
          set: () => ({
            where: () => ({
              returning: async () => [],
            }),
          }),
        } as never;
      }
      return originalUpdate(table as never);
    }) as typeof db.update,
  );

  const restoreExpiredLookup = patchProperty(
    db.query.authTokensTable,
    "findFirst",
    async () => ({
      id: "token-expired",
      userId: "user-1",
      tokenType: "email_verification",
      tokenHash: "hash",
      expiresAt: new Date(Date.now() - 60_000),
      consumedAt: null,
      createdAt: new Date(),
    }),
  );

  try {
    const expired = await requestJson(createApp({}), "POST", "/api/auth/verify-email", { token: "fake-token" });
    const expiredBody = (await expired.json().catch(() => null)) as { code?: string } | null;
    assert.equal(expired.status, 400);
    assert.equal(expiredBody?.code, "VERIFICATION_TOKEN_EXPIRED");
  } finally {
    restoreExpiredLookup();
  }

  const restoreUsedLookup = patchProperty(
    db.query.authTokensTable,
    "findFirst",
    async () => ({
      id: "token-used",
      userId: "user-1",
      tokenType: "email_verification",
      tokenHash: "hash",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: new Date(Date.now() - 60_000),
      createdAt: new Date(),
    }),
  );

  try {
    const used = await requestJson(createApp({}), "POST", "/api/auth/verify-email", { token: "fake-token" });
    const usedBody = (await used.json().catch(() => null)) as { code?: string } | null;
    assert.equal(used.status, 409);
    assert.equal(usedBody?.code, "VERIFICATION_TOKEN_ALREADY_USED");
  } finally {
    restoreUsedLookup();
    restoreUpdate();
  }
});

test("AUTHENTICATED routes require valid session by default", async () => {
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => user("user-auth")),
    patchProperty(db, "update", () => ({ set: () => ({ where: async () => undefined }) } as never)),
  ];
  try {
    const blocked = await requestJson(createApp({}), "GET", "/api/users/me");
    assert.equal(blocked.status, 401);

    const allowed = await requestJson(createApp({ userId: "user-auth" }), "GET", "/api/users/me");
    assert.equal(allowed.status, 200);
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("ADMIN routes are centrally enforced as super-admin only", async () => {
  let isSuper = false;
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => user("admin-user", { isSuperAdmin: isSuper })),
    patchProperty(db, "select", () => ({ from: async () => [{ count: 1 }] } as never)),
    patchProperty(db, "update", () => ({ set: () => ({ where: async () => undefined }) } as never)),
  ];

  try {
    const forbidden = await requestJson(createApp({ userId: "admin-user" }), "GET", "/api/admin/stats");
    assert.equal(forbidden.status, 403);

    isSuper = true;
    const allowed = await requestJson(createApp({ userId: "admin-user" }), "GET", "/api/admin/stats");
    assert.equal(allowed.status, 200);
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("origin/referer protection denies unsafe requests with missing headers except explicit machine exceptions", async () => {
  const { originRefererProtection } = await import("../middlewares/csrf.js");
  const app = express();
  app.use(express.json());
  app.use(originRefererProtection(["http://localhost:5173"]));
  app.post("/api/organizations/org-a/invitations", (_req, res) => res.status(200).json({ ok: true }));
  app.post("/api/billing/webhook", (_req, res) => res.status(200).json({ ok: true }));

  const blocked = await requestJson(app, "POST", "/api/organizations/org-a/invitations", {}, { origin: "" });
  assert.equal(blocked.status, 403);

  const allowedMachine = await requestJson(app, "POST", "/api/billing/webhook", {}, { origin: "" });
  assert.equal(allowedMachine.status, 200);
});

test("origin/referer protection denies invalid and malformed origin values while allowing referer-only valid requests", async () => {
  const { originRefererProtection } = await import("../middlewares/csrf.js");
  const app = express();
  app.use(express.json());
  app.use(originRefererProtection(["http://localhost:5173"]));
  app.post("/api/organizations/org-a/invitations", (_req, res) => res.status(200).json({ ok: true }));

  const invalidOrigin = await requestJson(
    app,
    "POST",
    "/api/organizations/org-a/invitations",
    {},
    { origin: "http://evil.example", referer: "http://evil.example/invitations" },
  );
  assert.equal(invalidOrigin.status, 403);

  const refererOnlyAllowed = await requestJson(
    app,
    "POST",
    "/api/organizations/org-a/invitations",
    {},
    { referer: "http://localhost:5173/organizations/org-a" },
  );
  assert.equal(refererOnlyAllowed.status, 200);

  const malformedOrigin = await requestJson(
    app,
    "POST",
    "/api/organizations/org-a/invitations",
    {},
    { origin: "not a url" },
  );
  assert.equal(malformedOrigin.status, 403);
});

test("privileged non-/api/admin routes are explicitly classified as ADMIN", () => {
  const suspendRule = getSecurityRuleForRequest("PATCH", "/api/users/user-1/suspend");
  const unsuspendRule = getSecurityRuleForRequest("PATCH", "/api/users/user-1/unsuspend");
  assert.equal(suspendRule?.category, "ADMIN");
  assert.equal(unsuspendRule?.category, "ADMIN");
});
