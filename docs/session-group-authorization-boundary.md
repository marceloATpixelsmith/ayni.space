# Session Group Authorization Boundary

## Scope
- Defines the authorization boundary between related apps and isolated apps.
- Clarifies session-group compatibility requirements for org routes, invitations, and active-org switching.

## Confirmed
- Session group is the portability boundary for authenticated continuity: apps in the same session group may share identity continuity; apps in different session groups are isolated.
- `platform.organizations.app_id` remains the authoritative app binding for org-scoped resources, and invitation writes must inherit that org-bound app id.
- Request authorization for org-scoped resources now requires both:
  1. active org membership/role checks, and
  2. session-group compatibility between current session and the org's bound app.
- Session-group compatibility resolution is centralized in `apps/api-server/src/lib/sessionGroupCompatibility.ts` and consumed by org access middleware/routes.
- Active-org switching (`POST /api/users/me/switch-org`) now denies cross-session-group targets even when membership exists.
- Invitation creation now fails closed unless org/app context is resolvable, and invitation `appId` is derived from the target organization rather than hard-coded.
- `GET /api/organizations` and `/api/auth/me` now scope memberships/org visibility to the current session group.
- Superadmin remains an explicit route-level privilege boundary (`/api/admin/*` and explicitly classified privileged routes).

## Route classification summary
- **A. superadmin-only**: `/api/admin/*`, `/api/users/:id/suspend`, `/api/users/:id/unsuspend`.
- **B. authenticated + membership only**: none for org-scoped reads/writes (membership alone is insufficient).
- **C. authenticated + membership + session-group compatibility**:
  - `/api/organizations`
  - `/api/organizations/:orgId`
  - `/api/organizations/:orgId/members*`
  - `/api/organizations/:orgId/invitations*`
  - `/api/users/me/switch-org`
  - `/api/auth/me` org membership payload
- **D. intentionally cross-group visible**: none by default for org/member/invitation payloads.

## Auth intent status
- OAuth `intent` input is accepted by client requests but is currently not used in callback redirect decisions.
- Dead callback-session `oauthIntent` plumbing has been removed so runtime behavior and implementation match.

## Customer registration status
- Customer self-registration capability flags remain in app metadata/schema for future rollout planning.
- No dedicated backend customer-registration endpoint is currently implemented.
- Runtime auth route policy now fails closed (`allowCustomerRegistration=false`) until backend flow exists.

## Origin/referer policy
- Unsafe methods with both `Origin` and `Referer` missing are denied by default.
- Explicit machine exception is limited to Stripe webhook (`POST /api/billing/webhook`) to preserve required server-to-server behavior.

## Do not break
- Do not reintroduce strict app-id equality as a blanket authorization rule for org resources.
- Do not bypass centralized session-group compatibility checks for org/member/invitation/switch-org flows.
- Do not reintroduce hard-coded invitation app ids.
- Do not open unsafe missing-origin/referer handling for browser-facing mutation routes.
