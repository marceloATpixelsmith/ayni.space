import test from "node:test";
import assert from "node:assert/strict";
import { ensureTestDatabaseEnv, patchProperty } from "./helpers.js";

ensureTestDatabaseEnv();

const runtimeSettings = await import("../lib/runtimeSettings.js");
const { db } = await import("@workspace/db");

test("getFrontendRuntimeSettingsForApp returns app-scoped frontend runtime values", async () => {
  const restoreApp = patchProperty(db.query.appsTable, "findFirst", async () => ({ id: "app-admin", slug: "admin" }));
  const restoreGlobal = patchProperty(db.query.settingsTable, "findMany", async () => ([
    { key: "SENTRY_ENVIRONMENT", value: "production", valueType: "string" },
    { key: "SENTRY_DSN", value: "https://dsn.example/1", valueType: "string" },
  ]));
  const restoreSelect = patchProperty(db, "select", (() => ({
    from: () => ({
      innerJoin: () => ([
        { appId: "app-admin", appSlug: "admin", key: "VITE_APP_SLUG", value: "admin", valueType: "string" },
        { appId: "app-admin", appSlug: "admin", key: "VITE_API_BASE_URL", value: "https://api.ayni.space", valueType: "string" },
        { appId: "app-admin", appSlug: "admin", key: "BASE_PATH", value: "/", valueType: "string" },
        { appId: "app-admin", appSlug: "admin", key: "VITE_AUTH_DEBUG", value: "true", valueType: "boolean" },
        { appId: "app-admin", appSlug: "admin", key: "VITE_SENTRY_ENVIRONMENT", value: "production", valueType: "string" },
        { appId: "app-admin", appSlug: "admin", key: "VITE_SENTRY_DSN", value: "https://dsn.example/1", valueType: "string" },
        { appId: "app-admin", appSlug: "admin", key: "VITE_TURNSTILE_SITE_KEY", value: "turnstile-site-key", valueType: "string" },
      ]),
    }),
  })) as unknown as typeof db.select);

  try {
    await runtimeSettings.refreshRuntimeCache({ force: true });
    const settings = await runtimeSettings.getFrontendRuntimeSettingsForApp("admin");
    assert.equal(settings?.appSlug, "admin");
    assert.equal(settings?.apiBaseUrl, "https://api.ayni.space");
    assert.equal(settings?.authDebug, true);
    assert.equal(settings?.turnstileSiteKey, "turnstile-site-key");
  } finally {
    restoreApp();
    restoreGlobal();
    restoreSelect();
  }
});
