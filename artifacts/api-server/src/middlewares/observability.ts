// Sentry integration and correlation ID middleware
import * as Sentry from "@sentry/node";
import { v4 as uuidv4 } from "uuid";

export function initSentry() {
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.2,
      environment: process.env.NODE_ENV,
    });
  }
}

export function sentryRequestHandler() {
  return process.env.SENTRY_DSN ? Sentry.Handlers.requestHandler() : (req, res, next) => next();
}

export function sentryErrorHandler() {
  return process.env.SENTRY_DSN ? Sentry.Handlers.errorHandler() : (err, req, res, next) => next(err);
}

export function correlationIdMiddleware(req, res, next) {
  req.correlationId = req.headers["x-correlation-id"] || uuidv4();
  res.setHeader("X-Correlation-Id", req.correlationId);
  next();
}
