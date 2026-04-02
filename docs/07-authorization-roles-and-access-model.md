# 06 — Authorization, Roles, and Access Model

## Scope
- This document defines architecture constraints for its domain using `docs/monorepo-overview.md` as baseline and concrete repository paths as evidence.

## Confirmed
- App authorization and auth-route gating use one normalized profile resolver derived from `platform.apps.access_mode` (`superadmin`, `solo`, `organization`) in `apps/api-server/src/lib/appAccessProfile.ts` and `apps/api-server/src/lib/appAccess.ts`.
- `platform.apps.onboarding_mode` is removed from live runtime/schema semantics; onboarding requirement is represented by `requiredOnboarding` (`none` | `organization`) and organization capability flags in `platform.apps` (`staff_invites_enabled`, `customer_registration_enabled`).
- Authorization is middleware-driven in API routes:
  - `apps/api-server/src/middlewares/requireAuth.ts`
  - `apps/api-server/src/middlewares/requireOrgAccess.ts`
  - `apps/api-server/src/middlewares/requireAppAccess.ts`
  - `apps/api-server/src/middlewares/requireOrganizationAppSession.ts`
- App-level access logic is implemented in `apps/api-server/src/lib/appAccess.ts`.
- Solo access is auto-self-onboarded (no onboarding route requirement), while organization access uses organization-creation onboarding when membership/access is missing (`requiredOnboarding = "organization"`).
- Organization onboarding and invitation acceptance APIs fail closed to organization app sessions (`apps/api-server/src/routes/organizations.ts`, `apps/api-server/src/routes/invitations.ts`).
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
- Do not reintroduce `platform.apps.onboarding_mode` or legacy access/tenancy mapping logic.
