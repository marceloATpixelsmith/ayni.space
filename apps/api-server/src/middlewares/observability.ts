import { randomUUID } from "node:crypto";
import type { ErrorRequestHandler, RequestHandler } from "express";

export function initSentry() {
  // No-op by default. Can be replaced with a full provider integration when installed.
}

export function sentryRequestHandler(): RequestHandler {
  return (_req, _res, next) => next();
}

export function sentryErrorHandler(): ErrorRequestHandler {
  return (err, _req, _res, next) => next(err);
}

export const correlationIdMiddleware: RequestHandler = (req, res, next) => {
  const incoming = req.headers["x-correlation-id"];
  const correlationId = typeof incoming === "string" && incoming.trim() ? incoming : randomUUID();

  req.correlationId = correlationId;
  res.setHeader("X-Correlation-Id", correlationId);
  next();
};
