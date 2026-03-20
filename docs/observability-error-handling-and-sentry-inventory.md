# 07 — Observability, Error Handling, and Sentry Inventory

## Scope
- Inventory observability and error-handling architecture locations.
- Canonical companion: `docs/observability-error-handling-and-sentry.md`.

## Confirmed
- Backend observability middleware: `apps/api-server/src/middlewares/observability.ts`.
- Middleware order and handlers: `apps/api-server/src/app.ts`.
- Frontend monitoring layer: `lib/frontend-observability/src/index.tsx`.
- Shared API error parsing: `lib/api-client-react/src/custom-fetch.ts`.
- Admin observability bootstrap and boundary usage: `apps/admin/src/main.tsx`, `apps/admin/src/App.tsx`.

## Inferred
- Observability is intended as frontend + backend coordinated flow with correlation-friendly behavior.

## Unclear
- Alerting/SLO ownership and coverage for non-admin surfaces.

## Do not break
- Do not reorder backend middleware in ways that disable observability handlers.
- Do not bypass shared frontend observability boundary in admin shell.
