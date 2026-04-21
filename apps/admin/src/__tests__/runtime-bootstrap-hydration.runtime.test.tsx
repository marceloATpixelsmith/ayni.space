import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeState = {
  appSlug: "admin",
  apiBaseUrl: "",
  basePath: "/",
  authDebug: false,
  sentryEnvironment: "development",
  sentryDsn: null as string | null,
  turnstileSiteKey: null as string | null,
};

const { getAppRuntimeSettings, initFrontendMonitoring } = vi.hoisted(() => ({
  getAppRuntimeSettings: vi.fn(),
  initFrontendMonitoring: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({ getAppRuntimeSettings }));
vi.mock("@workspace/frontend-observability", () => ({ initFrontendMonitoring }));
vi.mock("@workspace/frontend-security", () => ({
  getBootstrapAppSlug: () => runtimeState.appSlug,
  getFrontendRuntimeSettings: () => runtimeState,
  applyHydratedFrontendRuntimeSettings: (patch: Partial<typeof runtimeState>) => Object.assign(runtimeState, patch),
  isAuthDebugEnabledRuntime: () => runtimeState.authDebug,
}));

import { hydrateFrontendRuntimeSettings } from "../runtimeBootstrap";

describe("runtime settings hydration", () => {
  beforeEach(() => {
    runtimeState.appSlug = "admin";
    runtimeState.authDebug = false;
    runtimeState.sentryEnvironment = "development";
    runtimeState.sentryDsn = null;
    runtimeState.turnstileSiteKey = null;
    getAppRuntimeSettings.mockReset();
    initFrontendMonitoring.mockReset();
  });

  it("hydrates runtime values from app runtime settings API", async () => {
    getAppRuntimeSettings.mockResolvedValue({
      appSlug: "admin",
      apiBaseUrl: "",
      basePath: "/",
      authDebug: true,
      sentryEnvironment: "production",
      sentryDsn: "https://dsn.example/1",
      turnstileSiteKey: "turnstile-live-key",
    });

    await hydrateFrontendRuntimeSettings();

    expect(getAppRuntimeSettings).toHaveBeenCalledWith("admin");
    expect(runtimeState.authDebug).toBe(true);
    expect(runtimeState.sentryEnvironment).toBe("production");
    expect(runtimeState.sentryDsn).toBe("https://dsn.example/1");
    expect(runtimeState.turnstileSiteKey).toBe("turnstile-live-key");
  });

  it("auth debug toggle reflects hydrated runtime value", async () => {
    expect(runtimeState.authDebug).toBe(false);
    getAppRuntimeSettings.mockResolvedValue({
      ...runtimeState,
      authDebug: true,
    });

    await hydrateFrontendRuntimeSettings();

    expect(runtimeState.authDebug).toBe(true);
  });
});
