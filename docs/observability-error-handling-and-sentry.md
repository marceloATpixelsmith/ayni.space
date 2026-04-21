# 10 — Observability, Error Handling, and Sentry

## Scope
- This document defines architecture constraints for its domain using `docs/monorepo-overview.md` as baseline and concrete repository paths as evidence.

## Confirmed
- Backend observability middleware lives in `apps/api-server/src/middlewares/observability.ts`.
- Signup denial traceability is implemented through the existing audit pipeline (`apps/api-server/src/lib/audit.ts`) using structured `auth.signup.decision` metadata in `apps/api-server/src/routes/auth.ts` plus normalized Turnstile denial reason codes in `apps/api-server/src/middlewares/turnstile.ts`.
- Signup denial/internal decision reason codes are recorded as structured metadata (`reasonCode`, `decisionCategory`) in `platform.audit_logs` via `writeAuditLog`, including:
  - `disposable_email`
  - `undeliverable_email`
  - `ipqs_advisory_step_up`
  - `ipqs_provider_failure_step_up`
  - `turnstile_missing_or_invalid`
  - `duplicate_existing_email`
  - `signup_not_allowed_by_access_policy`
  - `validation_failed`
  - `internal_exception`
- Signup-denial logs carry correlation-safe context (`correlationId`, `appSlug`, `sessionGroup`, `normalizedEmailHash`) while frontend error responses remain intentionally generic and do not expose internal denial reasons.
- Signup-denial and Turnstile-denial writes on auth paths now await the existing `writeAuditLog` pipeline before returning denial responses, reducing dropped denial traces on short-lived runtimes (`apps/api-server/src/routes/auth.ts`, `apps/api-server/src/middlewares/turnstile.ts`, `apps/api-server/src/lib/audit.ts`).
- Signup-denial/Turnstile-denial metadata now includes query-oriented safe email fields (`normalizedEmailHash`, `normalizedEmailMasked`, `normalizedEmailDomain`) in addition to correlation context (`apps/api-server/src/routes/auth.ts`, `apps/api-server/src/middlewares/turnstile.ts`).
- Backend middleware order (including Sentry request/error handlers and correlation ID flow) is defined in `apps/api-server/src/app.ts`.
- Frontend monitoring boundary/capture is implemented in `lib/frontend-observability/src/index.tsx`.
- API client error object parsing/handling behavior is implemented in `lib/api-client-react/src/custom-fetch.ts`.
- Admin app initializes frontend monitoring in `apps/admin/src/main.tsx` and wraps shell with monitoring boundary in `apps/admin/src/App.tsx`.
- Admin frontend monitoring/auth debug settings (`VITE_SENTRY_DSN`, `VITE_SENTRY_ENVIRONMENT`, `VITE_AUTH_DEBUG`) now resolve from DB-backed app runtime settings after bootstrap fetch (`/api/apps/slug/:appSlug/runtime-settings`); frontend env fallback for those values has been removed, leaving bootstrap env limited to API reachability/app identity (`VITE_API_BASE_URL`, `VITE_APP_SLUG`, `BASE_PATH`). Monitoring initialization starts from bootstrap values and is reapplied only when hydrated Sentry values differ (`apps/admin/src/main.tsx`, `apps/admin/src/runtimeBootstrap.ts`, `lib/frontend-security/src/runtimeSettings.ts`, `lib/frontend-security/src/authDebug.ts`).

## Inferred
- Observability is intended as end-to-end: frontend capture + backend ingest/error handling + request correlation.
- Error normalization in shared fetch client is used to keep frontend behavior consistent across API failures.

## Unclear
- SLO/alerting ownership and thresholds are not defined in architecture docs.
- Whether mockup or future apps must use the exact same frontend observability stack.

## Do not break
- Do not reorder/removing backend observability middleware in ways that disable correlation or Sentry handlers.
- Do not bypass shared frontend monitoring boundary in admin shell.
- Do not replace shared API error parsing contracts in `custom-fetch` with app-local inconsistent behavior.
- Do not add new frontend runtime surfaces without deciding observability integration explicitly.
