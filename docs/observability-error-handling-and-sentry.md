# 14 — Observability, Error Handling, and Sentry

## Scope
- This document defines architecture constraints for its domain using `docs/monorepo-overview.md` as baseline and concrete repository paths as evidence.

## Confirmed
- Backend observability middleware lives in `apps/api-server/src/middlewares/observability.ts`.
- Backend middleware order (including Sentry request/error handlers and correlation ID flow) is defined in `apps/api-server/src/app.ts`.
- Frontend monitoring boundary/capture is implemented in `lib/frontend-observability/src/index.tsx`.
- API client error object parsing/handling behavior is implemented in `lib/api-client-react/src/custom-fetch.ts`.
- Admin app initializes frontend monitoring in `apps/admin/src/main.tsx` and wraps shell with monitoring boundary in `apps/admin/src/App.tsx`.

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
