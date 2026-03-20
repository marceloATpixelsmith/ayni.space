# 07 — Observability, Error Handling, and Sentry Inventory (DRAFT)

## Confirmed from code

### Backend observability
- `initSentry()` in startup path initializes Sentry when `SENTRY_DSN` is present.
- Request/response pipeline includes:
  - correlation ID middleware (`x-correlation-id` propagation),
  - Sentry request handler,
  - Sentry express error handler wiring,
  - fallback error capture path if handler APIs differ.
- Request context enrichment includes user/org tags and sanitized headers.
- Frontend monitoring ingest endpoint exists at `POST /api/monitoring/events`.
- Public monitoring config endpoint exists at `GET /api/monitoring/config`.
- Debug endpoint `/debug-sentry` intentionally emits test exceptions.

### Frontend observability
- `initFrontendMonitoring` initialized in admin app bootstrap.
- Captures:
  - global `window.error` and `unhandledrejection`,
  - handled exceptions via utility helpers,
  - React render errors via `MonitoringErrorBoundary`.
- Sends events first to backend ingest endpoint; falls back to direct Sentry envelope if DSN available.
- Includes API error normalization with correlation ID extraction from response headers.

### Error handling patterns
- API returns structured JSON errors for validation/authz/authn failures.
- Shared `ApiError` in `custom-fetch` includes status, method, URL, response headers/data for richer handling.

## Strong inference from code structure
- Observability strategy appears intentionally decoupled from direct Sentry SDK in browser via custom abstraction and backend ingest path.
- Correlation IDs are intended to connect frontend-reported failures with backend traces/log events.

## Unclear / requires confirmation
- Extent of structured logging standardization (currently many `console.*` calls, no central logger package).
- Whether fallback Sentry module behavior in backend is acceptable for production observability guarantees.
- Whether OpenTelemetry is actively used; local `@opentelemetry/instrumentation-http` package appears to be a no-op stub.
