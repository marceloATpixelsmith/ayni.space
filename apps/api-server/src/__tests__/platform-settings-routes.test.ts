import test from "node:test";
import assert from "node:assert/strict";
import { createSessionApp, ensureTestDatabaseEnv, patchProperty, performJsonRequest } from "./helpers.js";

ensureTestDatabaseEnv();

const { default: platformRouter } = await import("../routes/platform.js");
const { db } = await import("@workspace/db");

function mockSuperAdminUser() {
  return {
    id: "super-1",
    email: "super@example.com",
    name: "Super Admin",
    avatarUrl: null,
    isSuperAdmin: true,
    activeOrgId: null,
    active: true,
    suspended: false,
    deletedAt: null,
    createdAt: new Date(),
  };
}

function mockDbForSuperAdminFlow() {
  const updatedRow = {
    id: "setting-1",
    key: "SENTRY_ENVIRONMENT",
    value: "production",
    valueType: "string",
    description: "desc",
    updatedBy: "super-1",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => mockSuperAdminUser()),
    patchProperty(db.query.settingsTable, "findMany", async () => []),
    patchProperty(db.query.settingsTable, "findFirst", async () => updatedRow),
    patchProperty(db.query.appSettingsTable, "findFirst", async () => ({
      ...updatedRow,
      appId: "app-admin",
      key: "ALLOWED_ORIGIN",
    })),
    patchProperty(db, "select", (() => ({
      from: () => ({
        innerJoin: () => [],
      }),
    })) as unknown as typeof db.select),
    patchProperty(db, "update", (() => ({
      set: (payload: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => [{ ...updatedRow, ...payload }],
        }),
      }),
    })) as unknown as typeof db.update),
  ];
  return () => {
    for (const restore of restores.reverse()) restore();
  };
}

test("GET /api/platform/settings returns global + app settings payload", async () => {
  const restoreAuth = mockDbForSuperAdminFlow();
  const restoreGlobal = patchProperty(db.query.settingsTable, "findMany", async () => ([
    { id: "s1", key: "SENTRY_ENVIRONMENT", value: "production", valueType: "string", description: null, updatedBy: null, createdAt: new Date(), updatedAt: new Date() },
  ]));
  const restoreAppRows = patchProperty(db, "select", (() => ({
    from: () => ({
      innerJoin: () => ([
        { id: "a1", appId: "app-admin", appSlug: "admin", key: "VITE_APP_SLUG", value: "admin", valueType: "string", description: null, updatedBy: null, createdAt: new Date(), updatedAt: new Date() },
      ]),
    }),
  })) as unknown as typeof db.select);
  const restoreApps = patchProperty(db.query.appsTable, "findMany", async () => ([{ id: "app-admin", slug: "admin", name: "Admin" }]));

  try {
    const app = createSessionApp(platformRouter, { userId: "super-1" });
    const response = await performJsonRequest(app, "GET", "/api/settings");
    assert.equal(response.status, 200);
    assert.equal(response.body.globalSettings[0].key, "SENTRY_ENVIRONMENT");
    assert.equal(response.body.appSettings[0].key, "VITE_APP_SLUG");
    assert.equal(response.body.apps[0].slug, "admin");
    assert.equal(Array.isArray(response.body.editableKeyRegistry?.global), true);
    assert.equal(Array.isArray(response.body.editableKeyRegistry?.app), true);
    assert.deepEqual(
      response.body.editableKeyRegistry.global.find((entry: { key: string }) => entry.key === "SENTRY_ENVIRONMENT"),
      {
        key: "SENTRY_ENVIRONMENT",
        valueType: "string",
        editScope: "operator_editable",
        description: "Backend Sentry environment label.",
      },
    );
    assert.deepEqual(
      response.body.editableKeyRegistry.global.find((entry: { key: string }) => entry.key === "GOOGLE_REDIRECT_URI"),
      {
        key: "GOOGLE_REDIRECT_URI",
        valueType: "string",
        editScope: "seeded_canonical",
        description: "OAuth callback URI; changes require coordinated provider updates.",
      },
    );
    assert.deepEqual(
      response.body.editableKeyRegistry.app.find((entry: { key: string }) => entry.key === "ALLOWED_ORIGIN"),
      {
        key: "ALLOWED_ORIGIN",
        valueType: "string",
        editScope: "operator_editable",
        description: "Allowed browser origin for the app.",
      },
    );
    assert.deepEqual(
      response.body.editableKeyRegistry.app.find((entry: { key: string }) => entry.key === "VITE_API_BASE_URL"),
      {
        key: "VITE_API_BASE_URL",
        valueType: "string",
        editScope: "bootstrap_mirror",
        description: "Frontend API base URL mirror for bootstrap compatibility.",
      },
    );
  } finally {
    restoreAuth();
    restoreGlobal();
    restoreAppRows();
    restoreApps();
  }
});

test("PATCH /api/platform/settings rejects unsupported key", async () => {
  const restoreAuth = mockDbForSuperAdminFlow();
  try {
    const app = createSessionApp(platformRouter, { userId: "super-1" });
    const response = await performJsonRequest(app, "PATCH", "/api/settings", {
      key: "SESSION_SECRET",
      valueType: "string",
      value: "not-allowed",
    });
    assert.equal(response.status, 400);
  } finally {
    restoreAuth();
  }
});

test("PATCH /api/platform/apps/:id/settings rejects unsupported app key", async () => {
  const restoreAuth = mockDbForSuperAdminFlow();
  try {
    const app = createSessionApp(platformRouter, { userId: "super-1" });
    const response = await performJsonRequest(app, "PATCH", "/api/apps/app-admin/settings", {
      key: "SESSION_SECRET",
      valueType: "string",
      value: "not-allowed",
    });
    assert.equal(response.status, 400);
  } finally {
    restoreAuth();
  }
});

test("PATCH /api/platform/settings rejects seeded non-editable global key", async () => {
  const restoreAuth = mockDbForSuperAdminFlow();
  try {
    const app = createSessionApp(platformRouter, { userId: "super-1" });
    const response = await performJsonRequest(app, "PATCH", "/api/settings", {
      key: "GOOGLE_REDIRECT_URI",
      valueType: "string",
      value: "https://example.test/callback",
    });
    assert.equal(response.status, 400);
  } finally {
    restoreAuth();
  }
});

test("PATCH /api/platform/settings allows operator-editable global key", async () => {
  const restoreAuth = mockDbForSuperAdminFlow();
  try {
    const app = createSessionApp(platformRouter, { userId: "super-1" });
    const response = await performJsonRequest(app, "PATCH", "/api/settings", {
      key: "SENTRY_ENVIRONMENT",
      valueType: "string",
      value: "staging",
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.setting.key, "SENTRY_ENVIRONMENT");
  } finally {
    restoreAuth();
  }
});

test("PATCH /api/platform/apps/:id/settings rejects bootstrap mirror key", async () => {
  const restoreAuth = mockDbForSuperAdminFlow();
  try {
    const app = createSessionApp(platformRouter, { userId: "super-1" });
    const response = await performJsonRequest(app, "PATCH", "/api/apps/app-admin/settings", {
      key: "VITE_API_BASE_URL",
      valueType: "string",
      value: "https://api.new.example",
    });
    assert.equal(response.status, 400);
  } finally {
    restoreAuth();
  }
});

test("PATCH /api/platform/apps/:id/settings allows operator-editable app key", async () => {
  const restoreAuth = mockDbForSuperAdminFlow();
  try {
    const app = createSessionApp(platformRouter, { userId: "super-1" });
    const response = await performJsonRequest(app, "PATCH", "/api/apps/app-admin/settings", {
      key: "ALLOWED_ORIGIN",
      valueType: "string",
      value: "https://admin.example.com",
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.setting.key, "ALLOWED_ORIGIN");
  } finally {
    restoreAuth();
  }
});
