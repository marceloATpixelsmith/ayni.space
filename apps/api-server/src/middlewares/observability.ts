import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { ErrorRequestHandler, Express, RequestHandler } from "express";
import { getGlobalSettingSnapshot, GLOBAL_SETTING_KEYS } from "../lib/runtimeSettings.js";

const require = createRequire(`${process.cwd()}/`);
const sentryDsn = String(getGlobalSettingSnapshot<string>(GLOBAL_SETTING_KEYS.SENTRY_DSN, process.env["SENTRY_DSN"] ?? "")).trim() || undefined;
const sentryEnvironment = String(getGlobalSettingSnapshot<string>(GLOBAL_SETTING_KEYS.SENTRY_ENVIRONMENT, process.env["SENTRY_ENVIRONMENT"] ?? process.env["NODE_ENV"] ?? "development"));

let sentryInitialized = false;
let sentryModule: any | null = null;
let sentryLoadAttempted = false;
let sentryLoadError: string | null = null;

function sanitizeHeaders(headers: Record<string, unknown>) {
  const redactedHeaderPattern = /(authorization|cookie|token|secret|password|api[-_]?key)/i;
  const safe: Record<string, string | string[]> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (redactedHeaderPattern.test(key)) {
      continue;
    }
    if (typeof value === "string") {
      safe[key] = value;
    } else if (Array.isArray(value)) {
      safe[key] = value.filter((entry): entry is string => typeof entry === "string");
    }
  }

  return safe;
}

function getRequestOrgId(req: any) {
  const fromParams = req?.params?.orgId;
  if (typeof fromParams === "string" && fromParams) return fromParams;

  const fromBody = req?.body?.orgId;
  if (typeof fromBody === "string" && fromBody) return fromBody;

  const fromQuery = req?.query?.orgId;
  if (typeof fromQuery === "string" && fromQuery) return fromQuery;

  const fromSession = req?.session?.activeOrgId;
  if (typeof fromSession === "string" && fromSession) return fromSession;

  return null;
}

function applySentryRequestContext(Sentry: any, req: any) {
  const userId = typeof req?.session?.userId === "string" ? req.session.userId : undefined;
  const possibleUser = req?.user as { id?: string; email?: string } | undefined;
  const userEmail = typeof possibleUser?.email === "string" ? possibleUser.email : undefined;
  const orgId = getRequestOrgId(req);

  if (typeof Sentry.setTag === "function" && req?.correlationId) {
    Sentry.setTag("correlation_id", req.correlationId);
  }

  if (typeof Sentry.setContext === "function") {
    Sentry.setContext("request", {
      method: req?.method,
      url: req?.originalUrl ?? req?.url,
      headers: sanitizeHeaders(req?.headers ?? {}),
      correlationId: req?.correlationId,
    });

    if (orgId) {
      Sentry.setContext("organization", { id: orgId });
    }
  }

  if (typeof Sentry.setUser === "function") {
    Sentry.setUser(
      userId || userEmail
        ? {
          ...(userId ? { id: userId } : {}),
          ...(userEmail ? { email: userEmail } : {}),
        }
        : null,
    );
  }
}

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
  const globalScope = { tags: {} as Record<string, string>, contexts: {} as Record<string, unknown> };
  let globalUser: { id?: string; email?: string } | null = null;
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
      tags: { ...globalScope.tags, ...(scope?.tags ?? {}) },
      contexts: { ...globalScope.contexts, ...(scope?.contexts ?? {}) },
      exception: {
        values: [
          {
            type: err.name,
            value: err.message,
            ...(err.stack ? { stacktrace: { type: "raw", stacktrace: err.stack } } : {}),
          },
        ],
      },
      ...(globalUser ? { user: globalUser } : {}),
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
    setTag: (key: string, value: string) => {
      globalScope.tags[key] = value;
    },
    setContext: (key: string, value: unknown) => {
      globalScope.contexts[key] = value;
    },
    setUser: (user: { id?: string; email?: string } | null) => {
      globalUser = user;
    },
    captureException,
    withScope: (callback: (scope: any) => void) => {
      activeScope = {
        tags: { ...globalScope.tags },
        contexts: { ...globalScope.contexts },
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
    const handler = Sentry.Handlers.requestHandler();
    return (req, res, next) => {
      applySentryRequestContext(Sentry, req);
      handler(req, res, next);
    };
  }

  return (req, _res, next) => {
    applySentryRequestContext(Sentry, req);
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


export function captureFrontendMonitoringEvent(payload: {
  exception?: { message?: unknown; name?: unknown; stack?: unknown };
  context?: {
    app?: unknown;
    area?: unknown;
    action?: unknown;
    route?: unknown;
    user?: { id?: unknown; email?: unknown };
    organizationId?: unknown;
    tags?: Record<string, unknown>;
    extra?: Record<string, unknown>;
  };
  apiError?: unknown;
  fingerprint?: unknown;
}) {
  const Sentry = getSentryModule();
  if (!sentryDsn || !Sentry || typeof Sentry.withScope !== "function") {
    return { captured: false, reason: sentryLoadError ?? "Sentry disabled (SENTRY_DSN missing)" } as const;
  }

  const context = payload.context ?? {};
  const exceptionName = typeof payload.exception?.name === "string" ? payload.exception.name : "FrontendHandledError";
  const exceptionMessage = typeof payload.exception?.message === "string" ? payload.exception.message : "Frontend handled error";
  const error = new Error(exceptionMessage);
  error.name = exceptionName;
  if (typeof payload.exception?.stack === "string") {
    error.stack = payload.exception.stack;
  }

  const eventId = Sentry.withScope((scope: any) => {
    if (typeof context.app === "string") scope.setTag("app", context.app);
    if (typeof context.area === "string") scope.setTag("area", context.area);
    if (typeof context.action === "string") scope.setTag("action", context.action);
    if (typeof context.route === "string") scope.setTag("route", context.route);
    if (typeof context.organizationId === "string") scope.setTag("org_id", context.organizationId);

    if (context.tags && typeof context.tags === "object") {
      for (const [key, value] of Object.entries(context.tags)) {
        if (typeof value === "string") scope.setTag(key, value);
      }
    }

    if (context.extra && typeof context.extra === "object") {
      scope.setContext("monitoring_extra", context.extra);
    }

    if (payload.apiError && typeof payload.apiError === "object") {
      scope.setContext("api", payload.apiError);
    }

    if (Array.isArray(payload.fingerprint) && payload.fingerprint.length > 0) {
      scope.setFingerprint(payload.fingerprint.map((value) => String(value)));
    }

    const userId = typeof context.user?.id === "string" ? context.user.id : undefined;
    const userEmail = typeof context.user?.email === "string" ? context.user.email : undefined;
    if (userId || userEmail) {
      scope.setUser({
        ...(userId ? { id: userId } : {}),
        ...(userEmail ? { email: userEmail } : {}),
      });
    }

    return Sentry.captureException(error);
  });

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
