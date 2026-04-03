import test from "node:test";
import assert from "node:assert/strict";
import { createSessionApp, performJsonRequest, patchProperty, ensureTestDatabaseEnv } from "./helpers.js";

ensureTestDatabaseEnv();

const { db } = await import("@workspace/db");
const { TransactionalEmailRepository, Lane2TransactionalEmailRuntime } = await import("@workspace/transactional-email");
const { default: transactionalEmailRouter } = await import("../routes/transactional-email.js");

function baseAuthRestores(orgId: string, role: "org_admin" | null = "org_admin", isSuperAdmin = false) {
  return [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-1",
      email: "admin@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
      isSuperAdmin,
    })),
    patchProperty(db, "update", () => ({
      set: () => ({
        where: async () => undefined,
      }),
    } as never)),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () =>
      role ? { role, membershipStatus: "active", orgId, userId: "user-1" } : null
    ),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({
      id: orgId,
      appId: "app-1",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    patchProperty(db.query.orgAppAccessTable, "findMany", async () => [
      { id: "oa-1", orgId, appId: "app-1", enabled: true, createdAt: new Date(), updatedAt: new Date() },
    ]),
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "app-1",
      slug: "ayni",
      metadata: null,
      isActive: true,
    })),
  ];
}

test("org admin can create connection and response is redacted", async () => {
  process.env["EMAIL_CREDENTIALS_ENCRYPTION_KEY"] = "a".repeat(64);

  let createPayload: Record<string, unknown> | null = null;
  const restores = [
    ...baseAuthRestores("org-1"),
    patchProperty(TransactionalEmailRepository.prototype as any, "createConnection", async (input: Record<string, unknown>) => {
      createPayload = input;
      return { id: "conn-1", redactedCredential: "enc_***abcd", orgId: "org-1", appId: "app-1", provider: "brevo" };
    }),
  ];

  try {
    const app = createSessionApp(transactionalEmailRouter, { userId: "user-1", sessionGroup: "default" });
    const response = await performJsonRequest(app, "POST", "/api/organizations/org-1/transactional-email/connections", {
      appId: "app-1",
      provider: "brevo",
      displayLabel: "primary",
      apiKey: "super-secret-key",
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.redactedCredential, "enc_***abcd");
    assert.equal((createPayload as any)?.deactivateOtherConnectionsForOrgApp, true);
    assert.ok(typeof (createPayload as any)?.encryptedCredentials === "string");
    assert.equal(response.body.apiKey, undefined);
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("cross-org access is denied for org-scoped log queries", async () => {
  const restores = [...baseAuthRestores("org-a", null)];
  try {
    const app = createSessionApp(transactionalEmailRouter, { userId: "user-1", sessionGroup: "default" });
    const response = await performJsonRequest(app, "GET", "/api/organizations/org-b/transactional-email/logs");
    assert.equal(response.status, 403);
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("validation response sanitizes credential-like diagnostics", async () => {
  const restores = [
    ...baseAuthRestores("org-1"),
    patchProperty(TransactionalEmailRepository.prototype as any, "findConnectionById", async () => ({
      id: "conn-1",
      orgId: "org-1",
      provider: "brevo",
    })),
    patchProperty(Lane2TransactionalEmailRuntime.prototype as any, "validateConnection", async () => ({
      state: "invalid",
      error: "invalid key sk_live_12345678901234567890",
    })),
  ];

  try {
    const app = createSessionApp(transactionalEmailRouter, { userId: "user-1", sessionGroup: "default" });
    const response = await performJsonRequest(app, "POST", "/api/organizations/org-1/transactional-email/connections/conn-1/validate");
    assert.equal(response.status, 200);
    assert.match(response.body.error, /\*\*\*redacted\*\*\*/);
    assert.doesNotMatch(response.body.error, /sk_live_/);
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("org log query supports recipient filtering", async () => {
  const restores = [
    ...baseAuthRestores("org-1"),
    patchProperty(TransactionalEmailRepository.prototype as any, "listOutboundLogs", async () => [
      { id: "l1", requestedTo: ["alice@example.com"] },
      { id: "l2", requestedTo: ["bob@example.com"] },
    ]),
  ];
  try {
    const app = createSessionApp(transactionalEmailRouter, { userId: "user-1", sessionGroup: "default" });
    const response = await performJsonRequest(
      app,
      "GET",
      "/api/organizations/org-1/transactional-email/logs?recipient=alice"
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.logs.length, 1);
    assert.equal(response.body.logs[0].id, "l1");
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("superadmin access to platform-wide logs is enforced", async () => {
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "sa-1",
      email: "sa@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
      isSuperAdmin: false,
    })),
    patchProperty(db, "update", () => ({
      set: () => ({
        where: async () => undefined,
      }),
    } as never)),
  ];
  try {
    const app = createSessionApp(transactionalEmailRouter, { userId: "sa-1", sessionGroup: "admin" });
    const response = await performJsonRequest(app, "GET", "/api/admin/transactional-email/logs");
    assert.equal(response.status, 403);
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("org events query excludes events from other org logs", async () => {
  const restores = [
    ...baseAuthRestores("org-1"),
    patchProperty(TransactionalEmailRepository.prototype as any, "listEvents", async () => [
      { id: "e1", linkedOutboundEmailLogId: "log-1" },
      { id: "e2", linkedOutboundEmailLogId: "log-2" },
    ]),
    patchProperty(TransactionalEmailRepository.prototype as any, "findOutboundLogById", async (logId: string) =>
      logId === "log-1" ? { id: "log-1", orgId: "org-1" } : { id: "log-2", orgId: "org-2" }
    ),
  ];

  try {
    const app = createSessionApp(transactionalEmailRouter, { userId: "user-1", sessionGroup: "default" });
    const response = await performJsonRequest(app, "GET", "/api/organizations/org-1/transactional-email/events");
    assert.equal(response.status, 200);
    assert.equal(response.body.events.length, 1);
    assert.equal(response.body.events[0].id, "e1");
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("brevo webhook rejects malformed signature without throwing", async () => {
  process.env["BREVO_WEBHOOK_SECRET"] = "top-secret";
  const restores = [patchProperty(Lane2TransactionalEmailRuntime.prototype as any, "ingestWebhook", async () => 1)];

  try {
    const app = createSessionApp(transactionalEmailRouter, { userId: "user-1", sessionGroup: "default" });
    const server = app.listen(0);
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/transactional-email/webhooks/brevo`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-brevo-signature": "bad",
        },
        body: JSON.stringify({ event: "delivered" }),
      });
      assert.equal(response.status, 401);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  } finally {
    restores.reverse().forEach((restore) => restore());
    delete process.env["BREVO_WEBHOOK_SECRET"];
  }
});
