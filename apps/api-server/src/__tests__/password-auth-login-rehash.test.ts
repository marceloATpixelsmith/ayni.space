import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { promisify } from "node:util";
import express, { type RequestHandler } from "express";
import session from "express-session";
import { createMountedSessionApp, ensureTestDatabaseEnv, patchProperty, performJsonRequest } from "./helpers.js";

ensureTestDatabaseEnv();

const { db } = await import("@workspace/db");
const { default: authRouter } = await import("../routes/auth.js");
const { createSessionMiddleware, getSessionCookieName, getSessionCookieOptions, getSessionPolicy } = await import("../lib/session.js");
const { csrfTokenEndpoint } = await import("../middlewares/csrf.js");

const scryptAsync = promisify(crypto.scrypt);

async function hashLegacyScrypt(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

function extractCookiePair(setCookieHeader: string | null): string | null {
  if (!setCookieHeader) return null;
  return setCookieHeader.split(";", 1)[0] ?? null;
}

function toVisibleSid(cookiePair: string | null): string | null {
  if (!cookiePair) return null;
  const [, ...valueParts] = cookiePair.split("=");
  const rawValue = valueParts.join("=").trim();
  if (!rawValue) return null;
  const decodedValue = (() => {
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  })();
  const unsigned = decodedValue.startsWith("s:") ? decodedValue.slice(2) : decodedValue;
  const signatureSeparator = unsigned.lastIndexOf(".");
  return signatureSeparator > 0 ? unsigned.slice(0, signatureSeparator) : unsigned;
}

test("legacy scrypt login transparently upgrades stored hash to current versioned format", async () => {
  const legacyHash = await hashLegacyScrypt("StrongPassword123!");
  let upgradedHash: string | null = null;

  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-1",
      email: "user@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
      emailVerifiedAt: new Date(),
    })),
    patchProperty(db.query.userCredentialsTable, "findFirst", async () => ({
      id: "cred-1",
      userId: "user-1",
      credentialType: "password",
      passwordHash: legacyHash,
    })),
    patchProperty(db, "update", (() => ({
      set: (values: Record<string, unknown>) => {
        if (typeof values["passwordHash"] === "string") {
          upgradedHash = values["passwordHash"] as string;
        }
        return {
          where: async () => undefined,
        };
      },
    })) as unknown as typeof db.update),
  ];

  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {});
    const response = await performJsonRequest(app, "POST", "/api/auth/login", {
      email: "user@example.com",
      password: "StrongPassword123!",
    });

    assert.equal(response.status, 200);
    assert.equal(typeof upgradedHash, "string");
    assert.equal((upgradedHash ?? "").startsWith("scrypt-v2$"), true);
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("password login prioritizes invitation continuation returnToPath over generic post-auth redirects", async () => {
  const legacyHash = await hashLegacyScrypt("StrongPassword123!");

  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-1",
      email: "user@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
      emailVerifiedAt: new Date(),
      isSuperAdmin: false,
      activeOrgId: null,
      name: "User",
      avatarUrl: null,
    })),
    patchProperty(db.query.userCredentialsTable, "findFirst", async () => ({
      id: "cred-1",
      userId: "user-1",
      credentialType: "password",
      passwordHash: legacyHash,
    })),
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "admin-app",
      slug: "admin",
      isActive: true,
      accessMode: "superadmin",
      staffInvitesEnabled: false,
      customerRegistrationEnabled: false,
    })),
    patchProperty(db.query.userAuthSecurityTable, "findFirst", async () => null),
    patchProperty(db, "update", (() => ({
      set: () => ({
        where: async () => undefined,
      }),
    })) as unknown as typeof db.update),
  ];

  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {});
    const response = await performJsonRequest(app, "POST", "/api/auth/login", {
      email: "user@example.com",
      password: "StrongPassword123!",
      returnToPath: "/invitations/test-token/accept",
    });

    assert.equal(response.status, 200);
    assert.equal(response.body?.nextPath, "/invitations/test-token/accept");
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("login returns mfa_challenge for users with active MFA factor", async () => {
  const legacyHash = await hashLegacyScrypt("StrongPassword123!");

  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-1",
      email: "user@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
      emailVerifiedAt: new Date(),
      isSuperAdmin: false,
    })),
    patchProperty(db.query.userCredentialsTable, "findFirst", async () => ({
      id: "cred-1",
      userId: "user-1",
      credentialType: "password",
      passwordHash: legacyHash,
    })),
    patchProperty(db.query.userAuthSecurityTable, "findFirst", async () => ({
      userId: "user-1",
      mfaRequired: true,
      forceMfaEnrollment: false,
      firstAuthAfterResetPending: false,
      highRiskUntilMfaAt: null,
    })),
    patchProperty(db.query.mfaFactorsTable, "findFirst", async () => ({
      id: "factor-1",
      userId: "user-1",
      factorType: "totp",
      status: "active",
      secretCiphertext: "cipher",
      secretIv: "iv",
      secretTag: "tag",
    })),
    patchProperty(db, "update", (() => ({
      set: () => ({
        where: async () => undefined,
      }),
    })) as unknown as typeof db.update),
  ];

  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {});
    const response = await performJsonRequest(app, "POST", "/api/auth/login", {
      email: "user@example.com",
      password: "StrongPassword123!",
    });

    assert.equal(response.status, 202);
    assert.equal(response.body?.mfaRequired, true);
    assert.equal(response.body?.needsEnrollment, false);
    assert.equal(response.body?.nextStep, "mfa_challenge");
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("mfa-required login persists pending invitation continuation returnToPath in session", async () => {
  const legacyHash = await hashLegacyScrypt("StrongPassword123!");
  const persistedSession: Record<string, unknown> = {};
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-1",
      email: "user@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
      emailVerifiedAt: new Date(),
      isSuperAdmin: false,
      activeOrgId: null,
      name: "User",
      avatarUrl: null,
    })),
    patchProperty(db.query.userCredentialsTable, "findFirst", async () => ({
      id: "cred-1",
      userId: "user-1",
      credentialType: "password",
      passwordHash: legacyHash,
    })),
    patchProperty(db.query.userAuthSecurityTable, "findFirst", async () => ({
      userId: "user-1",
      mfaRequired: true,
      forceMfaEnrollment: false,
      firstAuthAfterResetPending: false,
      highRiskUntilMfaAt: null,
    })),
    patchProperty(db.query.mfaFactorsTable, "findFirst", async () => ({
      id: "factor-1",
      userId: "user-1",
      factorType: "totp",
      status: "active",
      secretCiphertext: "cipher",
      secretIv: "iv",
      secretTag: "tag",
    })),
    patchProperty(db, "update", (() => ({
      set: () => ({
        where: async () => undefined,
      }),
    })) as unknown as typeof db.update),
  ];

  try {
    const app = express();
    app.use(express.json());
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

    const response = await performJsonRequest(app, "POST", "/api/auth/login", {
      email: "user@example.com",
      password: "StrongPassword123!",
      returnToPath: "/invitations/test-token/accept",
    });

    assert.equal(response.status, 202);
    assert.equal(
      (persistedSession.pendingPostAuthContinuation as { returnPath?: string } | undefined)
        ?.returnPath,
      "/invitations/test-token/accept",
    );
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("login fails closed to mfa_challenge when active factor lookup errors", async () => {
  const legacyHash = await hashLegacyScrypt("StrongPassword123!");

  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-1",
      email: "user@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
      emailVerifiedAt: new Date(),
      isSuperAdmin: false,
    })),
    patchProperty(db.query.userCredentialsTable, "findFirst", async () => ({
      id: "cred-1",
      userId: "user-1",
      credentialType: "password",
      passwordHash: legacyHash,
    })),
    patchProperty(db.query.userAuthSecurityTable, "findFirst", async () => ({
      userId: "user-1",
      mfaRequired: true,
      forceMfaEnrollment: false,
      firstAuthAfterResetPending: false,
      highRiskUntilMfaAt: null,
    })),
    patchProperty(db.query.mfaFactorsTable, "findFirst", async () => {
      throw new Error("temporary mfa factor read failure");
    }),
    patchProperty(db, "update", (() => ({
      set: () => ({
        where: async () => undefined,
      }),
    })) as unknown as typeof db.update),
  ];

  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {});
    const response = await performJsonRequest(app, "POST", "/api/auth/login", {
      email: "user@example.com",
      password: "StrongPassword123!",
    });

    assert.equal(response.status, 202);
    assert.equal(response.body?.mfaRequired, true);
    assert.equal(response.body?.needsEnrollment, false);
    assert.equal(response.body?.nextStep, "mfa_challenge");
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("mfa enroll start returns mfa_challenge hint when pending session already has an active factor", async () => {
  const restores = [
    patchProperty(db.query.mfaFactorsTable, "findFirst", async () => ({
      id: "factor-1",
      userId: "user-1",
      factorType: "totp",
      status: "active",
      secretCiphertext: "cipher",
      secretIv: "iv",
      secretTag: "tag",
    })),
  ];

  try {
    const app = createMountedSessionApp(
      [{ path: "/api/auth", router: authRouter }],
      {
        pendingUserId: "user-1",
        pendingAppSlug: "admin",
        pendingMfaReason: "challenge_required",
      },
    );
    const response = await performJsonRequest(app, "POST", "/api/auth/mfa/enroll/start", {});

    assert.equal(response.status, 409);
    assert.equal(response.body?.mfaRequired, true);
    assert.equal(response.body?.needsEnrollment, false);
    assert.equal(response.body?.nextStep, "mfa_challenge");
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("admin MFA login regenerates to a new pending session id and preserves that id across /api/auth/me and /api/csrf-token", async () => {
  process.env["SESSION_SECRET"] ??= "test-session-secret";
  process.env["ALLOWED_ORIGINS"] = "http://admin.local,http://workspace.local";
  process.env["ADMIN_FRONTEND_ORIGINS"] = "http://admin.local";
  process.env["AUTH_DEBUG"] = "true";

  const legacyHash = await hashLegacyScrypt("StrongPassword123!");
  const user = {
    id: "user-1",
    email: "user@example.com",
    active: true,
    suspended: false,
    deletedAt: null,
    emailVerifiedAt: new Date(),
    isSuperAdmin: false,
    activeOrgId: null,
    name: "Test User",
    avatarUrl: null,
  };

  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => user),
    patchProperty(db.query.userCredentialsTable, "findFirst", async () => ({
      id: "cred-1",
      userId: "user-1",
      credentialType: "password",
      passwordHash: legacyHash,
    })),
    patchProperty(db.query.userAuthSecurityTable, "findFirst", async () => ({
      userId: "user-1",
      mfaRequired: true,
      forceMfaEnrollment: false,
      firstAuthAfterResetPending: false,
      highRiskUntilMfaAt: null,
    })),
    patchProperty(db.query.mfaFactorsTable, "findFirst", async () => ({
      id: "factor-1",
      userId: "user-1",
      factorType: "totp",
      status: "active",
      secretCiphertext: "cipher",
      secretIv: "iv",
      secretTag: "tag",
    })),
    patchProperty(db, "update", (() => ({
      set: () => ({
        where: async () => undefined,
      }),
    })) as unknown as typeof db.update),
  ];

  const middlewareByGroup = new Map<string, RequestHandler>();
  const idleTimeoutMs = getSessionPolicy().idleTimeoutMs;
  for (const group of ["admin", "default"]) {
    middlewareByGroup.set(group, session({
      secret: process.env["SESSION_SECRET"] as string,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      name: getSessionCookieName(group),
      cookie: {
        ...getSessionCookieOptions(),
        maxAge: idleTimeoutMs,
      },
      genid: () => `${group}.${crypto.randomUUID()}`,
    }));
  }

  const app = express();
  app.use(express.json());
  app.use(createSessionMiddleware(middlewareByGroup));
  app.get("/api/debug/session", (req, res) => {
    if (!(req.session as Record<string, unknown>)["csrfToken"]) {
      (req.session as Record<string, unknown>)["csrfToken"] = "seed";
    }
    res.json({
      sessionId: req.sessionID,
      userId: req.session.userId ?? null,
      pendingUserId: req.session.pendingUserId ?? null,
      keys: Object.keys(req.session ?? {}).sort(),
    });
  });
  app.get("/api/csrf-token", csrfTokenEndpoint);
  app.use("/api/auth", authRouter);

  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let cookieJar: string | null = null;

  try {
    const seedResp = await fetch(`${baseUrl}/api/debug/session`, {
      headers: { origin: "http://admin.local" },
    });
    assert.equal(seedResp.status, 200);
    const seedCookiePair = extractCookiePair(seedResp.headers.get("set-cookie"));
    assert.ok(seedCookiePair);
    cookieJar = seedCookiePair;
    const anonymousSid = toVisibleSid(seedCookiePair);
    assert.ok(anonymousSid?.startsWith("admin."));
    console.info(`[SESSION-TRACE] login:incoming anonymousSid=${anonymousSid}`);

    const loginResp = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        origin: "http://admin.local",
        cookie: cookieJar,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "user@example.com", password: "StrongPassword123!" }),
    });
    assert.equal(loginResp.status, 202);
    const loginCookiePair = extractCookiePair(loginResp.headers.get("set-cookie"));
    assert.ok(loginCookiePair);
    const postLoginSid = toVisibleSid(loginCookiePair);
    assert.ok(postLoginSid?.startsWith("admin."));
    assert.notEqual(postLoginSid, anonymousSid);
    console.info(`[SESSION-TRACE] login:set-cookie raw=${loginCookiePair}`);
    console.info(`[SESSION-TRACE] login:postRegenerateSid=${postLoginSid}`);
    cookieJar = loginCookiePair;

    const meResp = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        origin: "http://admin.local",
        cookie: cookieJar,
      },
    });
    assert.equal(meResp.status, 200);
    const mePayload = await meResp.json() as Record<string, unknown>;
    assert.equal(mePayload["mfaPending"], true);
    assert.equal(mePayload["nextStep"], "mfa_challenge");

    const meSetCookieSid = toVisibleSid(extractCookiePair(meResp.headers.get("set-cookie")));
    assert.equal(meSetCookieSid, postLoginSid);
    console.info(`[SESSION-TRACE] next:/api/auth/me sid=${postLoginSid} setCookieSid=${meSetCookieSid}`);

    const csrfResp = await fetch(`${baseUrl}/api/csrf-token`, {
      headers: {
        origin: "http://admin.local",
        cookie: cookieJar,
      },
    });
    assert.equal(csrfResp.status, 200);
    const csrfSetCookieSid = toVisibleSid(extractCookiePair(csrfResp.headers.get("set-cookie")));
    assert.equal(csrfSetCookieSid, postLoginSid);
    console.info(`[SESSION-TRACE] next:/api/csrf-token sid=${postLoginSid} setCookieSid=${csrfSetCookieSid}`);
  } finally {
    restores.reverse().forEach((restore) => restore());
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    delete process.env["AUTH_DEBUG"];
  }
});
