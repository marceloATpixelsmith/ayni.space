# System Baseline Audit — Apps, Auth, and App Context Consumers

## Scope
- Lock the current implemented baseline for:
  - `platform.apps` field behavior,
  - auth/session/access/onboarding/invitation behavior,
  - all current app-context consumers across backend and frontend surfaces.
- This is an implementation audit only (no intended/future-state assertions).

## Confirmed

### 1) `platform.apps` audit: fields and what they currently drive
Source schema: `lib/db/src/schema/apps.ts`.

| Field | Current runtime usage | What it drives today |
|---|---|---|
| `id` | Joined against org access, plans, subscriptions, invitations/email context | Core relational identity for app access and app-scoped operations |
| `name` | App list formatting and email template context (`app_name`) | UI app labeling + transactional template context |
| `slug` | App lookup (`getAppBySlug`), app context resolution, frontend app selection | Auth routing context, per-app access checks, frontend app metadata binding |
| `description` | Returned by `/api/apps` formatter | App catalog display metadata |
| `iconUrl` | Returned by `/api/apps` formatter | App catalog display metadata |
| `accessMode` (`superadmin`/`solo`/`organization`) | Normalized via `resolveNormalizedAccessProfile` | Primary auth/access profile, auth-route policy shape, onboarding branch logic |
| `staffInvitesEnabled` | Evaluated for organization-mode invitation endpoints and auth-route policy | Enables/disables org staff invitation flows |
| `customerRegistrationEnabled` | Evaluated in organization-mode access fallback path | Allows organization apps to grant provisional access without org membership (user onboarding path) |
| `transactionalFromEmail` | Required by lane1 send path before email dispatch | Hard requirement for invitation/verify/reset email sending |
| `transactionalFromName` | Optional lane1 sender display value | Outbound sender display name |
| `transactionalReplyToEmail` | Optional lane1 reply-to value | Outbound reply-to behavior |
| `invitationEmailSubject` | No active reads in current backend implementation | Currently does not drive runtime behavior |
| `invitationEmailHtml` | No active reads in current backend implementation | Currently does not drive runtime behavior |
| `isActive` | Applied in app lookup/list and email app context lookup | App availability filter for access/auth/email context |
| `metadata` | Persisted field, no active reads in app-access/auth routing paths | Currently inert for auth/routing/onboarding/UI decisions |
| `createdAt` | Stored only | Audit timestamp only |
| `updatedAt` | Stored + auto-updated | Audit timestamp only |

### 2) Auth + access system audit

#### Session model (implemented)
- Sessions are persisted in `platform.sessions` using `connect-pg-simple` with migration-managed table creation (`createTableIfMissing=false`).
- Session cookies are group-specific; session IDs are namespaced as `<sessionGroup>.<uuid>`.
- Session group is resolved per request via trusted context (`origin`/`referer`/state/cookie/appSlug fallback), and ambiguous resolution fails closed.
- Idle timeout, absolute timeout, cookie same-site/domain, and prune intervals are policy-driven via env-backed helpers in `lib/session.ts`.
- `logout-others` revokes sessions within the current group; password reset revokes all other sessions across groups.

#### MFA behavior (implemented)
- MFA is TOTP + recovery-code based, with encrypted secrets and replay-step protection.
- MFA requirement decision currently resolves true when any of these are true:
  - user is superadmin,
  - user security row marks MFA required / force enrollment,
  - user has active org membership role `org_owner` or `org_admin`.
- Trusted-device cookies (20-day TTL) can satisfy challenge bypass when allowed.
- Pending-MFA sessions are explicit (`pendingUserId`, `pendingMfaReason`, `nextStep` flows) and are blocked from protected routes except compatible `/auth/me` bootstrap behavior.

#### App access resolution (implemented)
- `getAppContext(userId, appSlug)` is the core resolver.
- Resolution sequence:
  1. app must exist and be active,
  2. app access mode is normalized (`superadmin`/`solo`/`organization`),
  3. user must exist and be active/non-suspended/non-deleted,
  4. profile-specific access logic applies:
     - `superadmin`: only `users.is_super_admin=true`,
     - `solo`: access granted directly,
     - `organization`: requires active org membership + org-app eligibility (or direct `user_app_access`), with registration fallback rules.

#### Onboarding gating (implemented)
- `requiredOnboarding` is computed in app context and can be:
  - `organization`: org-mode app, no access path, and customer registration is off,
  - `user`: user name missing in otherwise-allowed flows (or registration fallback path),
  - `none`: no onboarding gate.
- Default route is forced to `/onboarding/organization` or `/onboarding/user` when onboarding is required.

#### Invitation handling (implemented)
- Staff invitation flows are organization-mode only and additionally gated by `staffInvitesEnabled`.
- Invitation resolve endpoint returns contract-safe state (`pending`/`invalid`/`expired`/`accepted`) and email mode (`create_password`/`sign_in`).
- Invitation acceptance can establish authenticated session or MFA-pending session, then routes via shared post-auth destination logic.

### 3) Consumers of app context

#### `apps/api-server` (auth + routing)
- App context resolution and enforcement:
  - `apps/api-server/src/lib/appAccess.ts`
  - `apps/api-server/src/middlewares/requireAppAccess.ts`
  - `apps/api-server/src/routes/apps.ts` (`/apps/slug/:appSlug/context`)
- Auth/session payload consumption:
  - `apps/api-server/src/routes/auth.ts` (`/api/auth/me` appAccess payload + post-auth decisions)
- Route-level app gating:
  - `apps/api-server/src/routes/ayni.ts`
  - `apps/api-server/src/routes/shipibo.ts`

#### `lib/frontend-security`
- Reads app metadata (`/api/apps`) and normalizes `slug`, `normalizedAccessProfile`, `authRoutePolicy`.
- Uses app-access payload on authenticated user (`user.appAccess`) to decide:
  - onboarding redirects,
  - superadmin route behavior,
  - post-auth destination selection.

#### `apps/admin`
- Uses `useCurrentPlatformAppMetadata()` and user `appAccess` snapshot for route guards.
- Enforces onboarding redirects and superadmin denial behavior in `App.tsx` shell routing.
- Login/signup composition consumes shared auth-route policy from frontend-security.

### 4) Current limitations, inconsistencies, and drift
- `platform.apps.invitation_email_subject` and `platform.apps.invitation_email_html` exist in schema but are not read by the current lane1 email send implementation (template system is sourced elsewhere).
- `platform.apps.metadata` exists but does not currently influence auth/access/routing/onboarding.
- Frontend app metadata resolution currently fetches from `/api/apps` (list scan by slug), while backend also exposes `/api/apps/slug/:appSlug/context`; these are parallel context surfaces with different payload depth.
- In organization profile, `customerRegistrationEnabled` can set `canAccess=true` before org membership exists, which means onboarding gates can apply even when access is logically granted.
- `requireAppAccess` middleware is applied on selected app routes (`ayni`, `shipibo`) but not globally across every API route; enforcement remains route-registration dependent.

## Inferred
- `platform.apps` has both active control-plane fields (access/profile/invite capability/email sender) and currently inert legacy/future-facing fields (`metadata`, invitation HTML/subject overrides).
- App-context decisions are backend-authoritative, but frontend consumes two separate backend surfaces (app metadata list + `/auth/me` `appAccess`) that must stay contract-aligned.

## Unclear
- Whether `invitation_email_subject`/`invitation_email_html` are intended to be reactivated or removed in a later schema cleanup.
- Whether frontend should standardize on one app-context endpoint (`/api/apps` vs `/api/apps/slug/:appSlug/context`) for metadata reads.

## Do not break
- Do not change `accessMode` normalization semantics without updating all auth/access consumers.
- Do not bypass `getAppContext`/`requireAppAccess` in protected app routes.
- Do not introduce frontend app-context interpretation that diverges from backend `appAccess` payload semantics.
- Do not modify invitation/onboarding gating behavior without explicit cross-layer updates (API + frontend-security + admin route guards).
