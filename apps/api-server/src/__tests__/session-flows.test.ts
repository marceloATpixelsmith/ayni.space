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
