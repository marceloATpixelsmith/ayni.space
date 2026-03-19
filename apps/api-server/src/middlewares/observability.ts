import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { ErrorRequestHandler, Express, RequestHandler } from "express";

const require = createRequire(`${process.cwd()}/`);
const sentryDsn = process.env["SENTRY_DSN"];
const sentryEnvironment =
  process.env["SENTRY_ENVIRONMENT"] ?? process.env["NODE_ENV"] ?? "development";

let sentryInitialized = false;
let sentryModule: any | null = null;
let sentryLoadAttempted = false;
let sentryLoadError: string | null = null;

function getSentryModule() {
  if (sentryLoadAttempted) {
    return sentryModule;
  }

  sentryLoadAttempted = true;
  try {
    sentryModule = require("@sentry/node");
  } catch (error) {
    sentryModule = null;
    sentryLoadError = error instanceof Error ? error.message : String(error);
    console.warn("[observability] Sentry SDK unavailable; continuing without Sentry capture.");
    if (sentryLoadError) {
      console.warn(sentryLoadError);
    }
  }

  return sentryModule;
}

export function initSentry() {
  if (!sentryDsn || sentryInitialized) {
    return;
  }

  const Sentry = getSentryModule();
  if (!Sentry) {
    return;
  }

  const tracesSampleRateRaw = process.env["SENTRY_TRACES_SAMPLE_RATE"];
  const tracesSampleRate = tracesSampleRateRaw
    ? Number.parseFloat(tracesSampleRateRaw)
    : undefined;

  const integrations =
    typeof Sentry.expressIntegration === "function"
      ? [Sentry.expressIntegration()]
      : undefined;

  Sentry.init({
    dsn: sentryDsn,
    environment: sentryEnvironment,
    ...(integrations ? { integrations } : {}),
    ...(Number.isFinite(tracesSampleRate) ? { tracesSampleRate } : {}),
  });

  sentryInitialized = true;
}

export function sentryRequestHandler(): RequestHandler {
  const Sentry = getSentryModule();
  if (!sentryDsn || !Sentry) {
    return (_req, _res, next) => next();
  }

  if (typeof Sentry.Handlers?.requestHandler === "function") {
    return Sentry.Handlers.requestHandler();
  }

  return (req, _res, next) => {
    Sentry.setTag("correlation_id", req.correlationId);
    next();
  };
}

export function setupSentryExpressErrorHandler(app: Express) {
  const Sentry = getSentryModule();
  if (!sentryDsn || !Sentry) {
    return;
  }

  if (typeof Sentry.setupExpressErrorHandler === "function") {
    Sentry.setupExpressErrorHandler(app);
  }
}

export function sentryErrorHandler(): ErrorRequestHandler {
  const Sentry = getSentryModule();
  if (!sentryDsn || !Sentry) {
    return (err, _req, _res, next) => next(err);
  }

  if (typeof Sentry.Handlers?.errorHandler === "function") {
    return Sentry.Handlers.errorHandler();
  }

  return (err, req, _res, next) => {
    Sentry.withScope((scope: any) => {
      scope.setTag("correlation_id", req.correlationId);
      scope.setContext("request", {
        method: req.method,
        path: req.path,
      });
      Sentry.captureException(err);
    });
    next(err);
  };
}

export async function captureSentryTestError(message: string) {
  const Sentry = getSentryModule();
  if (!sentryDsn || !Sentry) {
    return {
      captured: false,
      reason: sentryLoadError ?? "Sentry disabled (SENTRY_DSN missing)",
    } as const;
  }

  const error = new Error(message);
  const eventId = typeof Sentry.captureException === "function"
    ? Sentry.captureException(error)
    : undefined;

  if (typeof Sentry.flush === "function") {
    await Sentry.flush(2000);
  }

  return { captured: true, eventId: eventId ?? null } as const;
}

export const correlationIdMiddleware: RequestHandler = (req, res, next) => {
  const incoming = req.headers["x-correlation-id"];
  const correlationId =
    typeof incoming === "string" && incoming.trim() ? incoming : randomUUID();

  req.correlationId = correlationId;
  res.setHeader("X-Correlation-Id", correlationId);
  next();
};
