import test from "node:test";
import assert from "node:assert/strict";
import { createSessionApp, performJsonRequest, patchProperty, ensureTestDatabaseEnv } from "./helpers.js";

ensureTestDatabaseEnv();

const { turnstileVerifyMiddleware, isTurnstileEnabled, verifyTurnstileTokenDetailed } = await import("../middlewares/turnstile.js");
const { recordAbuseSignal } = await import("../lib/authAbuse.js");
const { db } = await import("@workspace/db");
const { default: invitationsRouter } = await import("../routes/invitations.js");

test("turnstile defaults to enabled in production", () => {
  const previousNodeEnv = process.env["NODE_ENV"];
  const previousEnabled = process.env["TURNSTILE_ENABLED"];
  const previousAllowDisable = process.env["TURNSTILE_ALLOW_DISABLE_IN_PRODUCTION"];

  process.env["NODE_ENV"] = "production";
  delete process.env["TURNSTILE_ENABLED"];
  delete process.env["TURNSTILE_ALLOW_DISABLE_IN_PRODUCTION"];

  try {
    assert.equal(isTurnstileEnabled(), true);
  } finally {
    if (previousNodeEnv === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = previousNodeEnv;
    if (previousEnabled === undefined) delete process.env["TURNSTILE_ENABLED"];
    else process.env["TURNSTILE_ENABLED"] = previousEnabled;
    if (previousAllowDisable === undefined) delete process.env["TURNSTILE_ALLOW_DISABLE_IN_PRODUCTION"];
    else process.env["TURNSTILE_ALLOW_DISABLE_IN_PRODUCTION"] = previousAllowDisable;
  }
});



test("abuse signal marks repeated events once threshold is reached", () => {
  const key = `abuse-test-${Date.now()}`;
  const first = recordAbuseSignal(key, { threshold: 2, windowMs: 60_000 });
  const second = recordAbuseSignal(key, { threshold: 2, windowMs: 60_000 });

  assert.equal(first.repeated, false);
  assert.equal(second.repeated, true);
});


test("turnstile middleware logs repeated failures when verification fails", async () => {
  const prevThreshold = process.env["ABUSE_REPEATED_THRESHOLD"];
  const prevEnabled = process.env["TURNSTILE_ENABLED"];
  process.env["ABUSE_REPEATED_THRESHOLD"] = "2";
  process.env["TURNSTILE_ENABLED"] = "true";
  const events: Array<{ action?: string }> = [];
  const middleware = turnstileVerifyMiddleware({
    verifyFn: async () => false,
    writeAuditLogFn: (event) => {
      events.push(event as { action?: string });
    },
  });

  const req: any = {
    method: "POST",
    path: "/api/invitations/token/accept",
    ip: "10.0.0.5",
    headers: { "cf-turnstile-response": "bad-token" },
    body: {},
    get: () => undefined,
    session: { userId: "user-1" },
  };

  const res: any = {
    status: () => ({ json: () => undefined }),
  };

  for (let i = 0; i < 2; i += 1) {
    await new Promise<void>((resolve) => {
      middleware(req, res, () => resolve());
      setTimeout(resolve, 0);
    });
  }

  assert.equal(events.length >= 1, true);
  assert.equal(events.some((e) => (e.action ?? "").startsWith("turnstile.failed")), true);

  if (prevThreshold === undefined) delete process.env["ABUSE_REPEATED_THRESHOLD"];
  else process.env["ABUSE_REPEATED_THRESHOLD"] = prevThreshold;
  if (prevEnabled === undefined) delete process.env["TURNSTILE_ENABLED"];
  else process.env["TURNSTILE_ENABLED"] = prevEnabled;
});

test("turnstile detailed verification marks stale tokens as token-expired", async () => {
  const previousEnabled = process.env["TURNSTILE_ENABLED"];
  const previousSecret = process.env["TURNSTILE_SECRET_KEY"];
  const previousFetch = globalThis.fetch;
  process.env["TURNSTILE_ENABLED"] = "true";
  process.env["TURNSTILE_SECRET_KEY"] = "test-turnstile-secret";

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ success: false, "error-codes": ["timeout-or-duplicate"] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  try {
    const result = await verifyTurnstileTokenDetailed("stale-token", "127.0.0.1");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "token-expired");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) delete process.env["TURNSTILE_ENABLED"];
    else process.env["TURNSTILE_ENABLED"] = previousEnabled;
    if (previousSecret === undefined) delete process.env["TURNSTILE_SECRET_KEY"];
    else process.env["TURNSTILE_SECRET_KEY"] = previousSecret;
  }
});

test("invitation accept rejects expired invitations", async () => {
  const prevNodeEnv = process.env["NODE_ENV"];
  const prevTurnstileEnabled = process.env["TURNSTILE_ENABLED"];
  process.env["NODE_ENV"] = "development";
  process.env["TURNSTILE_ENABLED"] = "false";

  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({ id: "user-1", email: "member@example.com", active: true, suspended: false, deletedAt: null })),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({ id: "org-1", appId: "app-org" })),
    patchProperty(db.query.appsTable, "findFirst", async () => ({ id: "app-org", accessMode: "organization", staffInvitesEnabled: true })),
    patchProperty(db.query.invitationsTable, "findFirst", async () => ({
      id: "inv-1",
      email: "member@example.com",
      orgId: "org-1",
      invitedRole: "staff",
      invitationStatus: "pending",
      expiresAt: new Date(Date.now() - 60_000),
    })),
    patchProperty(db, "update", () => ({
      set: () => ({
        where: async () => undefined,
      }),
    } as never)),
    patchProperty(db, "insert", () => ({
      values: () => Promise.resolve(),
    } as never)),
  ];

  try {
    const app = createSessionApp(invitationsRouter, { userId: "user-1", appSlug: "ayni" });
    const response = await performJsonRequest(app, "POST", "/api/invitations/token-expired/accept", {});
    assert.equal(response.status, 410);
    assert.match(String((response.body as { error?: string })?.error), /expired/i);
  } finally {
    restores.reverse().forEach((restore) => restore());
    if (prevNodeEnv === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = prevNodeEnv;
    if (prevTurnstileEnabled === undefined) delete process.env["TURNSTILE_ENABLED"];
    else process.env["TURNSTILE_ENABLED"] = prevTurnstileEnabled;
  }
});

test("invitation accept rejects email mismatch and non-pending invitation", async () => {
  const prevNodeEnv = process.env["NODE_ENV"];
  const prevTurnstileEnabled = process.env["TURNSTILE_ENABLED"];
  process.env["NODE_ENV"] = "development";
  process.env["TURNSTILE_ENABLED"] = "false";

  const invitationStates = [
    {
      id: "inv-mismatch",
      email: "invited@example.com",
      orgId: "org-1",
      invitedRole: "staff",
      invitationStatus: "pending",
      expiresAt: new Date(Date.now() + 60_000),
    },
    {
      id: "inv-used",
      email: "member@example.com",
      orgId: "org-1",
      invitedRole: "staff",
      invitationStatus: "accepted",
      expiresAt: new Date(Date.now() + 60_000),
    },
  ];

  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({ id: "user-1", email: "member@example.com", active: true, suspended: false, deletedAt: null })),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({ id: "org-1", appId: "app-org" })),
    patchProperty(db.query.appsTable, "findFirst", async () => ({ id: "app-org", accessMode: "organization", staffInvitesEnabled: true })),
    patchProperty(db.query.invitationsTable, "findFirst", async () => invitationStates.shift() ?? null),
    patchProperty(db, "update", () => ({
      set: () => ({
        where: async () => undefined,
      }),
    } as never)),
    patchProperty(db, "insert", () => ({
      values: () => Promise.resolve(),
    } as never)),
  ];

  try {
    const app = createSessionApp(invitationsRouter, { userId: "user-1", appSlug: "ayni" });

    const mismatch = await performJsonRequest(app, "POST", "/api/invitations/token-mismatch/accept", {});
    assert.equal(mismatch.status, 403);
    assert.match(String((mismatch.body as { error?: string })?.error), /email does not match/i);

    const reused = await performJsonRequest(app, "POST", "/api/invitations/token-used/accept", {});
    assert.equal(reused.status, 409);
    assert.match(String((reused.body as { error?: string })?.error), /no longer pending/i);
  } finally {
    restores.reverse().forEach((restore) => restore());
    if (prevNodeEnv === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = prevNodeEnv;
    if (prevTurnstileEnabled === undefined) delete process.env["TURNSTILE_ENABLED"];
    else process.env["TURNSTILE_ENABLED"] = prevTurnstileEnabled;
  }
});


test("invitation accept is blocked when organization staff invites are disabled", async () => {
  const prevNodeEnv = process.env["NODE_ENV"];
  const prevTurnstileEnabled = process.env["TURNSTILE_ENABLED"];
  process.env["NODE_ENV"] = "development";
  process.env["TURNSTILE_ENABLED"] = "false";

  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({ id: "user-1", email: "member@example.com", active: true, suspended: false, deletedAt: null })),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({ id: "org-1", appId: "app-org" })),
    patchProperty(db.query.appsTable, "findFirst", async () => ({ id: "app-org", accessMode: "organization", staffInvitesEnabled: false })),
    patchProperty(db, "update", () => ({ set: () => ({ where: async () => undefined }) } as never)),
    patchProperty(db.query.invitationsTable, "findFirst", async () => ({
      id: "inv-disabled",
      email: "member@example.com",
      orgId: "org-1",
      invitedRole: "staff",
      invitationStatus: "pending",
      expiresAt: new Date(Date.now() + 60_000),
    })),
  ];

  try {
    const app = createSessionApp(invitationsRouter, { userId: "user-1", appSlug: "ayni" });
    const response = await performJsonRequest(app, "POST", "/api/invitations/token-disabled/accept", {});
    assert.equal(response.status, 403);
    assert.match(String((response.body as { error?: string })?.error), /disabled/i);
  } finally {
    restores.reverse().forEach((restore) => restore());
    if (prevNodeEnv === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = prevNodeEnv;
    if (prevTurnstileEnabled === undefined) delete process.env["TURNSTILE_ENABLED"];
    else process.env["TURNSTILE_ENABLED"] = prevTurnstileEnabled;
  }
});
