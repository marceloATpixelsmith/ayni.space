import test from "node:test";
import assert from "node:assert/strict";

import {
  applyFrontendRuntimeSettings,
  applyHydratedFrontendRuntimeSettings,
  getFrontendRuntimeSettings,
} from "../runtimeSettings";

test("hydrated runtime settings retain existing turnstile site key when payload omits key", () => {
  applyFrontendRuntimeSettings({ turnstileSiteKey: "env-fallback-key" });
  applyHydratedFrontendRuntimeSettings({
    authDebug: false,
    sentryEnvironment: "test",
    sentryDsn: null,
    turnstileSiteKey: null,
    domain: "",
    baseUrl: "",
  });

  assert.equal(getFrontendRuntimeSettings().turnstileSiteKey, "env-fallback-key");
});

test("hydrated runtime settings replace turnstile site key when payload provides one", () => {
  applyFrontendRuntimeSettings({ turnstileSiteKey: "env-fallback-key" });
  applyHydratedFrontendRuntimeSettings({
    authDebug: false,
    sentryEnvironment: "test",
    sentryDsn: null,
    turnstileSiteKey: "backend-key",
    domain: "",
    baseUrl: "",
  });

  assert.equal(getFrontendRuntimeSettings().turnstileSiteKey, "backend-key");
});
