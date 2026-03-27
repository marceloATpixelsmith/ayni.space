import express, { type Express } from "express";
import cors from "cors";
import { securityHeaders } from "./middlewares/securityHeaders.js";
import router from "./routes/index.js";
import { createSessionMiddleware, sessionSecurityMiddleware } from "./lib/session.js";
import { sentryRequestHandler, setupSentryExpressErrorHandler, sentryErrorHandler, correlationIdMiddleware, captureSentryTestError, captureFrontendMonitoringEvent } from "./middlewares/observability.js";
import { validateEnv } from "./lib/env.js";
import { runCriticalAssertions } from "./lib/assertions.js";
import { csrfProtection, csrfTokenEndpoint, originRefererProtection } from "./middlewares/csrf.js";
import { authRateLimiter, rateLimiter } from "./middlewares/rateLimit.js";


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
const allowedOrigins = process.env["ALLOWED_ORIGINS"]?.split(",").map(o => o.trim()).filter(Boolean) || [];
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

// ── CSRF PROTECTION (all state-changing routes) ─────────────────────────────
// ── RATE LIMITING (public/auth/invitation/org/profile/billing) ──────────────
const googleAuthUrlRateLimitMax = Number.parseInt(process.env["AUTH_GOOGLE_URL_RATE_LIMIT_MAX"] ?? "20", 10);
const googleAuthCallbackRateLimitMax = Number.parseInt(process.env["AUTH_GOOGLE_CALLBACK_RATE_LIMIT_MAX"] ?? "20", 10);
app.use("/api/auth/google/url", authRateLimiter({ max: googleAuthUrlRateLimitMax, keyPrefix: "auth-google-url" }));
app.use("/api/auth/google/callback", authRateLimiter({ max: googleAuthCallbackRateLimitMax, keyPrefix: "auth-google-callback" }));
app.use("/api/auth", authRateLimiter());
app.use("/api/invitations", authRateLimiter());
app.use("/api/organizations", authRateLimiter());
app.use("/api/users", rateLimiter());
app.use("/api/billing", rateLimiter());


// ── FRONTEND MONITORING INGEST (handled frontend errors) ───────────────────
app.post("/api/monitoring/events", (req, res) => {
  const result = captureFrontendMonitoringEvent(req.body ?? {});
  res.status(result.captured ? 202 : 503).json(result);
});

app.use(csrfProtection);
app.get("/api/csrf-token", csrfTokenEndpoint);

// ── ORIGIN/REFERER PROTECTION (for sensitive routes) ───────────────────────
const allowedOriginsForOriginCheck = process.env["ALLOWED_ORIGINS"]?.split(",").map(o => o.trim()).filter(Boolean) || [];
app.use(originRefererProtection(allowedOriginsForOriginCheck));


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

// ── ROUTES ────────────────────────────────────────────────────────────────────
app.use("/api", router);

// ── SENTRY ERROR HANDLER ────────────────────────────────────────────────────
setupSentryExpressErrorHandler(app);
app.use(sentryErrorHandler());

export default app;
