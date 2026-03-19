import { randomUUID } from "node:crypto";
import type { ErrorRequestHandler, Express, RequestHandler } from "express";
import * as Sentry from "@sentry/node";

const sentryDsn = process.env["SENTRY_DSN"];
const sentryEnvironment =
  process.env["SENTRY_ENVIRONMENT"] ?? process.env["NODE_ENV"] ?? "development";

const sentryEnabled = Boolean(sentryDsn);
let sentryInitialized = false;

export function initSentry() {
  if (!sentryEnabled || sentryInitialized) {
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
  if (!sentryEnabled) {
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
  if (!sentryEnabled) {
    return;
  }

  if (typeof Sentry.setupExpressErrorHandler === "function") {
    Sentry.setupExpressErrorHandler(app);
  }
}

export function sentryErrorHandler(): ErrorRequestHandler {
  if (!sentryEnabled) {
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
  if (!sentryEnabled) {
    return { captured: false, reason: "Sentry disabled (SENTRY_DSN missing)" } as const;
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
