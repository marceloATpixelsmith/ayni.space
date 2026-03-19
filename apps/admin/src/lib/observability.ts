type ErrorContext = {
  area: string;
  action: string;
  route: string;
  userId?: string;
  userEmail?: string | null;
  orgName?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
};

type ApiErrorShape = {
  status: number;
  statusText?: string;
  method?: string;
  url?: string;
  data?: unknown;
};

const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
const sentryEnvironment =
  import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE;

let observabilityInitialized = false;

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

const envelopeUrl = sentryDsn ? createSentryDsnEnvelopeUrl(sentryDsn) : null;

function createEventId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replaceAll("-", "");
  }

  return `${Date.now()}${Math.random().toString(16).slice(2, 18)}`;
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
  };
}

function getApiErrorContext(error: unknown) {
  const candidate = asApiErrorShape(error);
  if (!candidate) {
    return null;
  }

  const responseData =
    candidate.data && typeof candidate.data === "object"
      ? candidate.data
      : null;

  return {
    status: candidate.status,
    statusText: candidate.statusText,
    method: candidate.method,
    url: candidate.url,
    responseData,
  };
}

async function captureSentryEvent(error: Error, context: ErrorContext, apiError: ReturnType<typeof getApiErrorContext>) {
  if (!sentryDsn || !envelopeUrl) {
    return;
  }

  const eventId = createEventId();

  const eventPayload = {
    event_id: eventId,
    level: "error",
    environment: sentryEnvironment,
    platform: "javascript",
    timestamp: new Date().toISOString(),
    tags: {
      area: context.area,
      action: context.action,
      route: context.route,
      ...(context.tags ?? {}),
    },
    contexts: {
      onboarding: {
        area: context.area,
        action: context.action,
        route: context.route,
        orgName: context.orgName,
        ...context.extra,
        ...(apiError ? { apiError } : {}),
      },
    },
    exception: {
      values: [
        {
          type: error.name,
          value: error.message,
          ...(error.stack ? { stacktrace: { type: "raw", stacktrace: error.stack } } : {}),
        },
      ],
    },
    ...(context.userId || context.userEmail
      ? {
        user: {
          ...(context.userId ? { id: context.userId } : {}),
          ...(context.userEmail ? { email: context.userEmail } : {}),
        },
      }
      : {}),
  };

  const envelopeHeaders = {
    event_id: eventId,
    dsn: sentryDsn,
    sent_at: new Date().toISOString(),
  };

  const envelope = `${JSON.stringify(envelopeHeaders)}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(eventPayload)}`;

  try {
    await fetch(envelopeUrl, {
      method: "POST",
      headers: { "content-type": "application/x-sentry-envelope" },
      body: envelope,
      keepalive: true,
    });
  } catch (sendError) {
    console.warn("[admin][observability] Failed to send Sentry event.");
    console.warn(sendError);
  }
}

export function initFrontendObservability() {
  if (observabilityInitialized) {
    return;
  }

  observabilityInitialized = true;

  if (!sentryDsn) {
    console.info("[admin][observability] Sentry disabled (VITE_SENTRY_DSN missing).");
    return;
  }

  if (!envelopeUrl) {
    console.warn("[admin][observability] Sentry DSN format invalid; frontend capture disabled.");
  }
}

export function captureFrontendError(error: unknown, context: ErrorContext) {
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  const apiError = getApiErrorContext(error);

  console.error("[admin][error]", {
    ...context,
    apiError,
    error: normalizedError,
  });

  void captureSentryEvent(normalizedError, context, apiError);
}

export function getUserSafeApiErrorMessage(error: unknown, fallback = "An unexpected error occurred") {
  const apiError = asApiErrorShape(error);
  if (!apiError) {
    return fallback;
  }

  if (apiError.status >= 400 && apiError.status < 500 && apiError.data && typeof apiError.data === "object") {
    const errorMessage = (apiError.data as { error?: unknown }).error;
    if (typeof errorMessage === "string") {
      return errorMessage;
    }
  }

  return fallback;
}
