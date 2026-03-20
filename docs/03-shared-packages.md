# 03 — Shared Packages / Libraries Inventory (DRAFT)

## Confirmed from code

### Active shared libs under `lib/`
- `lib/db` (`@workspace/db`)
  - Drizzle schema + postgres pool + exports.
  - Multi-schema model (`platform`, `shipibo`, `ayni`) and core tables for auth, orgs, memberships, app registry, subscriptions, invitations, audit logs, feature flags, sessions.
- `lib/api-spec` (`@workspace/api-spec`)
  - OpenAPI source and Orval codegen config.
- `lib/api-client-react` (`@workspace/api-client-react`)
  - Generated API hooks/schemas + `custom-fetch` with CSRF injection and structured API errors.
- `lib/api-zod` (`@workspace/api-zod`)
  - Generated API types/zod outputs.
- `lib/frontend-security` (`@workspace/frontend-security`)
  - `AuthProvider`, `RequireAuth`, CSRF bootstrap helper, org switching + invitation acceptance integration.
  - Turnstile hook and script bootstrap.
- `lib/frontend-observability` (`@workspace/frontend-observability`)
  - Frontend monitoring abstraction, error boundary, handled exception capture, backend ingest + direct Sentry envelope fallback.

### `packages/` workspace packages
- `packages/types` has active type definitions for app access context and tenancy/access enums.
- `packages/opentelemetry-instrumentation-http` provides a local stub module named `@opentelemetry/instrumentation-http` (no-op instrumentation class).
- `packages/auth`, `packages/config`, `packages/security`, `packages/ui` currently export empty modules/placeholders.

## Strong inference from code structure
- `lib/*` currently carries most operational shared logic, while `packages/*` may represent future stabilization/standardization targets.
- Shared-contract strategy is centered on OpenAPI -> generated client/schemas, reducing duplication across frontend/backend boundaries.
- Naming indicates intent to support additional apps with shared auth/security/observability modules.

## Unclear / requires confirmation
- Whether placeholders in `packages/*` are intentionally empty long-term or backlog items.
- Whether `packages/types` should supersede duplicated type intent elsewhere (e.g., DB enums/OpenAPI schemas).
- Whether local stub of `@opentelemetry/instrumentation-http` is temporary workaround or permanent compatibility layer.
