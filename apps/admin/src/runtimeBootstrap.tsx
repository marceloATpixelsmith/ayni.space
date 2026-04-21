import { createRoot } from "react-dom/client";
import App from "./App";
import { initFrontendMonitoring } from "@workspace/frontend-observability";
import {
  applyHydratedFrontendRuntimeSettings,
  getBootstrapAppSlug,
  getFrontendRuntimeSettings,
  type FrontendRuntimeSettings,
} from "@workspace/frontend-security";
import { getAppRuntimeSettings } from "@workspace/api-client-react";

export function applyMonitoringSettings(settings: FrontendRuntimeSettings) {
  initFrontendMonitoring({
    app: settings.appSlug,
    dsn: settings.sentryDsn ?? undefined,
    environment: settings.sentryEnvironment,
    configEndpoint: "/api/monitoring/config",
    ingestEndpoint: "/api/monitoring/events",
  });
}

export async function hydrateFrontendRuntimeSettings() {
  const appSlug = getBootstrapAppSlug();
  const payload = (await getAppRuntimeSettings(appSlug).catch(() => null)) as FrontendRuntimeSettings | null;
  if (!payload || typeof payload !== "object") return;
  applyHydratedFrontendRuntimeSettings({
    authDebug: payload.authDebug,
    sentryEnvironment: payload.sentryEnvironment,
    sentryDsn: payload.sentryDsn,
    turnstileSiteKey: payload.turnstileSiteKey,
  });
}

export async function bootstrapAdminApp() {
  const bootstrapSettings = getFrontendRuntimeSettings();
  applyMonitoringSettings(bootstrapSettings);
  await hydrateFrontendRuntimeSettings();
  const hydratedSettings = getFrontendRuntimeSettings();
  const monitoringChanged =
    hydratedSettings.sentryDsn !== bootstrapSettings.sentryDsn ||
    hydratedSettings.sentryEnvironment !== bootstrapSettings.sentryEnvironment;
  if (monitoringChanged) {
    applyMonitoringSettings(hydratedSettings);
  }
  createRoot(document.getElementById("root")!).render(<App />);
}
