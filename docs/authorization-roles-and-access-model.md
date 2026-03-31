# 06 — Authorization, Roles, and Access Model

## Scope
- This document defines architecture constraints for its domain using `docs/monorepo-overview.md` as baseline and concrete repository paths as evidence.

## Confirmed
- App authorization source of truth is `platform.apps.access_mode` with only three valid values: `superadmin`, `solo`, `organization`; optional onboarding behavior is read from `platform.apps.onboarding_mode` only for `solo` flows (`apps/api-server/src/lib/appAccessProfile.ts`, `apps/api-server/src/lib/appAccess.ts`, `lib/db/src/schema/apps.ts`).
- Frontend auth route gating now consumes backend-derived `normalizedAccessProfile` metadata via `lib/frontend-security/src/index.tsx` instead of reinterpreting legacy raw fields.

- Authorization is middleware-driven in API routes:
  - `apps/api-server/src/middlewares/requireAuth.ts`
  - `apps/api-server/src/middlewares/requireOrgAccess.ts`
  - `apps/api-server/src/middlewares/requireAppAccess.ts`
- App-level access logic is implemented in `apps/api-server/src/lib/appAccess.ts`.
- Route-level authz boundaries are applied during route registration in API route modules under `apps/api-server/src/routes/*`.
- Overview-defined non-negotiable: authorization remains middleware-driven (`requireAuth`, `requireOrgAccess`, `requireOrgAdmin`, `requireSuperAdmin`, `requireAppAccess`).

## Inferred
- Role/access checks are intentionally centralized at middleware boundaries instead of being spread ad hoc inside handlers.
- The model supports layered checks (authenticated user -> org-scoped access -> app-scoped access).

## Unclear
- Complete canonical role matrix and precedence definitions across all tenant/app contexts.
- Whether additional roles/policies are planned for placeholder apps.

## Do not break
- Do not replace middleware-based authorization with scattered inline handler checks.
- Do not remove or weaken org/app access middleware on protected routes.
- Do not introduce new protected routes without explicit `requireAuth` and relevant scope middleware.
- Do not diverge role semantics across routes without documenting the change in architecture docs.
