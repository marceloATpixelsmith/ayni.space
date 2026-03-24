import { createRoot } from "react-dom/client";
import App from "./App";
import { initFrontendMonitoring } from "@workspace/frontend-observability";
import "./index.css";

initFrontendMonitoring({
  app: "admin",
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
  configEndpoint: "/api/monitoring/config",
  ingestEndpoint: "/api/monitoring/events",
});

// Deployment marker: intentionally no-op change to exercise admin app rollout.
createRoot(document.getElementById("root")!).render(<App />);
