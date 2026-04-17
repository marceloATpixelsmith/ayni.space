import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { ensureTestDatabaseEnv, patchProperty } from "./helpers.js";

ensureTestDatabaseEnv();

const { db } = await import("@workspace/db");
const { resolvePostAuthContinuation } = await import("../lib/postAuthContinuation.js");
const {
  DEFAULT_POST_AUTH_PATH,
  resolveAuthenticatedPostAuthDestination,
} = await import("../lib/postAuthDestination.js");
const {
  assertRequestSessionGroupCompatibleWithOrg,
  isSessionGroupCompatible,
  resolveSessionGroupForApp,
} = await import("../lib/sessionGroupCompatibility.js");
const { requireAuth } = await import("../middlewares/requireAuth.js");

function createRequireAuthApp(sessionSeed: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: Record<string, unknown> }).session = {
      id: "session-id",
      destroy: ((cb?: (err?: unknown) => void) => cb?.()) as unknown,
      save: ((cb?: (err?: unknown) => void) => cb?.()) as unknown,
      regenerate: ((cb?: (err?: unknown) => void) => cb?.()) as unknown,
      ...sessionSeed,
    };
    next();
  });

  app.get("/api/auth/me", requireAuth, (_req, res) => {
    res.json({ ok: true, route: "me" });
  });
  app.get("/api/protected/resource", requireAuth, (_req, res) => {
    res.json({ ok: true, route: "protected" });
  });

  return app;
}

async function requestJson(app: express.Express, path: string) {
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind ephemeral test server");
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

test("oauth continuation is restored when backend flow allows access and onboarding is not required", () => {
  const continuation = resolvePostAuthContinuation({
    appSlug: "ayni",
    returnPath: "/invitations/token-oauth/accept",
  });

  const destination = resolveAuthenticatedPostAuthDestination({
    continuation,
    currentAppSlug: "ayni",
    flowDecision: {
      appSlug: "ayni",
      canAccess: true,
      requiredOnboarding: "none",
      normalizedAccessProfile: "organization",
      destination: "/dashboard",
    },
  });

  assert.equal(destination, "/invitations/token-oauth/accept");
});

test("password login continuation follows same backend destination precedence policy as oauth", () => {
  const continuation = resolvePostAuthContinuation({
    appSlug: "ayni",
    returnPath: "/events/spring/register",
    continuationType: "event_registration",
  });

  const destination = resolveAuthenticatedPostAuthDestination({
    continuation,
    currentAppSlug: "ayni",
    flowDecision: {
      appSlug: "ayni",
      canAccess: true,
      requiredOnboarding: "none",
      normalizedAccessProfile: "organization",
      destination: "/dashboard",
    },
  });

  assert.equal(destination, "/events/spring/register");
});

test("invitation continuation is ignored when authenticated app context differs", () => {
  const continuation = resolvePostAuthContinuation({
    appSlug: "shipibo",
    returnPath: "/invitations/token-shipibo/accept",
  });

  const destination = resolveAuthenticatedPostAuthDestination({
    continuation,
    currentAppSlug: "ayni",
    flowDecision: {
      appSlug: "ayni",
      canAccess: true,
      requiredOnboarding: "none",
      normalizedAccessProfile: "organization",
      destination: "/dashboard",
    },
  });

  assert.equal(destination, "/dashboard");
});

test("post-auth destination precedence matrix stays backend-authoritative across combinations", () => {
  const continuation = resolvePostAuthContinuation({
    appSlug: "ayni",
    returnPath: "/invitations/token-priority/accept",
  });

  const denied = resolveAuthenticatedPostAuthDestination({
    continuation,
    currentAppSlug: "ayni",
    flowDecision: {
      appSlug: "ayni",
      canAccess: false,
      requiredOnboarding: "none",
      normalizedAccessProfile: "organization",
      destination: "/login?error=access_denied",
    },
  });
  assert.equal(denied, "/login?error=access_denied");

  const onboardingFirst = resolveAuthenticatedPostAuthDestination({
    continuation,
    currentAppSlug: "ayni",
    flowDecision: {
      appSlug: "ayni",
      canAccess: true,
      requiredOnboarding: "organization",
      normalizedAccessProfile: "organization",
      destination: "/onboarding/organization",
    },
  });
  assert.equal(onboardingFirst, "/onboarding/organization");

  const continuationThenDefault = resolveAuthenticatedPostAuthDestination({
    continuation,
    currentAppSlug: "ayni",
    flowDecision: {
      appSlug: "ayni",
      canAccess: true,
      requiredOnboarding: "none",
      normalizedAccessProfile: "organization",
      destination: "/dashboard",
    },
  });
  assert.equal(continuationThenDefault, "/invitations/token-priority/accept");

  const defaultOnly = resolveAuthenticatedPostAuthDestination({
    continuation: null,
    currentAppSlug: "ayni",
    flowDecision: {
      appSlug: "ayni",
      canAccess: true,
      requiredOnboarding: "none",
      normalizedAccessProfile: "organization",
      destination: "/dashboard",
    },
  });
  assert.equal(defaultOnly, "/dashboard");

  const fallbackOnly = resolveAuthenticatedPostAuthDestination({
    continuation: null,
    currentAppSlug: "ayni",
    flowDecision: null,
  });
  assert.equal(fallbackOnly, DEFAULT_POST_AUTH_PATH);
});

test("requireAuth enforces MFA-pending behavior consistently across /api/auth/me and protected routes", async () => {
  const restore = patchProperty(db.query.usersTable, "findFirst", async () => ({
    id: "user-pending-1",
    isSuperAdmin: false,
    suspended: false,
    deletedAt: null,
    active: true,
  }));

  try {
    const app = createRequireAuthApp({
      sessionGroup: "admin",
      pendingUserId: "user-pending-1",
      pendingMfaReason: "challenge_required",
    });

    const meResponse = await requestJson(app, "/api/auth/me");
    assert.equal(meResponse.status, 200);
    assert.deepEqual(meResponse.body, { ok: true, route: "me" });

    const protectedResponse = await requestJson(app, "/api/protected/resource");
    assert.equal(protectedResponse.status, 401);
    assert.equal(
      (protectedResponse.body as { code?: string } | null)?.code,
      "MFA_REQUIRED",
    );
  } finally {
    restore();
  }
});

test("session-group compatibility boundaries reject mismatched groups and missing session group", async () => {
  const compatibilityRestores = [
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({
      id: "org-1",
      appId: "app-admin",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    patchProperty(db.query.orgAppAccessTable, "findMany", async () => [{
      id: "org-app-access-1",
      orgId: "org-1",
      appId: "app-admin",
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }]),
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "app-admin",
      slug: "admin",
      isActive: true,
      metadata: { sessionGroup: "admin" },
    })),
  ];

  const reqMissingSession = {
    session: {},
    resolvedSessionGroup: undefined,
  } as unknown as express.Request;

  const reqWrongGroup = {
    session: { sessionGroup: "default" },
    resolvedSessionGroup: "default",
  } as unknown as express.Request;

  try {
    const missing = await assertRequestSessionGroupCompatibleWithOrg(reqMissingSession, "org-1");
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.reason, "missing-session-group");
    }

    const mismatch = await assertRequestSessionGroupCompatibleWithOrg(reqWrongGroup, "org-1");
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) {
      assert.equal(mismatch.reason, "incompatible-session-group");
    }
  } finally {
    for (const restore of compatibilityRestores.reverse()) restore();
  }
});

test("session-group compatibility honors app metadata and defaults safely", () => {
  assert.equal(resolveSessionGroupForApp({ slug: "custom", metadata: { sessionGroup: "admin" } }), "admin");
  assert.equal(resolveSessionGroupForApp({ slug: "custom", metadata: { sessionGroup: "unknown" } }), "default");
  assert.equal(resolveSessionGroupForApp({ slug: "admin", metadata: null }), "admin");

  assert.equal(isSessionGroupCompatible("admin", "admin"), true);
  assert.equal(isSessionGroupCompatible("default", "admin"), false);
});
