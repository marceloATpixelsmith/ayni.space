import React from "react";

type MonitoringUser = {
  id?: string;
  email?: string | null;
};

export type MonitoringContext = {
  app: string;
  area: string;
  action: string;
  route?: string;
  user?: MonitoringUser;
  organizationId?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
};

export type FrontendMonitoringInitOptions = {
  app: string;
  dsn?: string;
  environment?: string;
  configEndpoint?: string;
  ingestEndpoint?: string;
};

type ApiErrorShape = {
  status: number;
  statusText?: string;
  method?: string;
  url?: string;
  data?: unknown;
  headers?: unknown;
};

type ApiErrorContext = {
  status: number;
  statusText?: string;
  method?: string;
  url?: string;
  correlationId?: string | null;
  responseData?: Record<string, unknown> | null;
  responseMessage?: string | null;
};

type SentryExceptionInput = {
  message: string;
  name?: string;
  stack?: string;
};

type MonitoringState = {
  app: string;
  dsn: string | null;
  environment: string;
  envelopeUrl: string | null;
  ingestEndpoint: string;
  initialized: boolean;
  hasGlobalHandlers: boolean;
  recentFingerprints: Map<string, number>;
};

const DEFAULT_UI_ERROR_MESSAGE = "Something went wrong. Please try again.";

const state: MonitoringState = {
  app: "unknown-app",
  dsn: null,
  environment: "development",
  envelopeUrl: null,
  ingestEndpoint: "/api/monitoring/events",
  initialized: false,
  hasGlobalHandlers: false,
  recentFingerprints: new Map(),
};

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

function createEventId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replaceAll("-", "");
  }

  return `${Date.now()}${Math.random().toString(16).slice(2, 18)}`;
}

function getStringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.trim() ? candidate : null;
}

function asApiErrorShape(error: unknown): ApiErrorShape | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const candidate = error as Partial<ApiErrorShape>;
  if (typeof candidate.status !== "number") {
    return null;
  }

  return {
    status: candidate.status,
    statusText: typeof candidate.statusText === "string" ? candidate.statusText : undefined,
    method: typeof candidate.method === "string" ? candidate.method : undefined,
    url: typeof candidate.url === "string" ? candidate.url : undefined,
    data: candidate.data,
    headers: candidate.headers,
  };
}

function getCorrelationId(headers: unknown) {
  if (!headers || typeof headers !== "object") {
    return null;
  }

  if (typeof (headers as Headers).get !== "function") {
    return null;
  }

  const value = (headers as Headers).get("x-correlation-id") ?? (headers as Headers).get("X-Correlation-Id");
  return value && value.trim() ? value : null;
}

function getApiErrorMessage(apiError: ApiErrorShape): string | null {
  if (typeof apiError.data === "string" && apiError.data.trim()) {
    return apiError.data;
  }

  return (
    getStringField(apiError.data, "error") ??
    getStringField(apiError.data, "message") ??
    getStringField(apiError.data, "detail")
  );
}

function getApiErrorContext(error: unknown): ApiErrorContext | null {
  const candidate = asApiErrorShape(error);
  if (!candidate) {
    return null;
  }

  return {
    status: candidate.status,
    statusText: candidate.statusText,
    method: candidate.method,
    url: candidate.url,
    correlationId: getCorrelationId(candidate.headers),
    responseData: candidate.data && typeof candidate.data === "object" ? candidate.data as Record<string, unknown> : null,
    responseMessage: getApiErrorMessage(candidate),
  };
}

function normalizeException(error: unknown, apiError: ApiErrorContext | null): SentryExceptionInput {
  if (apiError) {
    const requestDescriptor = `${apiError.method ?? "REQUEST"} ${apiError.url ?? "unknown_url"}`;
    const statusDescriptor = `${apiError.status}${apiError.statusText ? ` ${apiError.statusText}` : ""}`;
    const detail = apiError.responseMessage ? `: ${apiError.responseMessage}` : "";
    return {
      name: "ApiRequestError",
      message: `${requestDescriptor} failed with ${statusDescriptor}${detail}`,
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    name: "HandledError",
    message: String(error),
  };
}

function dedupeFingerprint(fingerprint: string) {
  const now = Date.now();
  const lastSent = state.recentFingerprints.get(fingerprint);

  if (lastSent && now - lastSent < 2500) {
    return true;
  }

  state.recentFingerprints.set(fingerprint, now);

  if (state.recentFingerprints.size > 200) {
    for (const [key, ts] of state.recentFingerprints) {
      if (now - ts > 15 * 60_000) {
        state.recentFingerprints.delete(key);
      }
    }
  }

  return false;
}

function buildDefaultContext(overrides: Partial<MonitoringContext>): MonitoringContext {
  return {
    app: overrides.app ?? state.app,
    area: overrides.area ?? "unknown-area",
    action: overrides.action ?? "unknown-action",
    route: overrides.route ?? (typeof window !== "undefined" ? window.location.pathname : undefined),
    user: overrides.user,
    organizationId: overrides.organizationId,
    tags: overrides.tags,
    extra: overrides.extra,
  };
}

async function sendSentryEvent(
  exception: SentryExceptionInput,
  context: MonitoringContext,
  apiError: ApiErrorContext | null,
) {

  const fingerprintParts = [
    context.app,
    context.area,
    context.action,
    apiError ? `http_${apiError.status}` : "unexpected",
    apiError?.responseMessage ?? exception.name ?? "unknown",
  ];
  const fingerprintKey = fingerprintParts.join("|");

  if (dedupeFingerprint(fingerprintKey)) {
    return;
  }

  const eventId = createEventId();
  const eventPayload = {
    event_id: eventId,
    level: "error",
    environment: state.environment,
    platform: "javascript",
    timestamp: new Date().toISOString(),
    transaction: `${context.app}.${context.area}.${context.action}`,
    message: `${context.app}.${context.area}.${context.action} failed`,
    fingerprint: fingerprintParts,
    tags: {
      app: context.app,
      area: context.area,
      action: context.action,
      route: context.route ?? "unknown",
      ...(context.organizationId ? { org_id: context.organizationId } : {}),
      ...(apiError?.correlationId ? { correlation_id: apiError.correlationId } : {}),
      ...(context.tags ?? {}),
    },
    contexts: {
      monitoring: {
        app: context.app,
        area: context.area,
        action: context.action,
        route: context.route,
        organizationId: context.organizationId,
        ...context.extra,
      },
      ...(apiError ? { api: apiError } : {}),
    },
    exception: {
      values: [
        {
          type: exception.name ?? "Error",
          value: exception.message,
          ...(exception.stack
            ? {
              stacktrace: {
                type: "raw",
                stacktrace: exception.stack,
              },
            }
            : {}),
        },
      ],
    },
    ...(context.user?.id || context.user?.email
      ? {
        user: {
          ...(context.user.id ? { id: context.user.id } : {}),
          ...(context.user.email ? { email: context.user.email } : {}),
        },
      }
      : {}),
  };


  try {
    const response = await fetch(state.ingestEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      keepalive: true,
      body: JSON.stringify({
        eventId,
        exception,
        context,
        apiError,
        fingerprint: fingerprintParts,
      }),
    });

    if (response.ok) {
      return;
    }
  } catch (sendError) {
    console.warn(`[monitoring][${context.app}] Failed to send event to backend ingest endpoint.`);
    console.warn(sendError);
  }

  if (!state.dsn || !state.envelopeUrl) {
    return;
  }

  const envelopeHeaders = {
    event_id: eventId,
    dsn: state.dsn,
    sent_at: new Date().toISOString(),
  };

  const envelope = `${JSON.stringify(envelopeHeaders)}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(eventPayload)}`;

  try {
    await fetch(state.envelopeUrl, {
      method: "POST",
      headers: { "content-type": "application/x-sentry-envelope" },
      body: envelope,
      keepalive: true,
    });
  } catch (sendError) {
    console.warn(`[monitoring][${context.app}] Failed to send event.`);
    console.warn(sendError);
  }
}

function reportGlobalError(error: unknown, source: string) {
  const context = buildDefaultContext({
    area: "runtime",
    action: source,
    route: typeof window !== "undefined" ? window.location.pathname : undefined,
  });
  const apiError = getApiErrorContext(error);
  const exception = normalizeException(error, apiError);

  void sendSentryEvent(exception, context, apiError);
}


async function resolveDsnFromConfig(configEndpoint: string): Promise<{ dsn?: string; environment?: string } | null> {
  try {
    const response = await fetch(configEndpoint, {
      method: "GET",
      credentials: "include",
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as { dsn?: unknown; environment?: unknown };
    return {
      dsn: typeof data.dsn === "string" && data.dsn.trim() ? data.dsn : undefined,
      environment: typeof data.environment === "string" && data.environment.trim() ? data.environment : undefined,
    };
  } catch {
    return null;
  }
}

function bindGlobalHandlers() {
  if (state.hasGlobalHandlers || typeof window === "undefined") {
    return;
  }

  window.addEventListener("error", (event: ErrorEvent) => {
    reportGlobalError(event.error ?? event.message, "window.error");
  });

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    reportGlobalError(event.reason, "window.unhandledrejection");
  });

  state.hasGlobalHandlers = true;
}

export function initFrontendMonitoring(options: FrontendMonitoringInitOptions) {
  state.app = options.app;
  state.environment = options.environment ?? "development";
  state.dsn = options.dsn ?? null;
  state.envelopeUrl = options.dsn ? createSentryDsnEnvelopeUrl(options.dsn) : null;
  state.ingestEndpoint = options.ingestEndpoint ?? "/api/monitoring/events";

  if (state.initialized) {
    return;
  }

  state.initialized = true;
  bindGlobalHandlers();

  if (!state.dsn && options.configEndpoint) {
    void resolveDsnFromConfig(options.configEndpoint).then((config) => {
      if (!config?.dsn) {
        console.info(`[monitoring][${state.app}] Sentry disabled (dsn missing).`);
        return;
      }

      state.dsn = config.dsn;
      state.environment = config.environment ?? state.environment;
      state.envelopeUrl = createSentryDsnEnvelopeUrl(config.dsn);

      if (!state.envelopeUrl) {
        console.warn(`[monitoring][${state.app}] Invalid DSN format from config endpoint.`);
      }
    });
    return;
  }

  if (!state.dsn) {
    console.info(`[monitoring][${state.app}] Sentry disabled (dsn missing).`);
    return;
  }

  if (!state.envelopeUrl) {
    console.warn(`[monitoring][${state.app}] Invalid DSN format; envelope reporting disabled.`);
  }
}

export function captureHandledException(error: unknown, contextInput: Partial<MonitoringContext>) {
  const context = buildDefaultContext(contextInput);
  const apiError = getApiErrorContext(error);
  const exception = normalizeException(error, apiError);

  console.error(`[monitoring][${context.app}]`, {
    context,
    apiError,
    error: exception,
  });

  void sendSentryEvent(exception, context, apiError);
}

export function captureApiFailure(error: unknown, contextInput: Partial<MonitoringContext>) {
  captureHandledException(error, contextInput);
}

export function getUserSafeErrorMessage(error: unknown, fallback = DEFAULT_UI_ERROR_MESSAGE) {
  const apiError = asApiErrorShape(error);
  if (!apiError) {
    return fallback;
  }

  if (apiError.status >= 400 && apiError.status < 500) {
    const message = getApiErrorMessage(apiError);
    if (message) {
      return message;
    }
  }

  return fallback;
}

export async function withCapturedAsync<T>(
  action: () => Promise<T>,
  contextInput: Partial<MonitoringContext>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    captureHandledException(error, contextInput);
    throw error;
  }
}

type MonitoringErrorBoundaryProps = {
  app: string;
  area?: string;
  action?: string;
  route?: string;
  user?: MonitoringUser;
  organizationId?: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
};

type MonitoringErrorBoundaryState = {
  hasError: boolean;
};

export class MonitoringErrorBoundary extends React.Component<
  MonitoringErrorBoundaryProps,
  MonitoringErrorBoundaryState
> {
  state: MonitoringErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    captureHandledException(error, {
      app: this.props.app,
      area: this.props.area ?? "react",
      action: this.props.action ?? "render",
      route: this.props.route,
      user: this.props.user,
      organizationId: this.props.organizationId,
    });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={{ padding: "1rem", fontFamily: "sans-serif" }}>
          <h2>Something went wrong</h2>
          <p>{DEFAULT_UI_ERROR_MESSAGE}</p>
        </div>
      );
    }

    return this.props.children;
  }
}
