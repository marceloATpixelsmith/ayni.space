import { createRoot } from "react-dom/client";
import App from "./App";
import { initFrontendMonitoring } from "@workspace/frontend-observability";
import {
  applyFrontendRuntimeSettings,
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
  applyFrontendRuntimeSettings(payload);
}

export async function bootstrapAdminApp() {
  applyMonitoringSettings(getFrontendRuntimeSettings());
  await hydrateFrontendRuntimeSettings();
  applyMonitoringSettings(getFrontendRuntimeSettings());
  createRoot(document.getElementById("root")!).render(<App />);
}
