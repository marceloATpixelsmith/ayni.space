import express, { type Express } from "express";
import cors from "cors";
import { securityHeaders } from "./middlewares/securityHeaders.js";
import router from "./routes/index.js";
import { createSessionMiddleware } from "./lib/session.js";
import { initSentry, sentryRequestHandler, sentryErrorHandler, correlationIdMiddleware } from "./middlewares/observability.js";
import { validateEnv } from "./lib/env.js";
import { runCriticalAssertions } from "./lib/assertions.js";
import { csrfProtection, csrfTokenEndpoint, originRefererProtection } from "./middlewares/csrf.js";
import { rateLimiter } from "./middlewares/rateLimit.js";


validateEnv();
runCriticalAssertions();
initSentry();
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

app.use(createSessionMiddleware());

// ── CSRF PROTECTION (all state-changing routes) ─────────────────────────────
// ── RATE LIMITING (public/auth/invitation/org/profile/billing) ──────────────
app.use("/api/auth", rateLimiter());
app.use("/api/invitations", rateLimiter());
app.use("/api/organizations", rateLimiter());
app.use("/api/users", rateLimiter());
app.use("/api/billing", rateLimiter());

app.use(csrfProtection);
app.get("/api/csrf-token", csrfTokenEndpoint);

// ── ORIGIN/REFERER PROTECTION (for sensitive routes) ───────────────────────
const allowedOriginsForOriginCheck = process.env["ALLOWED_ORIGINS"]?.split(",").map(o => o.trim()).filter(Boolean) || [];
app.use(originRefererProtection(allowedOriginsForOriginCheck));

// ── ROUTES ────────────────────────────────────────────────────────────────────
app.use("/api", router);

// ── SENTRY ERROR HANDLER ────────────────────────────────────────────────────
app.use(sentryErrorHandler());

export default app;
