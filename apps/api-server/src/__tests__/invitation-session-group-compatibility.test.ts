import test from "node:test";
import assert from "node:assert/strict";
import { createSessionApp, ensureTestDatabaseEnv, patchProperty, performJsonRequest } from "./helpers.js";

ensureTestDatabaseEnv();

const { db } = await import("@workspace/db");
const { default: invitationsRouter } = await import("../routes/invitations.js");

test("invitation creation persists org-derived app id (no hard-coded app)", async () => {
  let insertedAppId: string | null = null;
  let membershipLookupCount = 0;
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "owner-1",
      email: "owner@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
    })),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => {
      membershipLookupCount += 1;
      if (membershipLookupCount === 1) {
        return {
          id: "m-1",
          userId: "owner-1",
          orgId: "org-b",
          membershipStatus: "active",
          role: "org_admin",
        };
      }
      return null;
    }),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({ id: "org-b", name: "Org B", appId: "app-b" })),
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "app-b",
      slug: "shipibo",
      isActive: true,
      accessMode: "organization",
      staffInvitesEnabled: true,
      metadata: {},
    })),
    patchProperty(db, "insert", () => ({
      values: (payload: Record<string, unknown>) => {
        if ("action" in payload) {
          return Promise.resolve([]);
        }
        insertedAppId = String(payload["appId"] ?? "");
        return {
          returning: async () => [{
            id: "inv-1",
            email: payload["email"],
            invitedRole: payload["invitedRole"],
            orgId: payload["orgId"],
            invitationStatus: "pending",
            expiresAt: new Date(Date.now() + 3600_000),
            createdAt: new Date(),
          }],
        };
      },
    } as never)),
    patchProperty(db, "update", () => ({ set: () => ({ where: async () => undefined }) } as never)),
  ];

  try {
    const app = createSessionApp(invitationsRouter, {
      userId: "owner-1",
      sessionGroup: "default",
      appSlug: "ayni",
    });
    const response = await performJsonRequest(app, "POST", "/api/organizations/org-b/invitations", {
      email: "invitee@example.com",
      role: "staff",
    });

    assert.equal(response.status, 201);
    assert.equal(insertedAppId, "app-b");
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("invitation create and accept deny incompatible session-group org access", async () => {
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "owner-2",
      email: "owner@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
    })),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => ({
      id: "m-2",
      userId: "owner-2",
      orgId: "org-admin",
      membershipStatus: "active",
      role: "org_admin",
    })),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({ id: "org-admin", appId: "app-admin", name: "Admin Org" })),
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "app-admin",
      slug: "admin",
      isActive: true,
      accessMode: "organization",
      staffInvitesEnabled: true,
      metadata: {},
    })),
    patchProperty(db.query.invitationsTable, "findFirst", async () => ({
      id: "inv-cross",
      token: "hash",
      orgId: "org-admin",
      email: "owner@example.com",
      invitedRole: "staff",
      invitationStatus: "pending",
      expiresAt: new Date(Date.now() + 3600_000),
    })),
    patchProperty(db, "update", () => ({ set: () => ({ where: async () => undefined }) } as never)),
  ];

  try {
    const app = createSessionApp(invitationsRouter, {
      userId: "owner-2",
      sessionGroup: "default",
      appSlug: "ayni",
    });

    const createResponse = await performJsonRequest(app, "POST", "/api/organizations/org-admin/invitations", {
      email: "invitee@example.com",
      role: "staff",
    });
    assert.equal(createResponse.status, 403);
    assert.match(createResponse.body.error, /session context/i);

    const acceptResponse = await performJsonRequest(app, "POST", "/api/invitations/token/accept", {});
    assert.equal(acceptResponse.status, 403);
    assert.match(acceptResponse.body.error, /session context/i);
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});
