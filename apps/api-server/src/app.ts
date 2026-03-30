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
import { resolveSessionGroupFromOrigin } from "./lib/sessionGroup.js";


console.info("[startup] app.ts: validating environment...");
validateEnv();
console.info("[startup] app.ts: running critical assertions...");
runCriticalAssertions();
const app: Express = express();
app.use((req, _res, next) => {
  if (req.method === "POST" && req.path === "/api/auth/google/url") {
    const requestOrigin = req.get("origin") ?? null;
    console.info("[auth/google/url]", {
      branch: "app_request_received",
      method: req.method,
      path: req.path,
      requestOrigin,
      resolvedSessionGroup: requestOrigin ? resolveSessionGroupFromOrigin(requestOrigin) : null,
      turnstileTokenPresent: Boolean(req.get("cf-turnstile-response")),
    });
  }
  next();
});
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
  throw new Error("ALLOWED_ORIGINS environment variable must be set with at least one origin");
}
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow same-origin (no Origin header) or whitelisted origins
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true, // Required for cookies
  })
);
app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof Error && err.message === "Not allowed by CORS") {
    const requestOrigin = req.get("origin") ?? null;
    console.info("[auth/google/url]", {
      branch: "cors_origin_rejected",
      method: req.method,
      path: req.path,
      requestOrigin,
      resolvedSessionGroup: requestOrigin ? resolveSessionGroupFromOrigin(requestOrigin) : null,
      responseStatus: 403,
    });
    res.status(403).json({
      error: "Request origin is missing or not allowed.",
      code: "ORIGIN_NOT_ALLOWED",
    });
    return;
  }
  next(err);
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
app.use(originRefererProtection(allowedOrigins));


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
  const dsn = process.env["SENTRY_DSN"] ?? null;
  const environment = process.env["SENTRY_ENVIRONMENT"] ?? process.env["NODE_ENV"] ?? "development";

  res.json({
    dsn,
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
