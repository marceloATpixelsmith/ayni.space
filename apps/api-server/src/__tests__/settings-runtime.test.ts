import test from "node:test";
import assert from "node:assert/strict";
import { ensureTestDatabaseEnv, patchProperty } from "./helpers.js";

ensureTestDatabaseEnv();

const settings = await import("../lib/settings.js");
const { db } = await import("@workspace/db");

test("getSetting reads parsed value from cache-backed DB rows", async () => {
  const restore = patchProperty(db.query.settingsTable, "findMany", async () => ([
    { key: "TURNSTILE_ENABLED", value: "true", valueType: "boolean" },
  ]));
  const restoreApps = patchProperty(db.query.appsTable, "findMany", async () => ([]));
  const restoreSelect = patchProperty(db, "select", (() => ({
    from: () => ({ innerJoin: () => ([]) }),
  })) as unknown as typeof db.select);

  try {
    await settings.refreshSettingsCache({ force: true });
    const value = await settings.getSetting<boolean>("TURNSTILE_ENABLED", false);
    assert.equal(value, true);
  } finally {
    restore();
    restoreApps();
    restoreSelect();
  }
});

test("getAppSettingBySlug resolves app-scoped value", async () => {
  const restore = patchProperty(db, "select", (() => ({
    from: () => ({
      innerJoin: () => ([
        { appId: "app-admin", appSlug: "admin", key: "MFA_ISSUER", value: "Ayni Admin", valueType: "string" },
      ]),
    }),
  })) as unknown as typeof db.select);
  const restoreGlobals = patchProperty(db.query.settingsTable, "findMany", async () => ([]));
  const restoreApps = patchProperty(db.query.appsTable, "findMany", async () => ([]));

  try {
    await settings.refreshSettingsCache({ force: true });
    const issuer = await settings.getAppSettingBySlug("admin", "MFA_ISSUER", "Fallback");
    assert.equal(issuer, "Ayni Admin");
  } finally {
    restore();
    restoreGlobals();
    restoreApps();
  }
});

test("getAppSetting falls back when app key missing", async () => {
  const restore = patchProperty(db, "select", (() => ({
    from: () => ({
      innerJoin: () => ([
        { appId: "app-admin", appSlug: "admin", key: "MFA_ISSUER", value: "Ayni Admin", valueType: "string" },
      ]),
    }),
  })) as unknown as typeof db.select);
  const restoreGlobals = patchProperty(db.query.settingsTable, "findMany", async () => ([]));
  const restoreApps = patchProperty(db.query.appsTable, "findMany", async () => ([]));

  try {
    await settings.refreshSettingsCache({ force: true });
    const turnstile = await settings.getAppSetting("app-admin", "MISSING_KEY", "fallback-key");
    assert.equal(turnstile, "fallback-key");
  } finally {
    restore();
    restoreGlobals();
    restoreApps();
  }
});

test("getMfaIssuerForAppSlug falls back safely", async () => {
  const restore = patchProperty(db.query.settingsTable, "findMany", async () => ([]));
  const restoreApps = patchProperty(db.query.appsTable, "findMany", async () => ([]));
  const restoreSelect = patchProperty(db, "select", (() => ({
    from: () => ({ innerJoin: () => ([]) }),
  })) as unknown as typeof db.select);
  try {
    await settings.refreshSettingsCache({ force: true });
    const issuer = await settings.getMfaIssuerForAppSlug("missing", "Fallback Issuer");
    assert.equal(issuer, "Fallback Issuer");
  } finally {
    restore();
    restoreApps();
    restoreSelect();
  }
});

test("getMfaIssuerForAppSlug resolves canonical per-app issuer values when present", async () => {
  const restore = patchProperty(db.query.settingsTable, "findMany", async () => ([]));
  const restoreApps = patchProperty(db.query.appsTable, "findMany", async () => ([]));
  const restoreSelect = patchProperty(db, "select", (() => ({
    from: () => ({
      innerJoin: () => ([
        { appId: "a1", appSlug: "admin", key: "MFA_ISSUER", value: "Ayni Admin", valueType: "string" },
        { appId: "a2", appSlug: "ayni", key: "MFA_ISSUER", value: "Ayni", valueType: "string" },
        { appId: "a3", appSlug: "shipibo", key: "MFA_ISSUER", value: "Shipibo", valueType: "string" },
        { appId: "a4", appSlug: "screening", key: "MFA_ISSUER", value: "Ayni Screening", valueType: "string" },
      ]),
    }),
  })) as unknown as typeof db.select);
  try {
    await settings.refreshSettingsCache({ force: true });
    assert.equal(await settings.getMfaIssuerForAppSlug("admin", "fallback"), "Ayni Admin");
    assert.equal(await settings.getMfaIssuerForAppSlug("ayni", "fallback"), "Ayni");
    assert.equal(await settings.getMfaIssuerForAppSlug("shipibo", "fallback"), "Shipibo");
    assert.equal(await settings.getMfaIssuerForAppSlug("screening", "fallback"), "Ayni Screening");
  } finally {
    restore();
    restoreApps();
    restoreSelect();
  }
});

test("allowed origins derive from active app domains", async () => {
  const restore = patchProperty(db.query.settingsTable, "findMany", async () => ([]));
  const restoreApps = patchProperty(db.query.appsTable, "findMany", async () => ([
    { id: "a1", slug: "admin", domain: "admin.ayni.space", baseUrl: null, turnstileSiteKeyOverride: null },
    { id: "a2", slug: "ayni", domain: "ayni.ayni.space", baseUrl: null, turnstileSiteKeyOverride: null },
  ]));
  const restoreSelect = patchProperty(db, "select", (() => ({
    from: () => ({
      innerJoin: () => ([]),
    }),
  })) as unknown as typeof db.select);
  try {
    await settings.refreshSettingsCache({ force: true });
    const origins = await settings.getEffectiveAllowedOrigins();
    assert.deepEqual(origins.sort(), ["https://admin.ayni.space", "https://ayni.ayni.space"]);
  } finally {
    restore();
    restoreApps();
    restoreSelect();
  }
});

test("allowed origins normalize localhost domains and union env extension values", async () => {
  const previous = process.env["ALLOWED_ORIGINS"];
  process.env["ALLOWED_ORIGINS"] = "https://extra.example.com";
  const restore = patchProperty(db.query.settingsTable, "findMany", async () => ([]));
  const restoreApps = patchProperty(db.query.appsTable, "findMany", async () => ([
    { id: "a1", slug: "admin", domain: "localhost:5173", baseUrl: null, turnstileSiteKeyOverride: null },
  ]));
  const restoreSelect = patchProperty(db, "select", (() => ({
    from: () => ({
      innerJoin: () => ([]),
    }),
  })) as unknown as typeof db.select);
  try {
    await settings.refreshSettingsCache({ force: true });
    const origins = await settings.getEffectiveAllowedOrigins();
    assert.deepEqual(origins.sort(), ["http://localhost:5173", "https://extra.example.com"]);
  } finally {
    if (previous === undefined) delete process.env["ALLOWED_ORIGINS"];
    else process.env["ALLOWED_ORIGINS"] = previous;
    restore();
    restoreApps();
    restoreSelect();
  }
});

test("allowed origins uses env fallback when DB returns empty", async () => {
  const previous = process.env["ALLOWED_ORIGINS"];
  process.env["ALLOWED_ORIGINS"] = "https://fallback-a.test, https://fallback-b.test";
  const restore = patchProperty(db.query.settingsTable, "findMany", async () => ([]));
  const restoreApps = patchProperty(db.query.appsTable, "findMany", async () => ([]));
  const restoreSelect = patchProperty(db, "select", (() => ({
    from: () => ({ innerJoin: () => ([]) }),
  })) as unknown as typeof db.select);
  try {
    await settings.refreshSettingsCache({ force: true });
    const origins = await settings.getEffectiveAllowedOrigins();
    assert.deepEqual(origins, ["https://fallback-a.test", "https://fallback-b.test"]);
  } finally {
    if (previous === undefined) delete process.env["ALLOWED_ORIGINS"];
    else process.env["ALLOWED_ORIGINS"] = previous;
    restore();
    restoreApps();
    restoreSelect();
  }
});

test("parseSettingValue handles number, boolean and json types", () => {
  assert.equal(settings.parseSettingValue("42", "number"), 42);
  assert.equal(settings.parseSettingValue("true", "boolean"), true);
  assert.deepEqual(settings.parseSettingValue('{\"mode\":\"strict\"}', "json"), { mode: "strict" });
});

test("global setting snapshot uses DB cache before env fallback", async () => {
  const prev = process.env["SENTRY_ENVIRONMENT"];
  process.env["SENTRY_ENVIRONMENT"] = "env-fallback";
  const restore = patchProperty(db.query.settingsTable, "findMany", async () => ([
    { key: "SENTRY_ENVIRONMENT", value: "db-production", valueType: "string" },
  ]));
  const restoreApps = patchProperty(db.query.appsTable, "findMany", async () => ([]));
  const restoreSelect = patchProperty(db, "select", (() => ({
    from: () => ({ innerJoin: () => ([]) }),
  })) as unknown as typeof db.select);
  try {
    await settings.refreshSettingsCache({ force: true });
    assert.equal(settings.getGlobalSettingSnapshot("SENTRY_ENVIRONMENT", "local"), "db-production");
  } finally {
    if (prev === undefined) delete process.env["SENTRY_ENVIRONMENT"];
    else process.env["SENTRY_ENVIRONMENT"] = prev;
    restore();
    restoreApps();
    restoreSelect();
  }
});
