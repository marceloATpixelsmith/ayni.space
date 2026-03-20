# 16 — File and Folder Ownership

## Scope
- This document defines architecture constraints for its domain using `docs/01-monorepo-overview.md` as baseline and concrete repository paths as evidence.

## Confirmed

### Active application ownership
- `apps/api-server/**`: backend runtime ownership (entrypoint, middleware stack, routes, auth/authz/tenant enforcement).
- `apps/admin/**`: primary frontend shell ownership (routing/UI shell using shared security and observability libs).
- `apps/mockup-sandbox/**`: partial/prototype frontend ownership (currently not integrated into root scripts/CI).
- `apps/ayni/**`, `apps/shipibo/**`, `apps/screening/**`: placeholder namespaces only (`.gitkeep`).

### Shared library ownership
- `lib/db/**`: shared DB schema/client/migrations used by API and scripts.
- `lib/api-spec/**`: API contract source and codegen configuration.
- `lib/api-client-react/**`: generated/shared API client and fetch behavior.
- `lib/api-zod/**`: generated/shared zod/types output layer.
- `lib/frontend-security/**`: shared frontend auth/security provider + helpers.
- `lib/frontend-observability/**`: shared frontend monitoring/error capture layer.

### Package ownership status
- `packages/opentelemetry-instrumentation-http/**`: local package implementation consumed as dependency by API app.
- `packages/auth/**`, `packages/config/**`, `packages/security/**`, `packages/types/**`, `packages/ui/**`: present but not active runtime ownership surfaces.

### Workflow/operational ownership
- `.github/workflows/lockfile-sync-check.yml`: lockfile governance.
- `.github/workflows/admin-security-shell-test-and-deploy.yml`: admin shell test + deploy flow.
- `.github/workflows/codex-auto-promote.yml`: codex promotion workflow.

## Inferred
- Ownership is currently code-centric and practical (active usage), not fully formalized by CODEOWNERS or explicit policy files.
- `lib/*` carries most shared ownership burden; `packages/*` ownership remains mostly reserved/inactive.

## Unclear
- Final intended ownership boundaries for placeholder apps and dormant packages.
- Whether `lib/integrations/*` should become an owned directory or be removed from workspace scope.

## Do not break
- Do not treat placeholder app folders as active product surfaces.
- Do not move active shared modules without updating every known consumer path.
- Do not blur backend ownership by introducing parallel API runtimes outside `apps/api-server`.
- Do not assume dormant `packages/*` are maintained as production-critical surfaces.
