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

function createSentryDsnEnvelopeUrl(dsn: string) {
  const parsed = new URL(dsn);
  const projectId = parsed.pathname.split("/").filter(Boolean).at(-1);
  if (!projectId) {
    return null;
  }
  const basePath = parsed.pathname.split("/").filter(Boolean).slice(0, -1).join("/");
  const prefix = basePath ? `/${basePath}` : "";
  return `${parsed.protocol}//${parsed.host}${prefix}/api/${projectId}/envelope/`;
}

function createFallbackSentryModule() {
  if (!sentryDsn) {
    return null;
  }

  const envelopeUrl = createSentryDsnEnvelopeUrl(sentryDsn);
  if (!envelopeUrl) {
    return null;
  }

  let activeScope: { tags: Record<string, string>; contexts: Record<string, unknown> } | null = null;
  const pendingSends = new Set<Promise<unknown>>();

  const captureException = (error: unknown) => {
    const eventId = randomUUID().replaceAll("-", "");
    const err = error instanceof Error ? error : new Error(String(error));
    const scope = activeScope;

    const eventPayload = {
      event_id: eventId,
      level: "error",
      environment: sentryEnvironment,
      platform: "node",
      timestamp: new Date().toISOString(),
      tags: scope?.tags ?? {},
      contexts: scope?.contexts ?? {},
      exception: {
        values: [
          {
            type: err.name,
            value: err.message,
            ...(err.stack ? { stacktrace: { type: "raw", stacktrace: err.stack } } : {}),
          },
        ],
      },
    };

    const envelopeHeaders = {
      event_id: eventId,
      dsn: sentryDsn,
      sent_at: new Date().toISOString(),
    };

    const envelope = `${JSON.stringify(envelopeHeaders)}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(eventPayload)}`;
    const sendPromise = fetch(envelopeUrl, {
      method: "POST",
      headers: { "content-type": "application/x-sentry-envelope" },
      body: envelope,
    }).catch((err) => {
      console.warn("[observability] Fallback Sentry send failed.");
      console.warn(err instanceof Error ? err.message : String(err));
    }).finally(() => {
      pendingSends.delete(sendPromise);
    });

    pendingSends.add(sendPromise);
    return eventId;
  };

  return {
    init: () => undefined,
    captureException,
    withScope: (callback: (scope: any) => void) => {
      activeScope = {
        tags: {},
        contexts: {},
      };
      try {
        callback({
          setTag: (key: string, value: string) => {
            activeScope?.tags && (activeScope.tags[key] = value);
          },
          setContext: (key: string, value: unknown) => {
            activeScope?.contexts && (activeScope.contexts[key] = value);
          },
        });
      } finally {
        activeScope = null;
      }
    },
    flush: async (timeoutMs = 2000) => {
      const settled = Promise.allSettled([...pendingSends]);
      await Promise.race([
        settled,
        new Promise((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
      return true;
    },
  };
}

function getSentryModule() {
  if (sentryLoadAttempted) {
    return sentryModule;
  }

  sentryLoadAttempted = true;
  try {
    sentryModule = require("@sentry/node");
  } catch (error) {
    sentryModule = createFallbackSentryModule();
    sentryLoadError = error instanceof Error ? error.message : String(error);
    console.warn("[observability] Sentry SDK unavailable; using fallback transport.");
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
