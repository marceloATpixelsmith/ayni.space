import test from "node:test";
import assert from "node:assert/strict";
import { createSessionApp, performJsonRequest, patchProperty, ensureTestDatabaseEnv } from "./helpers.js";

ensureTestDatabaseEnv();

const { db } = await import("@workspace/db");
const { default: organizationsRouter } = await import("../routes/organizations.js");
const { default: shipiboRouter } = await import("../routes/shipibo.js");

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
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => null),
    patchProperty(db, "update", () => ({
      set: () => ({
        where: async () => undefined,
      }),
    } as never)),
  ];

  try {
    const app = createSessionApp(organizationsRouter, { userId: "user-org-a" });
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
      accessMode: "restricted",
      tenancyMode: "organization",
      onboardingMode: "enabled",
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
