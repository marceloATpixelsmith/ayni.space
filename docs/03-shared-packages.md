# 03 — Shared Packages and Libraries

## Confirmed

### Active shared runtime libraries (`lib/*`)
- `lib/db` (`@workspace/db`) is the active shared database layer used by API and scripts. It exposes DB client/pool and schema/migrations under `lib/db/src/index.ts`, `lib/db/src/schema/*.ts`, and `lib/db/migrations/*.sql`.
- `lib/api-client-react` (`@workspace/api-client-react`) is the active frontend API client/hooks layer used by `apps/admin` and `lib/frontend-security`.
- `lib/api-zod` (`@workspace/api-zod`) is a shared schema/types layer with narrow active usage (notably API health route parsing).
- `lib/frontend-security` (`@workspace/frontend-security`) is the active frontend auth/security layer used by admin app shell/routes.
- `lib/frontend-observability` (`@workspace/frontend-observability`) is the active frontend monitoring layer used by `apps/admin` and wired in `apps/mockup-sandbox`.
- `lib/api-spec` (`@workspace/api-spec`) is build-time contract/codegen source (OpenAPI + Orval), not a runtime app import target.

### Workspace `packages/*` status
- `packages/opentelemetry-instrumentation-http` provides local `@opentelemetry/instrumentation-http` package content and is declared by `apps/api-server`.
- `packages/types` exports concrete types but has no imports across `apps/`, `lib/`, or `scripts/`.
- `packages/auth`, `packages/config`, `packages/security`, and `packages/ui` currently export placeholders and have no runtime consumers.

### Dependency flow (as implemented)
- `apps/api-server` consumes `@workspace/db` and `@workspace/api-zod`.
- `apps/admin` consumes `@workspace/api-client-react`, `@workspace/frontend-security`, and `@workspace/frontend-observability`.
- `scripts` consumes `@workspace/db`.
- `lib/frontend-security` consumes `@workspace/api-client-react`.

## Inferred
- `lib/*` is the operational shared layer today; `packages/*` is largely dormant except for the instrumentation package.
- The repository currently mixes two sharing models (`lib/*` and `packages/*`) without strict enforcement boundaries.

## Unclear
- Whether dormant `packages/*` should be activated, consolidated into `lib/*`, or removed.
- Whether `@workspace/types` should become active shared contract surface or remain dormant.
- Whether `packages/opentelemetry-instrumentation-http` is a temporary stub or long-term local replacement.

## Do not break
- Do not move active shared runtime code out of `lib/*` without coordinated updates to all current consumers.
- Do not assume dormant `packages/*` are production-ready; treat them as inactive unless explicitly wired.
- Do not bypass `@workspace/db` with ad-hoc DB clients in apps/scripts.
- Do not break OpenAPI/codegen flow rooted in `lib/api-spec` and consumed via generated outputs.
