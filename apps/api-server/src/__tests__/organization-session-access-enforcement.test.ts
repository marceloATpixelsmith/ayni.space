import test from "node:test";
import assert from "node:assert/strict";
import { createMountedSessionApp, createSessionApp, ensureTestDatabaseEnv, patchProperty, performJsonRequest } from "./helpers.js";

ensureTestDatabaseEnv();

const { db } = await import("@workspace/db");
const { default: organizationsRouter } = await import("../routes/organizations.js");
const { default: invitationsRouter } = await import("../routes/invitations.js");

function teardown(restores: Array<() => void>) {
  restores.reverse().forEach((restore) => restore());
}

test("organization creation is blocked for superadmin app sessions", async () => {
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({ id: "u-1", active: true, suspended: false, deletedAt: null })),
    patchProperty(db.query.appsTable, "findFirst", async () => ({ id: "admin", slug: "admin", isActive: true, accessMode: "superadmin" })),
    patchProperty(db, "update", () => ({ set: () => ({ where: async () => undefined }) } as never)),
  ];

  try {
    const app = createMountedSessionApp([{ path: "/api/organizations", router: organizationsRouter }], { userId: "u-1", appSlug: "admin" });
    const response = await performJsonRequest(app, "POST", "/api/organizations/", { name: "Org", slug: "org" });
    assert.equal(response.status, 403);
  } finally {
    teardown(restores);
  }
});

test("organization creation is blocked for solo app sessions", async () => {
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({ id: "u-1", active: true, suspended: false, deletedAt: null })),
    patchProperty(db.query.appsTable, "findFirst", async () => ({ id: "shipibo", slug: "shipibo", isActive: true, accessMode: "solo" })),
    patchProperty(db, "update", () => ({ set: () => ({ where: async () => undefined }) } as never)),
  ];

  try {
    const app = createMountedSessionApp([{ path: "/api/organizations", router: organizationsRouter }], { userId: "u-1", appSlug: "shipibo" });
    const response = await performJsonRequest(app, "POST", "/api/organizations/", { name: "Org", slug: "org" });
    assert.equal(response.status, 403);
  } finally {
    teardown(restores);
  }
});

test("invitation acceptance is blocked for non-organization app sessions", async () => {
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({ id: "u-1", email: "member@example.com", active: true, suspended: false, deletedAt: null })),
    patchProperty(db.query.appsTable, "findFirst", async () => ({ id: "admin", slug: "admin", isActive: true, accessMode: "superadmin" })),
    patchProperty(db, "update", () => ({ set: () => ({ where: async () => undefined }) } as never)),
  ];

  try {
    const app = createSessionApp(invitationsRouter, { userId: "u-1", appSlug: "admin" });
    const response = await performJsonRequest(app, "POST", "/api/invitations/token/accept", {});
    assert.equal(response.status, 403);
  } finally {
    teardown(restores);
  }
});
