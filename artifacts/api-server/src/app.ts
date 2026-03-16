import express, { type Express } from "express";
import cors from "cors";
import router from "./routes/index.js";
import { createSessionMiddleware } from "./lib/session.js";

const app: Express = express();

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env["ALLOWED_ORIGINS"]?.split(",") || [];
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow same-origin (no Origin header) or whitelisted origins
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
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

// ── ROUTES ────────────────────────────────────────────────────────────────────
app.use("/api", router);

export default app;
