# 06 — Authorization, Roles, and Access Model

## Scope
- This document defines architecture constraints for its domain using `docs/monorepo-overview.md` as baseline and concrete repository paths as evidence.

## Confirmed
- App authorization and auth-route gating now use one normalized profile resolver derived from `platform.apps` (`superadmin`, `solo`, `organization`) in `apps/api-server/src/lib/appAccessProfile.ts` and backend context assembly in `apps/api-server/src/lib/appAccess.ts`.
- Frontend auth route gating now consumes backend-derived `normalizedAccessProfile` metadata via `lib/frontend-security/src/index.tsx` instead of reinterpreting legacy raw fields.
- Admin frontend `/dashboard` routes are app-access gated (authenticated + app context) in `apps/admin/src/App.tsx`; superadmin-only enforcement is retained inside the superadmin dashboard surface (`apps/admin/src/pages/admin/AdminDashboard.tsx`) rather than as a blanket wrapper on all `/dashboard` paths.

- Authorization is middleware-driven in API routes:
  - `apps/api-server/src/middlewares/requireAuth.ts`
  - `apps/api-server/src/middlewares/requireOrgAccess.ts`
  - `apps/api-server/src/middlewares/requireAppAccess.ts`
  - `apps/api-server/src/middlewares/requireOrganizationAppSession.ts`
- App-level access logic is implemented in `apps/api-server/src/lib/appAccess.ts`.
- App-level access/onboarding is centered on `platform.apps.access_mode` (`superadmin`, `solo`, `organization`) with no `platform.apps.onboarding_mode` column (`apps/api-server/src/lib/appAccess.ts`, `apps/api-server/src/lib/appAccessProfile.ts`, `lib/db/src/schema/apps.ts`).
- Solo/direct access is granted through active `platform.user_app_access` rows, while organization access is granted through active membership (`platform.org_memberships`) + enabled org-app grant (`platform.org_app_access`) for the target app (`apps/api-server/src/lib/appAccess.ts`).
- Organization access still uses organization-creation onboarding when no eligible org membership+grant pair is available (`requiredOnboarding = "organization"`).
- Runtime organization onboarding/invitation routes now fail closed to organization-mode sessions only, which blocks superadmin and solo sessions from org creation and invitation acceptance APIs (`apps/api-server/src/routes/organizations.ts`, `apps/api-server/src/routes/invitations.ts`, `apps/api-server/src/middlewares/requireOrganizationAppSession.ts`).
- Organization invitation acceptance is a distinct flow and is only allowed when `platform.apps.staff_invites_enabled = true` for organization apps (`apps/api-server/src/routes/invitations.ts`, `apps/api-server/src/lib/appAccessProfile.ts`).
- Org-scoped access requires membership plus session-group compatibility; organization app equality is not enforced as a blanket rule across related apps in the same session group (`apps/api-server/src/lib/sessionGroupCompatibility.ts`, `apps/api-server/src/middlewares/requireOrgAccess.ts`).
- Organization customer self-registration backend flow is not yet implemented; auth-route policy now stays fail-closed for customer registration exposure (`apps/api-server/src/lib/appAccessProfile.ts`).
- `platform.apps.staff_invites_enabled` and `platform.apps.customer_registration_enabled` are organization-only capability switches; non-organization profiles always evaluate to `false` policy at runtime (`apps/api-server/src/lib/appAccessProfile.ts`).
- Route-level authz boundaries are applied during route registration in API route modules under `apps/api-server/src/routes/*`.
- Overview-defined non-negotiable: authorization remains middleware-driven (`requireAuth`, `requireOrgAccess`, `requireOrgAdmin`, `requireSuperAdmin`, `requireAppAccess`).

## Inferred
- Role/access checks are intentionally centralized at middleware boundaries instead of being spread ad hoc inside handlers.
- The model supports layered checks (authenticated user -> org-scoped access -> app-scoped access).
- Solo auto-self-onboarding, organization creation onboarding, staff invitation acceptance, and customer self-registration are intentionally separate policy decisions.

## Unclear
- Complete canonical role matrix and precedence definitions across all tenant/app contexts.
- Whether additional roles/policies are planned for placeholder apps.

## Do not break
- Do not replace middleware-based authorization with scattered inline handler checks.
- Do not remove or weaken org/app access middleware on protected routes.
- Do not introduce new protected routes without explicit `requireAuth` and relevant scope middleware.
- Do not diverge role semantics across routes without documenting the change in architecture docs.
- Do not reintroduce `platform.apps.onboarding_mode` semantics; keep organization invitation and customer registration controls on the organization-only boolean capability flags.
