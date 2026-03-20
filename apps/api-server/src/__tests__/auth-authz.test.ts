import test from "node:test";
import assert from "node:assert/strict";
import { createSessionApp, performJsonRequest, patchProperty, ensureTestDatabaseEnv } from "./helpers.js";

ensureTestDatabaseEnv();

const { db } = await import("@workspace/db");
const { default: organizationsRouter } = await import("../routes/organizations.js");

test("rejects unauthenticated access to protected org route", async () => {
  const app = createSessionApp(organizationsRouter, {});
  const response = await performJsonRequest(app, "GET", "/api/org-1");

  assert.equal(response.status, 401);
  assert.match(response.body.error, /Unauthorized/);
});

test("allows authenticated user with org membership", async () => {
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-1",
      email: "user@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
    })),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => ({
      id: "membership-1",
      userId: "user-1",
      orgId: "org-allowed",
      membershipStatus: "active",
      role: "org_owner",
    })),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({
      id: "org-allowed",
      name: "Allowed Org",
      slug: "allowed-org",
    })),
    patchProperty(db, "select", () => ({
      from: () => ({
        where: async () => [{ count: 1 }],
      }),
    } as never)),
    patchProperty(db, "update", () => ({
      set: () => ({
        where: async () => undefined,
      }),
    } as never)),
  ];

  try {
    const app = createSessionApp(organizationsRouter, { userId: "user-1" });
    const response = await performJsonRequest(app, "GET", "/api/org-allowed");

    assert.equal(response.status, 200);
    assert.equal(response.body.id, "org-allowed");
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("forbids authenticated user without org membership", async () => {
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-2",
      email: "user2@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
    })),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => null),
    patchProperty(db, "update", () => ({
      set: () => ({
        where: async () => undefined,
      }),
    } as never)),
  ];

  try {
    const app = createSessionApp(organizationsRouter, { userId: "user-2" });
    const response = await performJsonRequest(app, "GET", "/api/org-forbidden");

    assert.equal(response.status, 403);
    assert.match(response.body.error, /Access denied/);
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});
