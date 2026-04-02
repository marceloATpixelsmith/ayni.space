# 06 — Authorization, Roles, and Access Model

## Scope
- This document defines architecture constraints for its domain using `docs/monorepo-overview.md` as baseline and concrete repository paths as evidence.

## Confirmed
- App authorization and auth-route gating now use one normalized profile resolver derived from `platform.apps` (`superadmin`, `solo`, `organization`) in `apps/api-server/src/lib/appAccessProfile.ts` and backend context assembly in `apps/api-server/src/lib/appAccess.ts`.
- Frontend auth route gating now consumes backend-derived `normalizedAccessProfile` metadata via `lib/frontend-security/src/index.tsx` instead of reinterpreting legacy raw fields.

- Authorization is middleware-driven in API routes:
  - `apps/api-server/src/middlewares/requireAuth.ts`
  - `apps/api-server/src/middlewares/requireOrgAccess.ts`
  - `apps/api-server/src/middlewares/requireAppAccess.ts`
- App-level access logic is implemented in `apps/api-server/src/lib/appAccess.ts`.
- App-level onboarding configuration for `platform.apps.onboarding_mode` is boolean and only applies to `access_mode = "solo"` in app access context (`apps/api-server/src/lib/appAccess.ts`, `apps/api-server/src/lib/appAccessProfile.ts`, `lib/db/src/schema/apps.ts`).
- Organization app access onboarding remains membership/access based (`requiredOnboarding = "organization"`) and does not use `platform.apps.onboarding_mode` (`apps/api-server/src/lib/appAccess.ts`).
- Organization invitation acceptance is a separate membership flow in `apps/api-server/src/routes/invitations.ts` and is controlled by org membership/invitation status, not by solo onboarding booleans.
- Route-level authz boundaries are applied during route registration in API route modules under `apps/api-server/src/routes/*`.
- Overview-defined non-negotiable: authorization remains middleware-driven (`requireAuth`, `requireOrgAccess`, `requireOrgAdmin`, `requireSuperAdmin`, `requireAppAccess`).

## Inferred
- Role/access checks are intentionally centralized at middleware boundaries instead of being spread ad hoc inside handlers.
- The model supports layered checks (authenticated user -> org-scoped access -> app-scoped access).
- App-level solo onboarding and organization membership onboarding are intentionally separate decisions in app context evaluation.

## Unclear
- Complete canonical role matrix and precedence definitions across all tenant/app contexts.
- Whether additional roles/policies are planned for placeholder apps.

## Do not break
- Do not replace middleware-based authorization with scattered inline handler checks.
- Do not remove or weaken org/app access middleware on protected routes.
- Do not introduce new protected routes without explicit `requireAuth` and relevant scope middleware.
- Do not diverge role semantics across routes without documenting the change in architecture docs.
- Do not couple organization invitation/customer registration flows to `platform.apps.onboarding_mode` without explicit architecture change.
