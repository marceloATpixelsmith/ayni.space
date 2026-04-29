import express, { type Express } from "express";
import cors from "cors";
import { securityHeaders } from "./middlewares/securityHeaders.js";
import router from "./routes/index.js";
import { createSessionMiddleware, sessionSecurityMiddleware } from "./lib/session.js";
import { sentryRequestHandler, setupSentryExpressErrorHandler, sentryErrorHandler, correlationIdMiddleware, captureSentryTestError, captureFrontendMonitoringEvent } from "./middlewares/observability.js";
import { validateEnv } from "./lib/env.js";
import { runCriticalAssertions } from "./lib/assertions.js";
import { csrfProtection, csrfTokenEndpoint, originRefererProtection } from "./middlewares/csrf.js";
import { createSecurityEnforcementMiddleware, getSecurityConfig } from "./lib/securityPolicy.js";
import { infoVerboseTrace, warnVerboseTrace } from "./lib/traceLogging.js";
import { getEffectiveAllowedOrigins, getGlobalSettingSnapshot, GLOBAL_SETTING_KEYS, refreshRuntimeCache } from "./lib/runtimeSettings.js";


console.info("[startup] app.ts: validating environment...");
validateEnv();
console.info("[startup] app.ts: running critical assertions...");
runCriticalAssertions();
const app: Express = express();
// ── CORRELATION ID ──────────────────────────────────────────────────────────
app.use(correlationIdMiddleware);

// ── SENTRY REQUEST HANDLER ──────────────────────────────────────────────────
app.use(sentryRequestHandler());

// ── TRUST PROXY (for secure cookies behind proxy/load balancer) ─────────────
if (process.env["NODE_ENV"] === "production") {
  app.set("trust proxy", 1);
}

// ── SECURITY HEADERS ─────────────────────────────────────────────────────────
app.use(securityHeaders());

// ── CORS ──────────────────────────────────────────────────────────────────────
const securityConfig = getSecurityConfig();
const allowedOrigins = securityConfig.allowedOrigins;
if (allowedOrigins.length === 0) {
  console.warn("[startup] No allowed origins resolved at startup; runtime cache refresh may populate DB-backed values.");
}
void refreshRuntimeCache({ force: true });
const corsMiddleware = cors((req, callback) => {
  getEffectiveAllowedOrigins()
    .then((parsedAllowedOrigins) => {
      const rawAllowedOriginsEnv = parsedAllowedOrigins.join(",");
      const requestOrigin = req.header("origin") ?? null;
      const method = req.method;
      const path = req.path;

      infoVerboseTrace("[CORS-TRACE] ORIGIN CHECK", {
        requestOrigin,
        method,
        path,
        rawAllowedOriginsEnv,
        parsedAllowedOrigins,
      });

      if (!requestOrigin || parsedAllowedOrigins.includes(requestOrigin)) {
        infoVerboseTrace("[CORS-TRACE] ORIGIN ALLOWED", {
          requestOrigin,
          method,
          path,
        });
        callback(null, { origin: true, credentials: true });
        return;
      }

      warnVerboseTrace("[CORS-TRACE] ORIGIN DENIED", {
        requestOrigin,
        method,
        path,
        rawAllowedOriginsEnv,
        parsedAllowedOrigins,
        reason: "Request origin is not in canonical platform.apps domain-derived set",
      });

      callback(new Error("Not allowed by CORS"));
    })
    .catch((error) => {
      console.error("[CORS-TRACE] failed to resolve allowed origins", error);
      callback(new Error("Not allowed by CORS"));
    });
});

app.use((req, res, next) => {
  corsMiddleware(req, res, (error?: Error) => {
    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }
    next();
  });
});

// ── RAW BODY for Stripe webhook (must come before json middleware) ─────────────
app.use("/api/billing/webhook", express.raw({ type: "application/json" }));

// ── BODY PARSING ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── SESSION ───────────────────────────────────────────────────────────────────
console.info("[startup] app.ts: initializing session middleware...");
try {
  app.use(createSessionMiddleware());
  app.use(sessionSecurityMiddleware());
  console.info("[startup] app.ts: session middleware initialized.");
} catch (error) {
  console.error("[startup] app.ts: session store initialization failed.");
  if (error instanceof Error) {
    console.error(error.stack ?? error.message);
  } else {
    console.error(error);
  }
  throw new Error("Session middleware initialization failed. Check DATABASE_URL, session table permissions, and connect-pg-simple setup.");
}

// ── CENTRAL SECURITY ENFORCEMENT (fail-closed by classification) ───────────
app.use(createSecurityEnforcementMiddleware());

// ── FRONTEND MONITORING INGEST (handled frontend errors) ───────────────────
app.post("/api/monitoring/events", (req, res) => {
  const result = captureFrontendMonitoringEvent(req.body ?? {});
  res.status(result.captured ? 202 : 503).json(result);
});

app.use(csrfProtection);
app.get("/api/csrf-token", csrfTokenEndpoint);

// ── ORIGIN/REFERER PROTECTION (for sensitive routes) ───────────────────────
app.use(originRefererProtection(() => getEffectiveAllowedOrigins()));


// TEMPORARY: Backend-only Sentry verification endpoint.
// Remove this route after confirming Sentry error capture in deployed environments.
app.get("/debug-sentry", async (_req, res) => {
  const result = await captureSentryTestError("Sentry Test Error");
  res.status(result.captured ? 200 : 503).json({
    ok: result.captured,
    message: result.captured
      ? "Sentry test event submitted. Check Sentry dashboard for 'Sentry Test Error'."
      : "Sentry test event was not captured.",
    ...result,
  });
});

// ── PUBLIC FRONTEND MONITORING CONFIG ─────────────────────────────────────────
app.get("/api/monitoring/config", (_req, res) => {
  const dsn = getGlobalSettingSnapshot<string>(GLOBAL_SETTING_KEYS.SENTRY_DSN, process.env["SENTRY_DSN"] ?? "");
  const environment = getGlobalSettingSnapshot<string>(GLOBAL_SETTING_KEYS.SENTRY_ENVIRONMENT, process.env["SENTRY_ENVIRONMENT"] ?? process.env["NODE_ENV"] ?? "development");

  res.json({
    dsn: dsn || null,
    environment,
  });
});

app.get("/", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// ── ROUTES ────────────────────────────────────────────────────────────────────
app.use("/api", router);

// ── SENTRY ERROR HANDLER ────────────────────────────────────────────────────
setupSentryExpressErrorHandler(app);
app.use(sentryErrorHandler());

export default app;
