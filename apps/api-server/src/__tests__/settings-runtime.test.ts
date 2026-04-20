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

  try {
    await settings.refreshSettingsCache({ force: true });
    const value = await settings.getSetting<boolean>("TURNSTILE_ENABLED", false);
    assert.equal(value, true);
  } finally {
    restore();
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

  try {
    await settings.refreshSettingsCache({ force: true });
    const issuer = await settings.getAppSettingBySlug("admin", "MFA_ISSUER", "Fallback");
    assert.equal(issuer, "Ayni Admin");
  } finally {
    restore();
    restoreGlobals();
  }
});

test("getMfaIssuerForAppSlug falls back safely", async () => {
  const restore = patchProperty(db.query.settingsTable, "findMany", async () => ([]));
  const restoreSelect = patchProperty(db, "select", (() => ({
    from: () => ({ innerJoin: () => ([]) }),
  })) as unknown as typeof db.select);
  try {
    await settings.refreshSettingsCache({ force: true });
    const issuer = await settings.getMfaIssuerForAppSlug("missing", "Fallback Issuer");
    assert.equal(issuer, "Fallback Issuer");
  } finally {
    restore();
    restoreSelect();
  }
});

test("allowed origins aggregate app-level ALLOWED_ORIGIN values", async () => {
  const restore = patchProperty(db.query.settingsTable, "findMany", async () => ([]));
  const restoreSelect = patchProperty(db, "select", (() => ({
    from: () => ({
      innerJoin: () => ([
        { appId: "a1", appSlug: "admin", key: "ALLOWED_ORIGIN", value: "https://admin.ayni.space", valueType: "string" },
        { appId: "a2", appSlug: "ayni", key: "ALLOWED_ORIGIN", value: "https://ayni.ayni.space", valueType: "string" },
      ]),
    }),
  })) as unknown as typeof db.select);
  try {
    await settings.refreshSettingsCache({ force: true });
    const origins = await settings.getEffectiveAllowedOrigins();
    assert.deepEqual(origins.sort(), ["https://admin.ayni.space", "https://ayni.ayni.space"]);
  } finally {
    restore();
    restoreSelect();
  }
});

test("allowed origins uses env fallback when DB returns empty", async () => {
  const previous = process.env["ALLOWED_ORIGINS"];
  process.env["ALLOWED_ORIGINS"] = "https://fallback-a.test, https://fallback-b.test";
  const restore = patchProperty(db.query.settingsTable, "findMany", async () => ([]));
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
    restoreSelect();
  }
});
