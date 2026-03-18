import { randomUUID } from "node:crypto";
import type { ErrorRequestHandler, Express, RequestHandler } from "express";
import * as Sentry from "@sentry/node";

const sentryDsn = process.env["SENTRY_DSN"];
const sentryEnvironment =
  process.env["SENTRY_ENVIRONMENT"] ?? process.env["NODE_ENV"] ?? "development";

let sentryInitialized = false;

export function initSentry() {
  if (!sentryDsn || sentryInitialized) {
    return;
  }

  const sentryAny = Sentry as typeof Sentry & {
    expressIntegration?: () => unknown;
  };

  const tracesSampleRateRaw = process.env["SENTRY_TRACES_SAMPLE_RATE"];
  const tracesSampleRate = tracesSampleRateRaw
    ? Number.parseFloat(tracesSampleRateRaw)
    : undefined;

  const integrations =
    typeof sentryAny.expressIntegration === "function"
      ? [sentryAny.expressIntegration()]
      : undefined;

  Sentry.init({
    dsn: sentryDsn,
    environment: sentryEnvironment,
    ...(integrations ? { integrations } : {}),
    ...(Number.isFinite(tracesSampleRate)
      ? { tracesSampleRate }
      : {}),
  });

  sentryInitialized = true;
}

export function sentryRequestHandler(): RequestHandler {
  if (!sentryDsn) {
    return (_req, _res, next) => next();
  }

  const sentryWithHandlers = Sentry as typeof Sentry & {
    Handlers?: {
      requestHandler?: () => RequestHandler;
    };
  };

  if (typeof sentryWithHandlers.Handlers?.requestHandler === "function") {
    return sentryWithHandlers.Handlers.requestHandler();
  }

  return (req, _res, next) => {
    Sentry.setTag("correlation_id", req.correlationId);
    next();
  };
}

export function setupSentryExpressErrorHandler(app: Express) {
  if (!sentryDsn) {
    return;
  }

  const sentryWithExpressSetup = Sentry as typeof Sentry & {
    setupExpressErrorHandler?: (app: Express) => void;
  };

  if (typeof sentryWithExpressSetup.setupExpressErrorHandler === "function") {
    sentryWithExpressSetup.setupExpressErrorHandler(app);
  }
}

export function sentryErrorHandler(): ErrorRequestHandler {
  if (!sentryDsn) {
    return (err, _req, _res, next) => next(err);
  }

  const sentryWithHandlers = Sentry as typeof Sentry & {
    Handlers?: {
      errorHandler?: () => ErrorRequestHandler;
    };
  };

  if (typeof sentryWithHandlers.Handlers?.errorHandler === "function") {
    return sentryWithHandlers.Handlers.errorHandler();
  }

  return (err, req, _res, next) => {
    Sentry.withScope((scope) => {
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

export const correlationIdMiddleware: RequestHandler = (req, res, next) => {
  const incoming = req.headers["x-correlation-id"];
  const correlationId =
    typeof incoming === "string" && incoming.trim() ? incoming : randomUUID();

  req.correlationId = correlationId;
  res.setHeader("X-Correlation-Id", correlationId);
  next();
};
