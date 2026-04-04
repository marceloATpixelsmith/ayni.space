import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import authRouter from "../routes/auth.js";
import { createMountedSessionApp, createSessionApp, ensureTestDatabaseEnv, patchProperty, performJsonRequest } from "./helpers.js";
import { appsTable, auditLogsTable, authTokensTable, db, userAuthSecurityTable, userCredentialsTable, usersTable } from "@workspace/db";
import { createSecurityEnforcementMiddleware } from "../lib/securityPolicy.js";

type InsertPayload = Record<string, unknown>;

function setupDbInsertCapture(capturedAuditRows: InsertPayload[]) {
  return patchProperty(db, "insert", ((table: unknown) => {
    if (table === auditLogsTable) {
      return {
        values: (payload: InsertPayload) => {
          capturedAuditRows.push(payload);
          return Promise.resolve(undefined);
        },
      };
    }

    if (table === usersTable) {
      return {
        values: (payload: InsertPayload) => ({
          returning: async () => [{ id: "user-created", email: payload.email, name: payload.name }],
        }),
      };
    }

    if (table === userAuthSecurityTable) {
      return {
        values: (_payload: InsertPayload) => ({
          onConflictDoUpdate: async () => undefined,
        }),
      };
    }

    if (table === userCredentialsTable || table === authTokensTable) {
      return {
        values: async () => undefined,
      };
    }

    return {
      values: async () => undefined,
    };
  }) as never);
}

test.before(() => {
  ensureTestDatabaseEnv();
});

test("signup denial logs disposable_email reason code", async () => {
  const prevIpqsKey = process.env["IPQS_API_KEY"];
  process.env["IPQS_API_KEY"] = "test-key";

  const auditRows: InsertPayload[] = [];
  const previousFetch = globalThis.fetch;
  const restores = [
    setupDbInsertCapture(auditRows),
    patchProperty(db.query.appsTable, "findFirst", async () => ({ id: "app-1", slug: "admin", accessMode: "superadmin", isActive: true, customerRegistrationEnabled: false })),
  ];

  globalThis.fetch = (async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("ipqualityscore.com")) {
      return new Response(JSON.stringify({ fraud_score: 99, disposable: true, valid: true, smtp_score: 0.9 }), { status: 200 });
    }
    return previousFetch(input, init);
  }) as typeof fetch;

  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {});
    const response = await performJsonRequest(app, "POST", "/api/auth/signup", {
      email: "disposable@example.com",
      password: "SuperSecret123!",
      name: "Disposable",
    });

    assert.equal(response.status, 400);
    const row = auditRows.find((entry) => entry.action === "auth.signup.decision");
    assert.ok(row);
    const metadata = row.metadata as Record<string, unknown>;
    assert.equal(metadata.reasonCode, "disposable_email");
    assert.equal(metadata.decisionCategory, "block");
    assert.equal(typeof metadata.normalizedEmailHash, "string");
    assert.equal(metadata.normalizedEmailHash === "disposable@example.com", false);
  } finally {
    globalThis.fetch = previousFetch;
    restores.reverse().forEach((restore) => restore());
    if (prevIpqsKey === undefined) delete process.env["IPQS_API_KEY"];
    else process.env["IPQS_API_KEY"] = prevIpqsKey;
  }
});

test("signup denial logs undeliverable_email reason code", async () => {
  const prevIpqsKey = process.env["IPQS_API_KEY"];
  process.env["IPQS_API_KEY"] = "test-key";

  const auditRows: InsertPayload[] = [];
  const previousFetch = globalThis.fetch;
  const restores = [
    setupDbInsertCapture(auditRows),
    patchProperty(db.query.appsTable, "findFirst", async () => ({ id: "app-1", slug: "admin", accessMode: "superadmin", isActive: true, customerRegistrationEnabled: false })),
  ];

  globalThis.fetch = (async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("ipqualityscore.com")) {
      return new Response(JSON.stringify({ fraud_score: 10, disposable: false, valid: false, smtp_score: 0.1 }), { status: 200 });
    }
    return previousFetch(input, init);
  }) as typeof fetch;

  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {});
    const response = await performJsonRequest(app, "POST", "/api/auth/signup", {
      email: "undeliverable@example.com",
      password: "SuperSecret123!",
      name: "Undeliverable",
    });

    assert.equal(response.status, 400);
    const row = auditRows.find((entry) => entry.action === "auth.signup.decision");
    assert.ok(row);
    assert.equal((row.metadata as Record<string, unknown>).reasonCode, "undeliverable_email");
  } finally {
    globalThis.fetch = previousFetch;
    restores.reverse().forEach((restore) => restore());
    if (prevIpqsKey === undefined) delete process.env["IPQS_API_KEY"];
    else process.env["IPQS_API_KEY"] = prevIpqsKey;
  }
});

test("signup duplicate-email denial logs duplicate_existing_email reason code", async () => {
  const prevIpqsKey = process.env["IPQS_API_KEY"];
  process.env["IPQS_API_KEY"] = "test-key";

  const auditRows: InsertPayload[] = [];
  const previousFetch = globalThis.fetch;
  const restores = [
    setupDbInsertCapture(auditRows),
    patchProperty(db.query.appsTable, "findFirst", async () => ({ id: "app-1", slug: "admin", accessMode: "superadmin", isActive: true, customerRegistrationEnabled: false })),
    patchProperty(db.query.usersTable, "findFirst", async () => ({ id: "user-1", email: "duplicate@example.com" })),
    patchProperty(db.query.userCredentialsTable, "findFirst", async () => ({ id: "cred-1", userId: "user-1", credentialType: "password" })),
  ];

  globalThis.fetch = (async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("ipqualityscore.com")) {
      return new Response(JSON.stringify({ fraud_score: 5, disposable: false, valid: true, smtp_score: 0.8 }), { status: 200 });
    }
    return previousFetch(input, init);
  }) as typeof fetch;

  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {});
    const response = await performJsonRequest(app, "POST", "/api/auth/signup", {
      email: "duplicate@example.com",
      password: "SuperSecret123!",
      name: "Duplicate",
    });

    assert.equal(response.status, 409);
    const row = auditRows.find((entry) => entry.action === "auth.signup.decision");
    assert.ok(row);
    const metadata = row.metadata as Record<string, unknown>;
    assert.equal(metadata.reasonCode, "duplicate_existing_email");
    assert.equal(metadata.decisionCategory, "duplicate_email");
  } finally {
    globalThis.fetch = previousFetch;
    restores.reverse().forEach((restore) => restore());
    if (prevIpqsKey === undefined) delete process.env["IPQS_API_KEY"];
    else process.env["IPQS_API_KEY"] = prevIpqsKey;
  }
});

test("signup policy denial logs signup_not_allowed_by_access_policy reason code", async () => {
  const auditRows: InsertPayload[] = [];
  const restores = [
    setupDbInsertCapture(auditRows),
    patchProperty(db.query.appsTable, "findFirst", async () => ({ id: "app-2", slug: "admin", accessMode: "organization", isActive: true, customerRegistrationEnabled: false })),
  ];

  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {});
    const response = await performJsonRequest(app, "POST", "/api/auth/signup", {
      email: "policy@example.com",
      password: "SuperSecret123!",
      name: "Policy",
    });

    assert.equal(response.status, 403);
    const row = auditRows.find((entry) => entry.action === "auth.signup.decision");
    assert.ok(row);
    assert.equal((row.metadata as Record<string, unknown>).reasonCode, "signup_not_allowed_by_access_policy");
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("signup provider-failure step-up logs ipqs_provider_failure_step_up reason code", async () => {
  const prevNodeEnv = process.env["NODE_ENV"];
  const prevIpqsKey = process.env["IPQS_API_KEY"];
  process.env["NODE_ENV"] = "test";
  process.env["IPQS_API_KEY"] = "test-key";

  const auditRows: InsertPayload[] = [];
  const previousFetch = globalThis.fetch;
  const restores = [
    setupDbInsertCapture(auditRows),
    patchProperty(db.query.appsTable, "findFirst", async () => ({ id: "app-1", slug: "admin", accessMode: "superadmin", isActive: true, customerRegistrationEnabled: false })),
    patchProperty(db.query.usersTable, "findFirst", async () => ({ id: "user-1", email: "provider@example.com" })),
    patchProperty(db.query.userCredentialsTable, "findFirst", async () => null),
  ];

  globalThis.fetch = (async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("ipqualityscore.com")) {
      throw new Error("ipqs unavailable");
    }
    return previousFetch(input, init);
  }) as typeof fetch;

  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {});
    const response = await performJsonRequest(app, "POST", "/api/auth/signup", {
      email: "provider@example.com",
      password: "SuperSecret123!",
      name: "Provider",
    });

    assert.equal(response.status, 201);
    const row = auditRows.find((entry) => entry.action === "auth.signup.decision" && (entry.metadata as Record<string, unknown>).reasonCode === "ipqs_provider_failure_step_up");
    assert.ok(row);
    assert.equal((row.metadata as Record<string, unknown>).decisionCategory, "provider_failure");
  } finally {
    globalThis.fetch = previousFetch;
    restores.reverse().forEach((restore) => restore());
    if (prevNodeEnv === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = prevNodeEnv;
    if (prevIpqsKey === undefined) delete process.env["IPQS_API_KEY"];
    else process.env["IPQS_API_KEY"] = prevIpqsKey;
  }
});

test("turnstile signup denial logs turnstile_missing_or_invalid reason code", async () => {
  const prevNodeEnv = process.env["NODE_ENV"];
  const prevTurnstileEnabled = process.env["TURNSTILE_ENABLED"];
  process.env["NODE_ENV"] = "development";
  process.env["TURNSTILE_ENABLED"] = "true";

  const auditEntries: Array<{ action: string; metadata?: Record<string, unknown> }> = [];

  try {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { session: Record<string, unknown> }).session = {};
      next();
    });
    app.use(createSecurityEnforcementMiddleware({
      verifyFn: async () => false,
      writeAuditLogFn: (entry) => {
        auditEntries.push({ action: entry.action, metadata: (entry.metadata ?? undefined) as Record<string, unknown> | undefined });
      },
    }));
    app.use("/api/auth", authRouter);

    const response = await performJsonRequest(app as ReturnType<typeof createSessionApp>, "POST", "/api/auth/signup", {
      email: "turnstile@example.com",
      password: "SuperSecret123!",
      name: "Turnstile",
    });

    assert.equal(response.status, 403);
    const entry = auditEntries.find((item) => item.action.startsWith("turnstile.failed"));
    assert.ok(entry);
    assert.equal(entry.metadata?.reasonCode, "turnstile_missing_or_invalid");
    assert.equal(entry.metadata?.decisionCategory, "turnstile_failed");
  } finally {
    if (prevNodeEnv === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = prevNodeEnv;
    if (prevTurnstileEnabled === undefined) delete process.env["TURNSTILE_ENABLED"];
    else process.env["TURNSTILE_ENABLED"] = prevTurnstileEnabled;
  }
});
