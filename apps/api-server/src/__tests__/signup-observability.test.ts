import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createMountedSessionApp, createSessionApp, ensureTestDatabaseEnv, patchProperty, performJsonRequest } from "./helpers.js";

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

ensureTestDatabaseEnv();

const { default: authRouter } = await import("../routes/auth.js");
const { appsTable, auditLogsTable, authTokensTable, db, userAuthSecurityTable, userCredentialsTable, usersTable } = await import("@workspace/db");
const { createSecurityEnforcementMiddleware } = await import("../lib/securityPolicy.js");
const restoreEmailTemplateLookup = patchProperty(
  db.query.emailTemplatesTable,
  "findFirst",
  async () => ({
    id: "tmpl-1",
    appId: "app-1",
    templateType: "email_verification",
    subjectTemplate: "Verify your email",
    htmlTemplate: "<p>Verify {{verification_link}}</p>",
    textTemplate: "Verify {{verification_link}}",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
);

test.after(() => {
  restoreEmailTemplateLookup();
});

test("signup denial logs disposable_email reason code", async () => {
  const prevIpqsKey = process.env["IPQS_API_KEY"];
  process.env["IPQS_API_KEY"] = "test-key";

  const auditRows: InsertPayload[] = [];
  const previousFetch = globalThis.fetch;
  const restores = [
    setupDbInsertCapture(auditRows),
    patchProperty(db.query.appsTable, "findFirst", async () => ({ id: "app-1", slug: "admin", accessMode: "organization", isActive: true, customerRegistrationEnabled: true, transactionalFromEmail: "no-reply@example.com", transactionalFromName: "Ayni", transactionalReplyToEmail: "support@example.com" })),
    patchProperty(db.query.usersTable, "findFirst", async () => null),
    patchProperty(db.query.userCredentialsTable, "findFirst", async () => null),
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
    assert.equal(metadata.normalizedEmailMasked, "di***@example.com");
    assert.equal(metadata.normalizedEmailDomain, "example.com");
    assert.equal(metadata.normalizedEmailHash === "disposable@example.com", false);
  } finally {
    globalThis.fetch = previousFetch;
    restores.reverse().forEach((restore) => restore());
    if (prevIpqsKey === undefined) delete process.env["IPQS_API_KEY"];
    else process.env["IPQS_API_KEY"] = prevIpqsKey;
  }
});

test("signup step-up logs undeliverable_email reason code", async () => {
  const prevIpqsKey = process.env["IPQS_API_KEY"];
  process.env["IPQS_API_KEY"] = "test-key";

  const auditRows: InsertPayload[] = [];
  const previousFetch = globalThis.fetch;
  const restores = [
    setupDbInsertCapture(auditRows),
    patchProperty(db.query.appsTable, "findFirst", async () => ({ id: "app-1", slug: "admin", accessMode: "organization", isActive: true, customerRegistrationEnabled: true, transactionalFromEmail: "no-reply@example.com", transactionalFromName: "Ayni", transactionalReplyToEmail: "support@example.com" })),
    patchProperty(db.query.usersTable, "findFirst", async () => null),
    patchProperty(db.query.userCredentialsTable, "findFirst", async () => null),
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

    assert.equal(response.status, 201);
    const row = auditRows.find((entry) => entry.action === "auth.signup.decision");
    assert.ok(row);
    const metadata = row.metadata as Record<string, unknown>;
    assert.equal(metadata.reasonCode, "undeliverable_email");
    assert.equal(metadata.decisionCategory, "step_up");
  } finally {
    globalThis.fetch = previousFetch;
    restores.reverse().forEach((restore) => restore());
    if (prevIpqsKey === undefined) delete process.env["IPQS_API_KEY"];
    else process.env["IPQS_API_KEY"] = prevIpqsKey;
  }
});

test("signup step-up logs ipqs_advisory_step_up reason code for high fraud score", async () => {
  const prevIpqsKey = process.env["IPQS_API_KEY"];
  process.env["IPQS_API_KEY"] = "test-key";

  const auditRows: InsertPayload[] = [];
  const previousFetch = globalThis.fetch;
  const restores = [
    setupDbInsertCapture(auditRows),
    patchProperty(db.query.appsTable, "findFirst", async () => ({ id: "app-1", slug: "admin", accessMode: "organization", isActive: true, customerRegistrationEnabled: true, transactionalFromEmail: "no-reply@example.com", transactionalFromName: "Ayni", transactionalReplyToEmail: "support@example.com" })),
    patchProperty(db.query.usersTable, "findFirst", async () => null),
    patchProperty(db.query.userCredentialsTable, "findFirst", async () => null),
  ];

  globalThis.fetch = (async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("ipqualityscore.com")) {
      return new Response(JSON.stringify({ fraud_score: 95, disposable: false, valid: true, smtp_score: 0.9 }), { status: 200 });
    }
    return previousFetch(input, init);
  }) as typeof fetch;

  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {});
    const response = await performJsonRequest(app, "POST", "/api/auth/signup", {
      email: "threshold@example.com",
      password: "SuperSecret123!",
      name: "Threshold",
    });

    assert.equal(response.status, 201);
    const row = auditRows.find((entry) => entry.action === "auth.signup.decision");
    assert.ok(row);
    const metadata = row.metadata as Record<string, unknown>;
    assert.equal(metadata.reasonCode, "ipqs_advisory_step_up");
    assert.equal(metadata.decisionCategory, "step_up");
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
    patchProperty(db.query.appsTable, "findFirst", async () => ({ id: "app-1", slug: "admin", accessMode: "organization", isActive: true, customerRegistrationEnabled: true, transactionalFromEmail: "no-reply@example.com", transactionalFromName: "Ayni", transactionalReplyToEmail: "support@example.com" })),
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

    assert.equal(response.status, 201);
    assert.equal(response.body?.success, true);
    assert.equal(response.body?.appSlug, "admin");
    assert.equal(response.body?.message, "If your signup is valid, check your email for next steps.");
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

test("signup duplicate-email and fresh signup share public success contract", async () => {
  const prevIpqsKey = process.env["IPQS_API_KEY"];
  process.env["IPQS_API_KEY"] = "test-key";

  let userLookupCount = 0;
  let credentialLookupCount = 0;
  const insertedCredentials: InsertPayload[] = [];
  const previousFetch = globalThis.fetch;
  const restores = [
    patchProperty(db.query.appsTable, "findFirst", async () => ({ id: "app-1", slug: "admin", accessMode: "organization", isActive: true, customerRegistrationEnabled: true, transactionalFromEmail: "no-reply@example.com", transactionalFromName: "Ayni", transactionalReplyToEmail: "support@example.com" })),
    patchProperty(db.query.usersTable, "findFirst", async () => {
      userLookupCount += 1;
      if (userLookupCount === 1) return null;
      return { id: "user-existing", email: "existing@example.com", name: "Existing" };
    }),
    patchProperty(db.query.userCredentialsTable, "findFirst", async () => {
      credentialLookupCount += 1;
      if (credentialLookupCount === 1) return null;
      return { id: "cred-existing", userId: "user-existing", credentialType: "password" };
    }),
    patchProperty(db, "insert", ((table: unknown) => {
      if (table === usersTable) {
        return {
          values: (payload: InsertPayload) => ({
            returning: async () => [{ id: "user-created", email: payload.email, name: payload.name }],
          }),
        };
      }
      if (table === userCredentialsTable) {
        return {
          values: async (payload: InsertPayload) => {
            insertedCredentials.push(payload);
          },
        };
      }
      if (table === authTokensTable || table === userAuthSecurityTable || table === auditLogsTable) {
        return {
          values: async () => undefined,
        };
      }
      return {
        values: async () => undefined,
      };
    }) as never),
    patchProperty(db, "update", (() => ({
      set: () => ({
        where: () => ({
          returning: async () => [] as unknown[],
        }),
      }),
    })) as never),
  ];

  globalThis.fetch = (async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("ipqualityscore.com")) {
      return new Response(JSON.stringify({ fraud_score: 5, disposable: false, valid: true, smtp_score: 0.9 }), { status: 200 });
    }
    return previousFetch(input, init);
  }) as typeof fetch;

  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {});
    const freshResponse = await performJsonRequest(app, "POST", "/api/auth/signup", {
      email: "fresh@example.com",
      password: "SuperSecret123!",
      name: "Fresh",
    });
    const duplicateResponse = await performJsonRequest(app, "POST", "/api/auth/signup", {
      email: "existing@example.com",
      password: "SuperSecret123!",
      name: "Existing",
    });

    assert.equal(freshResponse.status, 201);
    assert.equal(duplicateResponse.status, 201);
    assert.deepEqual(
      {
        success: freshResponse.body?.success,
        appSlug: freshResponse.body?.appSlug,
        message: freshResponse.body?.message,
      },
      {
        success: duplicateResponse.body?.success,
        appSlug: duplicateResponse.body?.appSlug,
        message: duplicateResponse.body?.message,
      },
    );
    assert.equal(insertedCredentials.length, 1);
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
    patchProperty(db.query.appsTable, "findFirst", async () => ({ id: "app-2", slug: "admin", accessMode: "organization", isActive: true, customerRegistrationEnabled: false, transactionalFromEmail: "no-reply@example.com", transactionalFromName: "Ayni", transactionalReplyToEmail: "support@example.com" })),
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
    patchProperty(db.query.appsTable, "findFirst", async () => ({ id: "app-1", slug: "admin", accessMode: "organization", isActive: true, customerRegistrationEnabled: true, transactionalFromEmail: "no-reply@example.com", transactionalFromName: "Ayni", transactionalReplyToEmail: "support@example.com" })),
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
    assert.equal(typeof entry.metadata?.normalizedEmailHash, "string");
    assert.equal(entry.metadata?.normalizedEmailMasked, "tu***@example.com");
    assert.equal(entry.metadata?.normalizedEmailDomain, "example.com");
    assert.equal(entry.metadata?.appSlug, "admin");
    assert.equal(entry.metadata?.sessionGroup, "default");
  } finally {
    if (prevNodeEnv === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = prevNodeEnv;
    if (prevTurnstileEnabled === undefined) delete process.env["TURNSTILE_ENABLED"];
    else process.env["TURNSTILE_ENABLED"] = prevTurnstileEnabled;
  }
});

test("signup validation denial logs validation_failed reason code", async () => {
  const auditRows: InsertPayload[] = [];
  const restores = [setupDbInsertCapture(auditRows)];

  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {});
    const response = await performJsonRequest(app, "POST", "/api/auth/signup", {
      email: " ",
      password: "short",
      name: "Invalid",
    });

    assert.equal(response.status, 400);
    assert.equal(response.body?.error, "Invalid signup input.");
    const row = auditRows.find((entry) => entry.action === "auth.signup.decision");
    assert.ok(row);
    assert.equal((row.metadata as Record<string, unknown>).reasonCode, "validation_failed");
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("signup internal exception path logs internal_exception reason code", async () => {
  const prevIpqsKey = process.env["IPQS_API_KEY"];
  process.env["IPQS_API_KEY"] = "test-key";

  const auditRows: InsertPayload[] = [];
  const previousFetch = globalThis.fetch;
  const restores = [
    patchProperty(db.query.appsTable, "findFirst", async () => ({ id: "app-1", slug: "admin", accessMode: "organization", isActive: true, customerRegistrationEnabled: true, transactionalFromEmail: "no-reply@example.com", transactionalFromName: "Ayni", transactionalReplyToEmail: "support@example.com" })),
    patchProperty(db.query.usersTable, "findFirst", async () => null),
  ];

  globalThis.fetch = (async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("ipqualityscore.com")) {
      return new Response(JSON.stringify({ fraud_score: 5, disposable: false, valid: true, smtp_score: 0.8 }), { status: 200 });
    }
    return previousFetch(input, init);
  }) as typeof fetch;

  const originalInsert = db.insert;
  const restoreInsert = patchProperty(db, "insert", ((table: unknown) => {
    if (table === auditLogsTable) {
      return {
        values: (payload: InsertPayload) => {
          auditRows.push(payload);
          return Promise.resolve(undefined);
        },
      };
    }
    if (table === usersTable) {
      return {
        values: () => ({
          returning: async () => {
            throw new Error("insert failed");
          },
        }),
      };
    }
    return originalInsert(table as never);
  }) as never);

  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {});
    const response = await performJsonRequest(app, "POST", "/api/auth/signup", {
      email: "explode@example.com",
      password: "SuperSecret123!",
      name: "Explode",
    });

    assert.equal(response.status, 500);
    const row = auditRows.find((entry) => entry.action === "auth.signup.decision");
    assert.ok(row);
    assert.equal((row.metadata as Record<string, unknown>).reasonCode, "internal_exception");
  } finally {
    restoreInsert();
    globalThis.fetch = previousFetch;
    restores.reverse().forEach((restore) => restore());
    if (prevIpqsKey === undefined) delete process.env["IPQS_API_KEY"];
    else process.env["IPQS_API_KEY"] = prevIpqsKey;
  }
});

test("signup returns appSlug and routes verification email through lane1 outbound logging", async () => {
  const prevNodeEnv = process.env["NODE_ENV"];
  process.env["NODE_ENV"] = "test";

  const auditRows: InsertPayload[] = [];
  const outboundRows: InsertPayload[] = [];
  const restores = [
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "app-1",
      slug: "admin",
      name: "Admin",
      accessMode: "organization",
      isActive: true,
      customerRegistrationEnabled: true,
      transactionalFromEmail: "no-reply@example.com",
      transactionalFromName: "Ayni",
      transactionalReplyToEmail: "support@example.com",
    })),
    patchProperty(db.query.usersTable, "findFirst", async () => null),
    patchProperty(db.query.userCredentialsTable, "findFirst", async () => null),
    patchProperty(db, "insert", ((table: unknown) => {
      if (table === auditLogsTable) {
        return { values: async (payload: InsertPayload) => { auditRows.push(payload); } };
      }
      if (table === usersTable) {
        return { values: (_payload: InsertPayload) => ({ returning: async () => [{ id: "user-created", email: "new@example.com", name: "New User" }] }) };
      }
      if (table === userAuthSecurityTable) {
        return { values: (_payload: InsertPayload) => ({ onConflictDoUpdate: async () => undefined }) };
      }
      if (table === authTokensTable || table === userCredentialsTable) {
        return { values: async () => undefined };
      }
      return { values: async (payload: InsertPayload) => { outboundRows.push(payload); } };
    }) as never),
    patchProperty(db, "update", (() => ({
      set: () => ({
        where: () => ({
          returning: async () => [] as unknown[],
        }),
      }),
    })) as never),
  ];

  try {
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {});
    const response = await performJsonRequest(app, "POST", "/api/auth/signup", {
      email: "new@example.com",
      password: "Password123!",
      name: "New User",
    });

    assert.equal(response.status, 201);
    assert.equal(response.body?.appSlug, "admin");
    assert.equal(outboundRows.some((row) => row.lane === "lane1"), true);
    const row = outboundRows.find((entry) => entry.lane === "lane1");
    const payload = row?.requestedPayloadSnapshot as Record<string, unknown>;
    assert.equal((payload?.metadata as Record<string, unknown>)?.email_kind, "email_verification");
    assert.equal(
      typeof payload?.htmlBody === "string" && payload.htmlBody.includes("appSlug=admin"),
      true,
    );
    assert.equal(auditRows.some((entry) => entry.action === "auth.signup.decision"), true);
  } finally {
    restores.reverse().forEach((restore) => restore());
    if (prevNodeEnv === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = prevNodeEnv;
  }
});
