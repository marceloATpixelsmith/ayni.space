import test from "node:test";
import assert from "node:assert/strict";
import { createSessionApp, ensureTestDatabaseEnv, patchProperty, performJsonRequest } from "./helpers.js";

ensureTestDatabaseEnv();

const { db } = await import("@workspace/db");
const { default: invitationsRouter } = await import("../routes/invitations.js");

test("invitation creation for org in App A stores App A on invitation", async () => {
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
          orgId: "org-a",
          membershipStatus: "active",
          role: "org_admin",
        };
      }
      return null;
    }),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({ id: "org-a", name: "Org A", appId: "app-a" })),
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "app-a",
      slug: "ayni",
      isActive: true,
      accessMode: "organization",
      staffInvitesEnabled: true,
      transactionalFromEmail: "invites@example.com",
      transactionalFromName: "Invites",
      transactionalReplyToEmail: "support@example.com",
      invitationEmailSubject: "Invite {{organization_name}}",
      invitationEmailHtml: "<p>{{invitee_email}}</p>",
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
    const response = await performJsonRequest(app, "POST", "/api/organizations/org-a/invitations", {
      email: "invitee@example.com",
      role: "staff",
    });

    assert.equal(response.status, 201);
    assert.equal(insertedAppId, "app-a");
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("invitation creation for org in App B stores App B on invitation", async () => {
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
      transactionalFromEmail: "invites@example.com",
      transactionalFromName: "Invites",
      transactionalReplyToEmail: "support@example.com",
      invitationEmailSubject: "Invite {{organization_name}}",
      invitationEmailHtml: "<p>{{invitee_email}}</p>",
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
      transactionalFromEmail: "invites@example.com",
      transactionalFromName: "Invites",
      transactionalReplyToEmail: "support@example.com",
      invitationEmailSubject: "Invite {{organization_name}}",
      invitationEmailHtml: "<p>{{invitee_email}}</p>",
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

test("invitation org routes fail closed when session group is missing", async () => {
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "owner-3",
      email: "owner3@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
    })),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({ id: "org-default", appId: "app-default", name: "Default Org" })),
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "app-default",
      slug: "ayni",
      isActive: true,
      accessMode: "organization",
      staffInvitesEnabled: true,
      transactionalFromEmail: "invites@example.com",
      transactionalFromName: "Invites",
      transactionalReplyToEmail: "support@example.com",
      invitationEmailSubject: "Invite {{organization_name}}",
      invitationEmailHtml: "<p>{{invitee_email}}</p>",
      metadata: {},
    })),
    patchProperty(db, "update", () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }) as never),
  ];

  try {
    const app = createSessionApp(invitationsRouter, {
      userId: "owner-3",
      appSlug: "ayni",
    });

    const response = await performJsonRequest(app, "GET", "/api/organizations/org-default/invitations");
    assert.equal(response.status, 403);
    assert.match(response.body.error, /session context/i);
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("invitation accept keeps member destination when post-auth resolver reports organization onboarding", async () => {
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "invitee-1",
      email: "invitee@example.com",
      isSuperAdmin: false,
      active: true,
      suspended: false,
      deletedAt: null,
      activeOrgId: null,
    })),
    patchProperty(db.query.invitationsTable, "findFirst", async () => ({
      id: "inv-onboarding",
      token: "hash",
      orgId: "org-a",
      appId: "app-a",
      email: "invitee@example.com",
      invitedRole: "staff",
      invitationStatus: "pending",
      expiresAt: new Date(Date.now() + 3600_000),
    })),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => null),
    patchProperty(db.query.orgMembershipsTable, "findMany", async () => []),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({
      id: "org-a",
      appId: "app-a",
      isActive: true,
      name: "Org A",
    })),
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "app-a",
      slug: "ayni",
      isActive: true,
      accessMode: "organization",
      staffInvitesEnabled: true,
      customerRegistrationEnabled: false,
    })),
    patchProperty(db.query.userAppAccessTable, "findFirst", async () => null),
    patchProperty(db.query.orgAppAccessTable, "findFirst", async () => ({
      orgId: "org-a",
      appId: "app-a",
      enabled: true,
    })),
    patchProperty(db, "insert", () => ({
      values: () => Promise.resolve([]),
    }) as never),
    patchProperty(db, "update", () => ({
      set: () => ({ where: async () => undefined }),
    }) as never),
  ];

  try {
    const app = createSessionApp(invitationsRouter, {
      userId: "invitee-1",
      sessionGroup: "default",
      appSlug: "ayni",
    });

    const response = await performJsonRequest(app, "POST", "/api/invitations/token/accept", {});
    assert.equal(response.status, 200);
    assert.equal(response.body.nextPath, "/dashboard");
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("invitation cancellation is denied for cross-org invitation ids and leaves invitation unchanged", async () => {
  let revokeWhereCallCount = 0;
  let invitationStatus = "pending";
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "owner-4",
      email: "owner4@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
    })),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => ({
      id: "m-4",
      userId: "owner-4",
      orgId: "org-a",
      membershipStatus: "active",
      role: "org_admin",
    })),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({ id: "org-a", appId: "app-a", name: "Org A" })),
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "app-a",
      slug: "ayni",
      isActive: true,
      accessMode: "organization",
      staffInvitesEnabled: true,
      transactionalFromEmail: "invites@example.com",
      transactionalFromName: "Invites",
      transactionalReplyToEmail: "support@example.com",
      invitationEmailSubject: "Invite {{organization_name}}",
      invitationEmailHtml: "<p>{{invitee_email}}</p>",
      metadata: {},
    })),
    patchProperty(db, "update", () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          if (values["invitationStatus"] === "revoked") {
            revokeWhereCallCount += 1;
            return {
              returning: async () => [],
            };
          }
          return {
            returning: async () => [],
          };
        },
      }),
    }) as never),
  ];

  try {
    const app = createSessionApp(invitationsRouter, {
      userId: "owner-4",
      sessionGroup: "default",
      appSlug: "ayni",
    });

    const response = await performJsonRequest(app, "DELETE", "/api/organizations/org-a/invitations/inv-org-b");
    assert.equal(response.status, 404);
    assert.equal(response.body.error, "Invitation not found");
    assert.equal(revokeWhereCallCount, 1);
    assert.equal(invitationStatus, "pending");
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});
