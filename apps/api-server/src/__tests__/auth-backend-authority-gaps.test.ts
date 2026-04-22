import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import express from "express";
import { ensureTestDatabaseEnv, patchProperty } from "./helpers.js";

ensureTestDatabaseEnv();

const { db } = await import("@workspace/db");
const { resolvePostAuthContinuation } = await import("../lib/postAuthContinuation.js");
const {
  resolveAuthenticatedPostAuthDestination,
} = await import("../lib/postAuthDestination.js");
const {
  assertRequestSessionGroupCompatibleWithOrg,
  isSessionGroupCompatible,
  resolveSessionGroupForApp,
} = await import("../lib/sessionGroupCompatibility.js");
const sessionGroupLib = await import("../lib/sessionGroup.js");
const { turnstileVerifyMiddleware } = await import("../middlewares/turnstile.js");
const { requireAuth } = await import("../middlewares/requireAuth.js");
const authLib = await import("../lib/auth.js");
const passwordAuthLib = await import("../lib/passwordAuth.js");
const mfaLib = await import("../lib/mfa.js");

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
  assert.equal(fallbackOnly, null);
});

test("invitation acceptance route does not hardcode dashboard masking fallback", () => {
  const invitationsRouteSource = readFileSync(
    new URL("../routes/invitations.ts", import.meta.url),
    "utf8",
  );
  assert.equal(
    invitationsRouteSource.includes('let nextPath = "/dashboard";'),
    false,
  );
  assert.equal(
    invitationsRouteSource.includes('fallbackPath: "/dashboard"'),
    false,
  );
});

test("finalizeInvitationAcceptance resolves post-auth destination through canonical resolver only", () => {
  const invitationsRouteSource = readFileSync(
    new URL("../routes/invitations.ts", import.meta.url),
    "utf8",
  );
  const functionStart = invitationsRouteSource.indexOf("async function finalizeInvitationAcceptance(");
  assert.notEqual(functionStart, -1, "Expected finalizeInvitationAcceptance() to exist.");
  const functionEnd = invitationsRouteSource.indexOf("\n\nasync function listInvitations", functionStart);
  assert.notEqual(functionEnd, -1, "Expected finalizeInvitationAcceptance() boundary to be discoverable.");
  const finalizeSource = invitationsRouteSource.slice(functionStart, functionEnd);

  assert.equal(
    finalizeSource.includes('"/dashboard"'),
    false,
    "finalizeInvitationAcceptance() must not contain /dashboard fallback shortcuts.",
  );
  assert.equal(
    finalizeSource.includes("resolveAuthenticatedPostAuthDestination({"),
    true,
    "finalizeInvitationAcceptance() must route destination resolution through canonical resolver.",
  );
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
  const prevSessionGroupAppSlugs = process.env["SESSION_GROUP_APP_SLUGS"];
  process.env["SESSION_GROUP_APP_SLUGS"] = "admin=admin";
  try {
    assert.equal(resolveSessionGroupForApp({ slug: "custom", metadata: { sessionGroup: "admin" } }), "admin");
    assert.equal(resolveSessionGroupForApp({ slug: "custom", metadata: { sessionGroup: "unknown" } }), "default");
    assert.equal(resolveSessionGroupForApp({ slug: "admin", metadata: null }), "admin");
    assert.equal(resolveSessionGroupForApp({ slug: "shipibo", metadata: null }), "default");

    assert.equal(isSessionGroupCompatible("admin", "admin"), true);
    assert.equal(isSessionGroupCompatible("default", "admin"), false);
  } finally {
    if (prevSessionGroupAppSlugs === undefined) delete process.env["SESSION_GROUP_APP_SLUGS"];
    else process.env["SESSION_GROUP_APP_SLUGS"] = prevSessionGroupAppSlugs;
  }
});

test("verify-email continuation enforces app-bound destination resolution", () => {
  const continuation = resolvePostAuthContinuation({
    appSlug: "admin",
    returnPath: "/verify-email/continue",
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

test("unknown auth appSlug is rejected instead of silently falling back to default session group", () => {
  const prevSessionGroupAppSlugs = process.env["SESSION_GROUP_APP_SLUGS"];
  process.env["SESSION_GROUP_APP_SLUGS"] = "admin=admin,ayni=default";

  try {
    const req = {
      path: "/api/auth/login",
      method: "POST",
      headers: {},
      body: { appSlug: "unmapped-app" },
      query: {},
    } as unknown as express.Request;

    const resolution = sessionGroupLib.resolveSessionGroupForRequest(req, { failOnAmbiguous: true });
    assert.deepEqual(resolution, { ok: false, reason: "unknown-app-group" });
  } finally {
    if (prevSessionGroupAppSlugs === undefined) delete process.env["SESSION_GROUP_APP_SLUGS"];
    else process.env["SESSION_GROUP_APP_SLUGS"] = prevSessionGroupAppSlugs;
  }
});

test("turnstile signup audit metadata keeps unresolved session group as null (no hidden fallback)", async () => {
  const prevTurnstileEnabled = process.env["TURNSTILE_ENABLED"];
  process.env["TURNSTILE_ENABLED"] = "true";
  let capturedMetadata: Record<string, unknown> | null = null;
  const middleware = turnstileVerifyMiddleware({
    verifyFn: async () => false,
    writeAuditLogFn: async (entry) => {
      capturedMetadata = (entry.metadata ?? {}) as Record<string, unknown>;
    },
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const req = {
        path: "/api/auth/signup",
        method: "POST",
        ip: "127.0.0.1",
        headers: { "cf-turnstile-response": "dummy" },
        body: { email: "test@example.com" },
        session: {},
      } as unknown as express.Request;
      const res = {
        status: (_status: number) => ({
          json: () => resolve(),
        }),
      } as unknown as express.Response;

      middleware(req, res, (err) => {
        if (err) reject(err);
        else reject(new Error("Expected middleware to reject invalid turnstile token"));
      });
    });

    assert.ok(capturedMetadata);
    assert.equal(capturedMetadata["sessionGroup"], null);
    assert.equal(capturedMetadata["appSlug"], null);
  } finally {
    if (prevTurnstileEnabled === undefined) delete process.env["TURNSTILE_ENABLED"];
    else process.env["TURNSTILE_ENABLED"] = prevTurnstileEnabled;
  }
});


test("google auth url builder preserves caller-provided state and scopes", () => {
  const prevClientId = process.env["GOOGLE_CLIENT_ID"];
  const prevClientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  const prevRedirectUri = process.env["GOOGLE_REDIRECT_URI"];
  process.env["GOOGLE_CLIENT_ID"] = "test-client-id";
  process.env["GOOGLE_CLIENT_SECRET"] = "test-client-secret";
  process.env["GOOGLE_REDIRECT_URI"] = "http://api.local/api/auth/google/callback";

  try {
    const url = authLib.buildGoogleAuthUrl("default.test-state-token");
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("state"), "default.test-state-token");
    assert.equal(parsed.searchParams.get("scope"), "openid email profile");
  } finally {
    if (prevClientId === undefined) delete process.env["GOOGLE_CLIENT_ID"];
    else process.env["GOOGLE_CLIENT_ID"] = prevClientId;
    if (prevClientSecret === undefined) delete process.env["GOOGLE_CLIENT_SECRET"];
    else process.env["GOOGLE_CLIENT_SECRET"] = prevClientSecret;
    if (prevRedirectUri === undefined) delete process.env["GOOGLE_REDIRECT_URI"];
    else process.env["GOOGLE_REDIRECT_URI"] = prevRedirectUri;
  }
});

test("google auth client creation fails closed when required env is missing", () => {
  const prevClientId = process.env["GOOGLE_CLIENT_ID"];
  const prevClientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  const prevRedirectUri = process.env["GOOGLE_REDIRECT_URI"];
  delete process.env["GOOGLE_CLIENT_ID"];
  process.env["GOOGLE_CLIENT_SECRET"] = "test-client-secret";
  process.env["GOOGLE_REDIRECT_URI"] = "http://api.local/api/auth/google/callback";

  try {
    assert.throws(() => authLib.getGoogleClient(), /GOOGLE_CLIENT_ID environment variable is required/);
  } finally {
    if (prevClientId === undefined) delete process.env["GOOGLE_CLIENT_ID"];
    else process.env["GOOGLE_CLIENT_ID"] = prevClientId;
    if (prevClientSecret === undefined) delete process.env["GOOGLE_CLIENT_SECRET"];
    else process.env["GOOGLE_CLIENT_SECRET"] = prevClientSecret;
    if (prevRedirectUri === undefined) delete process.env["GOOGLE_REDIRECT_URI"];
    else process.env["GOOGLE_REDIRECT_URI"] = prevRedirectUri;
  }
});

test("password auth opaque identifier is null for blank email input", () => {
  assert.equal(passwordAuthLib.getPasswordAuthOpaqueIdentifier("   "), null);
});

test("MFA requirement uses user auth-security override independent of activeOrgId", async () => {
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "mfa-user",
      isSuperAdmin: false,
    })),
    patchProperty(db.query.userAuthSecurityTable, "findFirst", async () => ({
      id: "security-row",
      userId: "mfa-user",
      mfaRequired: false,
      forceMfaEnrollment: true,
      firstAuthAfterResetPending: false,
      highRiskUntilMfaAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => null),
  ];

  try {
    const requiredWithOrg = await mfaLib.isMfaRequiredForUser("mfa-user", "org-123");
    const requiredWithoutOrg = await mfaLib.isMfaRequiredForUser("mfa-user", null);
    assert.equal(requiredWithOrg, true);
    assert.equal(requiredWithoutOrg, true);
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});
