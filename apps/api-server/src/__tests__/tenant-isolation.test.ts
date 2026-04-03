import test from "node:test";
import assert from "node:assert/strict";
import { createSessionApp, performJsonRequest, patchProperty, ensureTestDatabaseEnv } from "./helpers.js";

ensureTestDatabaseEnv();

const { db } = await import("@workspace/db");
const { default: organizationsRouter } = await import("../routes/organizations.js");
const { default: shipiboRouter } = await import("../routes/shipibo.js");
const { default: ayniRouter } = await import("../routes/ayni.js");
const { default: billingRouter } = await import("../routes/billing.js");

test("tenant isolation denies cross-org reads", async () => {
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-org-a",
      email: "member@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
      activeOrgId: "org-a",
    })),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({ id: "org-b", name: "Org B", slug: "org-b", appId: "app-ayni" })),
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "app-ayni",
      slug: "ayni",
      isActive: true,
      accessMode: "organization",
      staffInvitesEnabled: true,
      customerRegistrationEnabled: true,
    })),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => null),
    patchProperty(db, "update", () => ({
      set: () => ({
        where: async () => undefined,
      }),
    } as never)),
  ];

  try {
    const app = createSessionApp(organizationsRouter, { userId: "user-org-a", sessionGroup: "default" });
    const response = await performJsonRequest(app, "GET", "/api/org-b");

    assert.equal(response.status, 403);
    assert.match(response.body.error, /Access denied/);
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("app access boundary denies user without app entitlement", async () => {
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-no-shipibo",
      email: "noapp@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
      activeOrgId: "org-a",
    })),
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "app-shipibo",
      slug: "shipibo",
      isActive: true,
      accessMode: "organization",
            staffInvitesEnabled: true,
      customerRegistrationEnabled: true,
    })),
    patchProperty(db.query.userAppAccessTable, "findFirst", async () => null),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({ id: "org-a", name: "Org A", slug: "org-a" })),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => null),
    patchProperty(db, "update", () => ({
      set: () => ({
        where: async () => undefined,
      }),
    } as never)),
  ];

  try {
    const app = createSessionApp(shipiboRouter, { userId: "user-no-shipibo" });
    const response = await performJsonRequest(app, "GET", "/api/words");

    assert.equal(response.status, 403);
    assert.match(response.body.error, /Unauthorized|Onboarding required/);
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("ayni tenant routes deny cross-org reads even with app access", async () => {
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-has-ayni",
      email: "ayni@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
      isSuperAdmin: true,
      activeOrgId: "org-a",
    })),
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "app-ayni",
      slug: "ayni",
      isActive: true,
      accessMode: "organization",
            staffInvitesEnabled: true,
      customerRegistrationEnabled: true,
    })),
    patchProperty(db.query.userAppAccessTable, "findFirst", async () => ({
      id: "uaa-1",
      userId: "user-has-ayni",
      appId: "app-ayni",
      accessStatus: "active",
    })),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({ id: "org-a", name: "Org A", slug: "org-a" })),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => null),
    patchProperty(db, "update", () => ({
      set: () => ({
        where: async () => undefined,
      }),
    } as never)),
  ];

  try {
    const app = createSessionApp(ayniRouter, { userId: "user-has-ayni" });
    const response = await performJsonRequest(app, "GET", "/api/ceremonies?orgId=org-b");

    assert.equal(response.status, 403);
    assert.match(response.body.error, /Access denied/);
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("billing tenant routes deny cross-org writes when orgId is in request body", async () => {
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "billing-user",
      email: "billing@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
      activeOrgId: "org-a",
    })),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => null),
    patchProperty(db, "update", () => ({
      set: () => ({
        where: async () => undefined,
      }),
    } as never)),
  ];

  try {
    const app = createSessionApp(billingRouter, { userId: "billing-user" });
    const response = await performJsonRequest(app, "POST", "/api/checkout", {
      orgId: "org-b",
      appId: "app-ayni",
      planId: "plan-basic",
    });

    assert.equal(response.status, 403);
    assert.match(response.body.error, /Access denied/);
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});
