import test from "node:test";
import assert from "node:assert/strict";
import { createSessionApp, ensureTestDatabaseEnv, patchProperty, performJsonRequest } from "./helpers.js";

ensureTestDatabaseEnv();

const { db } = await import("@workspace/db");
const { default: organizationsRouter } = await import("../routes/organizations.js");

function objectContainsValue(input: unknown, target: string, seen = new WeakSet<object>()): boolean {
  if (input === target) return true;
  if (!input || typeof input !== "object") return false;
  if (seen.has(input as object)) return false;
  seen.add(input as object);
  for (const value of Object.values(input as Record<string, unknown>)) {
    if (objectContainsValue(value, target, seen)) return true;
  }
  return false;
}

test("organization listing keeps same-session-group memberships and drops cross-group memberships", async () => {
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "u-boundary",
      email: "boundary@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
    })),
    patchProperty(db, "select", () => ({
      from: () => ({
        innerJoin: () => ({
          where: async () => [
            { id: "org-default", name: "Default Org", slug: "default-org", logoUrl: null, website: null, stripeCustomerId: null, createdAt: new Date(), appId: "app-default" },
            { id: "org-admin", name: "Admin Org", slug: "admin-org", logoUrl: null, website: null, stripeCustomerId: null, createdAt: new Date(), appId: "app-admin" },
          ],
        }),
      }),
    } as never)),
    patchProperty(db.query.appsTable, "findFirst", async (query?: unknown) => {
      if (objectContainsValue(query, "app-admin")) {
        return { id: "app-admin", slug: "admin", metadata: {}, isActive: true };
      }
      return { id: "app-default", slug: "ayni", metadata: {}, isActive: true };
    }),
    patchProperty(db, "update", () => ({ set: () => ({ where: async () => undefined }) } as never)),
  ];

  try {
    const app = createSessionApp(organizationsRouter, { userId: "u-boundary", sessionGroup: "default" });
    const response = await performJsonRequest(app, "GET", "/api/");
    assert.equal(response.status, 200);
    assert.equal(Array.isArray(response.body), true);
    assert.equal(response.body.length, 1);
    assert.equal(response.body[0].id, "org-default");
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("organization read route denies incompatible session-group even with membership", async () => {
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "u-read",
      email: "read@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
    })),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({ id: "org-admin", name: "Admin Org", appId: "app-admin" })),
    patchProperty(db.query.appsTable, "findFirst", async () => ({ id: "app-admin", slug: "admin", metadata: {}, isActive: true })),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => ({
      id: "m-read",
      userId: "u-read",
      orgId: "org-admin",
      role: "staff",
      membershipStatus: "active",
    })),
    patchProperty(db, "update", () => ({ set: () => ({ where: async () => undefined }) } as never)),
  ];

  try {
    const app = createSessionApp(organizationsRouter, { userId: "u-read", sessionGroup: "default" });
    const response = await performJsonRequest(app, "GET", "/api/org-admin");
    assert.equal(response.status, 403);
    assert.match(response.body.error, /session context/i);
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});
