import test from "node:test";
import assert from "node:assert/strict";
import { createSessionApp, ensureTestDatabaseEnv, patchProperty, performJsonRequest } from "./helpers.js";

ensureTestDatabaseEnv();

const { default: appsRouter } = await import("../routes/apps.js");
const { db } = await import("@workspace/db");

test("GET /api/apps returns active admin app metadata for auth entry", async () => {
  const restore = patchProperty(db.query.appsTable, "findMany", async () => ([
    {
      id: "app-admin",
      slug: "admin",
      name: "Admin",
      domain: "admin.example.com",
      baseUrl: "https://admin.example.com",
      turnstileSiteKeyOverride: null,
      accessMode: "organization",
      staffInvitesEnabled: true,
      customerRegistrationEnabled: true,
      description: null,
      iconUrl: null,
      isActive: true,
    },
  ]));
  const restorePlans = patchProperty(db.query.appPlansTable, "findMany", async () => []);

  try {
    const app = createSessionApp(appsRouter);
    const response = await performJsonRequest(app, "GET", "/api/apps");
    assert.equal(response.status, 200);
    assert.equal(Array.isArray(response.body), true);
    assert.equal(response.body[0]?.slug, "admin");
    assert.equal(response.body[0]?.accessMode, "organization");
    assert.equal(response.body[0]?.normalizedAccessProfile, "organization");
    assert.deepEqual(response.body[0]?.authRoutePolicy, {
      allowCustomerRegistration: true,
      allowOnboarding: true,
      allowInvitations: true,
    });
  } finally {
    restorePlans();
    restore();
  }
});
