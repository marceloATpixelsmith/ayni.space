import test from "node:test";
import assert from "node:assert/strict";
import { createSessionApp, performJsonRequest, patchProperty, ensureTestDatabaseEnv } from "./helpers.js";

ensureTestDatabaseEnv();

const { db } = await import("@workspace/db");
const { default: usersRouter } = await import("../routes/users.js");

test("session-required route rejects missing session", async () => {
  const app = createSessionApp(usersRouter, {});
  const response = await performJsonRequest(app, "POST", "/api/me/switch-org", {
    orgId: "11111111-1111-4111-8111-111111111111",
  });

  assert.equal(response.status, 401);
  assert.match(response.body.error, /Unauthorized/);
});

test("switch-org denies orgs where user lacks membership", async () => {
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-switch",
      email: "switch@example.com",
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
    const app = createSessionApp(usersRouter, {
      userId: "user-switch",
      activeOrgId: "org-a",
      regenerate: (cb) => cb?.(),
      save: (cb) => cb?.(),
    });

    const response = await performJsonRequest(app, "POST", "/api/me/switch-org", {
      orgId: "22222222-2222-4222-8222-222222222222",
    });

    assert.equal(response.status, 403);
    assert.match(response.body.error, /not a member/i);
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("switch-org rotates/persists session for valid org membership", async () => {
  let updateCalls = 0;
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-switch-ok",
      email: "switch-ok@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
      activeOrgId: "org-a",
    })),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => ({
      id: "membership-target",
      userId: "user-switch-ok",
      orgId: "22222222-2222-4222-8222-222222222222",
      membershipStatus: "active",
      role: "staff",
    })),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({
      id: "22222222-2222-4222-8222-222222222222",
      appId: "app-default",
      name: "Target Org",
    })),
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "app-default",
      slug: "ayni",
      isActive: true,
      accessMode: "organization",
    })),
    patchProperty(db, "update", () => ({
      set: () => ({
        where: async () => {
          updateCalls += 1;
          return undefined;
        },
      }),
    } as never)),
  ];

  try {
    const app = createSessionApp(usersRouter, {
      userId: "user-switch-ok",
      activeOrgId: "org-a",
      sessionGroup: "default",
      regenerate: (cb) => cb?.(),
      save: (cb) => cb?.(),
    });

    const response = await performJsonRequest(app, "POST", "/api/me/switch-org", {
      orgId: "22222222-2222-4222-8222-222222222222",
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.activeOrgId, "22222222-2222-4222-8222-222222222222");
    assert.equal(updateCalls >= 2, true);
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("switch-org denies cross-session-group targets and preserves active org", async () => {
  const crossGroupOrgId = "44444444-4444-4444-8444-444444444444";
  let userActiveOrgId = "org-a";
  let updateCallCount = 0;

  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-switch-boundary",
      email: "switch-boundary@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
      activeOrgId: userActiveOrgId,
    })),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => ({
      id: "membership-target",
      userId: "user-switch-boundary",
      orgId: crossGroupOrgId,
      membershipStatus: "active",
      role: "staff",
    })),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({ id: crossGroupOrgId, appId: "app-admin" })),
    patchProperty(db.query.appsTable, "findFirst", async () => ({ id: "app-admin", slug: "admin", metadata: {}, isActive: true })),
    patchProperty(db, "update", () => ({
      set: () => ({
        where: async () => {
          updateCallCount += 1;
          if (updateCallCount > 1) {
            userActiveOrgId = crossGroupOrgId;
          }
          return undefined;
        },
      }),
    } as never)),
  ];

  try {
    const app = createSessionApp(usersRouter, {
      userId: "user-switch-boundary",
      activeOrgId: "org-a",
      sessionGroup: "default",
      regenerate: (cb) => cb?.(),
      save: (cb) => cb?.(),
    });

    const response = await performJsonRequest(app, "POST", "/api/me/switch-org", {
      orgId: crossGroupOrgId,
    });

    assert.equal(response.status, 403);
    assert.match(response.body.error, /outside this session group/i);
    assert.equal(updateCallCount, 1);
    assert.equal(userActiveOrgId, "org-a");
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});
