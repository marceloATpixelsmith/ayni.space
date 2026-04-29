# System Baseline Audit — Apps, Auth, Routing, Onboarding, and Invitation Truth Map

## Scope
- Freeze **implemented** system truth for Phase 0 across:
  - `platform.apps` field semantics and consumers,
  - auth/session/onboarding/invitation runtime behavior,
  - app-context + app-metadata consumers in `apps/api-server`, `lib/frontend-security`, and `apps/admin`.
- This file documents **actual code behavior** and explicit drift. Intended behavior is only mentioned as contrast.

## Confirmed

### 1) Full `platform.apps` field audit (schema + every runtime read path)
Schema source: `lib/db/src/schema/apps.ts`.

| Field | Schema/default | Runtime read locations (exhaustive in current app/auth surfaces) | Behavior driven | Enforcement status | Frontend/backend consistency |
|---|---|---|---|---|---|
| `id` | `text` PK, required | `appAccess.ts` (`user_app_access`, `org_app_access` joins), `routes/apps.ts` (`/apps/:id`, org app list joins), `routes/invitations.ts` (invitation app checks), `routes/organizations.ts` (org listing compatibility fetch), `invitationEmail.ts` (app lookup for sender/template context), `routes/admin.ts` (email template management by app) | Identity for app context, access joins, invitation app binding, org app compatibility, template/sender lookup | **Enforced** where needed for joins/lookups | **Consistent** |
| `name` | `text`, required | `routes/apps.ts` response formatter, `routes/subscriptions.ts`, `invitationEmail.ts` template context (`app_name`), `routes/admin.ts` app descriptor in template endpoint | UI naming + email template context | **Enforced** for display/context only | **Consistent** |
| `slug` | `text`, unique, required | `appAccess.ts` (`getAppBySlug`, active lookup), `routes/auth.ts` (active app resolution, OAuth state/app resolution), `routes/invitations.ts` (`getOrganizationAppContextForSession`), `routes/organizations.ts` (session app lookup), `sessionGroupCompatibility.ts` fallback (`admin` slug -> admin group), `routes/apps.ts` payload, frontend metadata fetch scans `/api/apps` by `slug` (`useCurrentPlatformAppMetadata`) | App selection/routing context, OAuth app binding, session-group fallback, frontend route policy context | **Partially enforced** (backend enforces slug lookup; frontend depends on `VITE_APP_SLUG` + list scan) | **Partially consistent** (same slug semantics, different resolution mechanisms) |
| `description` | `text`, nullable | `routes/apps.ts` only | App catalog metadata only | **Ignored for auth/access** | **Consistent** |
| `iconUrl` | `text`, nullable | `routes/apps.ts` only | App catalog metadata only | **Ignored for auth/access** | **Consistent** |
| `accessMode` | enum `app_access_mode`, default `organization` | `appAccessProfile.ts` normalization; `appAccess.ts` access branch logic; `routes/auth.ts` signup eligibility gate + OAuth flow decisions; `routes/invitations.ts` organization-flow checks (`accessMode === organization`); `routes/apps.ts` returns value; frontend consumes only normalized derivative (`normalizedAccessProfile`) via `/api/apps` and `user.appAccess` | Core authorization/onboarding profile (`superadmin`/`solo`/`organization`) | **Enforced** in backend decisions; frontend uses backend-derived profile | **Mostly consistent** |
| `staffInvitesEnabled` | `boolean`, default `false` | `appAccess.ts` -> `authRoutePolicy.allowInvitations`; `appAccessProfile.ts`; `routes/invitations.ts` guards for list/create/cancel/resend/accept; `routes/apps.ts` payload; `routes/auth.ts` trace logging only | Enables/disables organization staff invitation flows + auth-route invitation policy | **Partially enforced** (API enforcement strong; frontend route gating depends on metadata fetch success) | **Mostly consistent** |
| `customerRegistrationEnabled` | `boolean`, default `false` | `appAccess.ts` registration fallback (`canAccess=true` without org when enabled), `appAccessProfile.ts` organization policy input, `routes/auth.ts` signup allowed/blocked logic, `routes/apps.ts` payload, trace logging in auth | Controls org-app password signup admission + fallback access/onboarding branch | **Inconsistent** (backend grants `canAccess` + `requiredOnboarding=user`; frontend policy currently fail-closed for customer-registration routes) | **Inconsistent** |
| `transactionalFromEmail` | `text`, nullable | `invitationEmail.ts` hard requirement in lane1 sender (`Missing ... configuration` if null) | Required sender for invitation/verification/password-reset lane1 email sends | **Enforced** at send-time, not schema-level | **Backend-only concern** |
| `transactionalFromName` | `text`, nullable | `invitationEmail.ts` optional sender display name | Outbound sender name | **Partially enforced** (optional fallback) | **Backend-only concern** |
| `transactionalReplyToEmail` | `text`, nullable | `invitationEmail.ts` optional reply-to | Outbound reply-to header | **Partially enforced** (optional fallback) | **Backend-only concern** |
| `invitationEmailSubject` | `text`, nullable | No runtime reads in active send path; only appears in tests/mocked app rows | None in current implementation (legacy column) | **Ignored** | **N/A (not consumed by frontend/back)** |
| `invitationEmailHtml` | `text`, nullable | No runtime reads in active send path; only appears in tests/mocked app rows | None in current implementation (legacy column) | **Ignored** | **N/A** |
| `isActive` | `boolean`, default `true` | `appAccess.ts` active lookup filter; `routes/apps.ts` list filter; `sessionGroupCompatibility.ts`, `routes/invitations.ts`, `invitationEmail.ts`, `routes/auth.ts` app context lookups; many app/org compatibility checks | Global active-app gating for auth, org compatibility, email sends, app catalog | **Enforced** broadly | **Consistent** |
| `metadata` | `jsonb`, default `{}` | `sessionGroupCompatibility.ts` reads `metadata.sessionGroup`; `routes/organizations.ts` passes metadata into compatibility resolver; `routes/auth.ts` includes in org membership app listings; otherwise ignored for auth route policy/onboarding/invite | Optional session-group override for app compatibility; no broader metadata-driven routing | **Partially enforced** (single metadata key recognized) | **Inconsistent/partial** (frontend does not consume metadata; backend consumes narrow subset) |
| `createdAt` | timestamp tz, default now | Persistence/audit only | None | **Ignored for behavior** | **Consistent** |
| `updatedAt` | timestamp tz, default now, on update | Persistence/audit only | None | **Ignored for behavior** | **Consistent** |

#### Field-level drift notes
- `customerRegistrationEnabled` is functionally active in backend access decisions but not reflected in frontend `deriveAppAuthRoutePolicy()` fallback semantics for customer-registration route affordances, increasing split-source-of-truth risk.
- `invitationEmailSubject`/`invitationEmailHtml` are schema-present but superseded by `platform.email_templates` resolution in `resolveEmailTemplate()` + lane1 send path.
- `metadata` is used for `sessionGroup` only; no generic metadata contract exists between backend and frontend.

---

### 2) Real auth flow truth map (by user type)

#### 2.1 Superadmin (admin app)
- **Entry routes/pages**: `/login` (password/google), `/api/auth/login`, `/api/auth/google/url`, `/api/auth/google/callback`.
- **Session creation/regeneration points**:
  - password: `beginMfaPendingSession()` and `establishPasswordSession()` in `apps/api-server/src/routes/auth.ts`.
  - OAuth: Google callback flow calls `req.session.regenerate(...)` before user binding in `handleGoogleCallback`.
- **Email verification timing**: password login blocks until `emailVerifiedAt` exists; Google-created users are set `emailVerifiedAt=now` at create.
- **MFA timing**: `isMfaRequiredForUser()` forces MFA for `users.isSuperAdmin=true`; pending session is established by `beginMfaPendingSession()` until `completePendingMfaSession()`.
- **Trusted device**: trusted cookie bypasses challenge in `beginMfaPendingSession()` when valid.
- **Onboarding trigger**: none (superadmin profile maps required onboarding to `none`).
- **Invitation continuation**: generally not relevant; continuation path still parsed if provided.
- **Final destination**: `/dashboard` if true superadmin, else `/login?error=access_denied`, via `resolveAuthenticatedPostAuthDestination()` and `getAccessDeniedRedirect()`.
- **EXPECTED**: strict superadmin-only access.
- **ACTUAL**: strict check enforced in backend flow + frontend route guard.
- **MISMATCH / DRIFT**: none observed for implicit admin fallback in auth entry. Current implementation resolves app context via explicit appSlug/origin/session-group precedence, requires canonical app lookup, and fails closed with typed `400` auth codes (`app_slug_missing`, `app_not_found`) when unresolved. Admin OAuth hardening in this surface requires explicit admin `appSlug` where policy-enforced, valid explicit admin `appSlug` continues to succeed, and non-admin flows are not treated as inheriting that same explicit-admin requirement.

#### 2.2 Organization admin (org_owner/org_admin in organization app)
- **Entry routes/pages**: `/login`, OAuth flow, invitation accept route, onboarding routes.
- **Backend endpoints**: `/api/auth/login`, `/api/auth/google/*`, `/api/auth/me`, `/api/auth/post-onboarding/next-path`, org/invite APIs.
- **Session points**: same as above; plus `router.post("/switch-org", requireAuth, ...)` in `apps/api-server/src/routes/users.ts` updates `req.session.activeOrgId`.
- **Email verification**: required for password login unless verified via `/api/auth/verify-email`.
- **MFA timing**: role-based MFA required by `isMfaRequiredForUser()` membership-role checks in `apps/api-server/src/lib/mfa.ts`.
- **Trusted device**: same bypass behavior.
- **Onboarding trigger**: `requiredOnboarding` from `getAppContext()` (`apps/api-server/src/lib/appAccess.ts`) and applied by `resolveAuthenticatedPostAuthDestination()` (`apps/api-server/src/lib/postAuthDestination.ts`) plus frontend `resolveAuthenticatedNextStep()` (`lib/frontend-security/src/index.tsx`).
- **Invitation continuation**: invitation pages set continuation path `/invitations/:token/accept`; backend stores pending continuation through MFA.
- **Final destination**: precedence from `resolveAuthenticatedPostAuthDestination()` and `resolveNextPathForEstablishedSession()`: onboarding (`post_auth`) > continuation > flow destination > `/dashboard`.
- **EXPECTED**: org leaders challenged for MFA, then onboarding/continuation.
- **ACTUAL**: implemented as expected.
- **MISMATCH / DRIFT**: `requiredOnboarding=organization` is treated specially (`canAccess=false` but still routed to onboarding), creating subtle “deny-but-onboard” dual semantics.

#### 2.3 Invited user (staff invite)
- **Entry routes/pages**: `/invitations/:token/accept` (pre-auth allowed), optional Google start from invitation page, optional password bootstrap via `accept-email`.
- **Backend endpoints**: `GET /api/invitations/:token/resolve`, `POST /api/invitations/:token/accept-email`, `POST /api/invitations/:token/accept`.
- **Session points**:
  - `router.post("/:token/accept-email", ...)` in `apps/api-server/src/routes/invitations.ts`: creates credential and then uses `beginInvitationMfaPendingSession()` / `establishInvitationSession()`.
  - `router.post("/:token/accept", requireAuth, requireOrganizationAppSession, ...)` requires an authenticated org-app-compatible session.
- **Email verification timing**: `accept-email` auto-creates user with `emailVerifiedAt` set; no extra verify step.
- **MFA timing**: invite acceptance password path runs `beginInvitationMfaPendingSession()` and finalizes with `/api/auth/mfa/*` completion (`completePendingMfaSession()` in `apps/api-server/src/routes/auth.ts`).
- **Trusted device**: checked during invitation MFA gating.
- **Onboarding trigger**: post-accept destination computed by `resolvePostAuthFlowDecision()` (`apps/api-server/src/lib/postAuthFlow.ts`) + `resolveAuthenticatedPostAuthDestination()` (`apps/api-server/src/lib/postAuthDestination.ts`).
- **Invitation continuation**: preserved via return path `/invitations/:token/accept` through login/OAuth/MFA.
- **Final destination**: post-accept computed nextPath or `/dashboard` fallback.
- **EXPECTED**: invite-specific continuation survives OAuth/password/MFA.
- **ACTUAL**: continuation is passed and persisted in both frontend and backend pending session state.
- **MISMATCH / DRIFT**: `POST /api/invitations/:token/accept` requires `requireOrganizationAppSession`; invite token alone is insufficient unless session app slug is organization-profile compatible.

#### 2.4 Solo user
- **Entry routes/pages**: `/login`, `/signup`, OAuth routes.
- **Backend endpoints**: same auth endpoints.
- **Session points**: same regeneration patterns.
- **Email verification**: required for password login.
- **MFA timing**: only if user security flags/step-up demand it (not by role).
- **Trusted device**: supported.
- **Onboarding trigger**: `requiredOnboarding="user"` from `getAppContext()` when `users.name` is missing.
- **Invitation continuation**: not typically used.
- **Final destination**: `/onboarding/user` or continuation/default.
- **EXPECTED**: direct access + optional user onboarding.
- **ACTUAL**: `getAppContext()` sets `canAccess=true` for solo and user-onboarding when name missing.
- **MISMATCH / DRIFT**: frontend fallback policy now allows solo onboarding, but customer-registration affordances remain fail-closed when backend metadata policy is missing, so profile parity still depends on metadata delivery.

#### 2.5 Client / participant / registration user
- **Entry routes/pages**: no dedicated frontend route implemented in `apps/admin` for customer registration.
- **Backend signals**: continuation parser `resolvePostAuthContinuation()` in `apps/api-server/src/lib/postAuthContinuation.ts` supports `client_registration` and `event_registration` path typing.
- **Session points**: continuation can be stored and used in destination resolver.
- **Email verification/MFA**: same generic auth logic.
- **Onboarding trigger**: only generic `requiredOnboarding` states.
- **Final destination**: continuation path if supplied and valid.
- **EXPECTED**: metadata/policy-driven client registration flow.
- **ACTUAL**: continuation type exists, but full customer registration route model is not implemented end-to-end.
- **MISMATCH / DRIFT**: customer registration capability flag exists (`customerRegistrationEnabled`) without corresponding frontend route/policy surface.

---

### 3) Invitation / OAuth / MFA edge case verification matrix

| Edge case | Exact code path(s) | Status | Actual behavior + failure mode |
|---|---|---|---|
| Invitation accept continuation | `apps/admin/src/pages/auth/InvitationAccept.tsx` (`continuationPath`, `auth.loginWithGoogle(...)`), `apps/admin/src/pages/auth/Login.tsx` (`next` param forwarding), `lib/frontend-security/src/index.tsx` (`loginWithGoogle`, `loginWithPassword`), backend `apps/api-server/src/lib/postAuthContinuation.ts` (`resolvePostAuthContinuation`), `apps/api-server/src/routes/auth.ts` (`resolveNextPathForEstablishedSession`) | **PARTIAL** | Continuation is preserved across password/OAuth/MFA. Constraint: final invitation acceptance write (`POST /api/invitations/:token/accept`) is guarded by `requireAuth` + `requireOrganizationAppSession` in `apps/api-server/src/routes/invitations.ts`. |
| Login page `next` param handling | `apps/admin/src/pages/auth/Login.tsx` (`query.get("next")`, `auth.loginWithPassword`, `auth.loginWithGoogle`) + `lib/frontend-security/src/index.tsx` (`normalizeReturnToPath`, `resolveAuthenticatedNextStep`) | **CORRECT** | Open redirects are blocked because continuation normalization allows only root-relative paths and rejects `//` prefixes. |
| OAuth start/callback continuation preservation | `apps/api-server/src/routes/auth.ts` (`router.post("/google/url", ...)`, `parseOAuthState`, `handleGoogleCallback`) + `apps/api-server/src/lib/postAuthContinuation.ts` (`resolvePostAuthContinuation`) + `apps/api-server/src/routes/auth.ts` (`resolveNextPathForEstablishedSession`) | **CORRECT** | `returnToPath` is stored in signed OAuth state/session and survives callback plus MFA-pending transitions. |
| Auth-entry app-context status mapping | `apps/api-server/src/routes/auth.ts` (`resolveRequestedEmailPasswordAppContext`, `sendAppContextResolutionError`, `handleGoogleUrl`, `handlePasswordLogin`) + `apps/api-server/src/lib/authContextPolicy.ts` (`resolveAppContextForAuth`, `mapAuthContextFailureToAuthErrorCode`) | **CORRECT** | Valid OAuth start returns `200`; valid password login can return `202` when MFA is required; app-context fail-closed branches in this entry surface return `400` with stable codes (no `404` mapping). |
| Pending MFA session contract | `apps/api-server/src/routes/auth.ts` (`beginMfaPendingSession`, `completePendingMfaSession`, `handleMe`) + `apps/api-server/src/lib/session.ts` session typing | **CORRECT** | Pending state persists `pendingUserId`, `pendingAppSlug`, `pendingMfaReason`, `pendingStayLoggedIn`; `/api/auth/me` exposes `authState=\"mfa_pending\"` + `nextStep` and continuation is resumed after MFA completion. |
| Password login continuation preservation | `apps/api-server/src/routes/auth.ts` (`router.post("/login", ...)`, `resolvePostAuthContinuation`, `req.session.pendingPostAuthContinuation`, `resolveNextPathForEstablishedSession`) | **CORRECT** | Continuation is preserved with or without MFA. |
| MFA-pending session behavior | `apps/api-server/src/routes/auth.ts` (`beginMfaPendingSession`, `completePendingMfaSession`, `handleMe` `authState: "mfa_pending"` branch) + `apps/api-server/src/middlewares/requireAuth.ts` (`mfaPendingPathAllowed`) | **CORRECT** | Pending sessions return `authState="mfa_pending"`, `appAccess=null`, and `nextStep` fails closed to challenge when factor state is unreadable. |
| Trusted device cookie behavior | `apps/api-server/src/lib/mfa.ts` (`consumeTrustedDeviceToken`, `issueTrustedDeviceToken`, `clearTrustedDeviceCookie`) + `apps/api-server/src/routes/auth.ts` / `apps/api-server/src/routes/invitations.ts` MFA gates | **CORRECT** | Valid trusted cookies bypass challenge; revoked/expired/invalid tokens are ignored and MFA challenge proceeds. |
| Session regeneration points | `apps/api-server/src/routes/auth.ts` (`establishPasswordSession`, `beginMfaPendingSession`, OAuth callback `req.session.regenerate`) + `apps/api-server/src/routes/invitations.ts` (`establishInvitationSession`, `beginInvitationMfaPendingSession`) | **CORRECT** | Session IDs are regenerated at auth privilege boundaries to reduce fixation risk. |
| Post-auth destination precedence | `apps/api-server/src/lib/postAuthDestination.ts` (`resolveAuthenticatedPostAuthDestination`) + `apps/api-server/src/routes/auth.ts` (`resolveNextPathForEstablishedSession`) | **CORRECT** | `post_auth`: onboarding first, then continuation, then flow destination, then fallback. `post_onboarding`: continuation resumes after onboarding. |
| Email verification redirect behavior | `apps/admin/src/pages/auth/VerifyEmail.tsx` (`auth.verifyEmail`) + `lib/frontend-security/src/index.tsx` (`verifyEmail`) + `apps/api-server/src/routes/auth.ts` (`router.post("/verify-email", ...)`) | **PARTIAL** | Works for app-scoped links. If `appSlug` is absent, backend returns `verified_no_app_slug` without session establishment, so authenticated continuation is unavailable. |
| Onboarding redirect behavior | `apps/api-server/src/lib/appAccess.ts` (`getAppContext.requiredOnboarding`) + `apps/api-server/src/lib/postAuthDestination.ts` + `lib/frontend-security/src/index.tsx` (`resolveAuthenticatedNextStep`) + `apps/admin/src/App.tsx` (`ProtectedAppAccess`) + `apps/admin/src/pages/auth/Onboarding.tsx` (`/api/auth/post-onboarding/next-path`) | **PARTIAL** | Organization/user onboarding redirects are implemented, but frontend fallback policy and `/dashboard` defaults can diverge from backend route policy payloads when metadata contracts are missing. |
| `/api/auth/me` consistency during MFA pending | `apps/api-server/src/middlewares/requireAuth.ts` (`mfaPendingPathAllowed`, `effectiveUserId`) + `apps/api-server/src/routes/auth.ts` (`handleMe` pending branch) | **CORRECT** | `/api/auth/me` returns HTTP 200 pending payload with `authState="mfa_pending"` and `nextStep`; other protected endpoints continue returning `401 MFA_REQUIRED` while pending. |
| Throttling/error handling behavior | `apps/api-server/src/middlewares/rateLimit.ts` (`rateLimiter`, `authRateLimiterWithIdentifier`, postgres→memory fallback, `429`/`503`) + auth route mounts in `apps/api-server/src/routes/auth.ts` | **CORRECT** | Rate-limited requests return `429 RATE_LIMITED` with `Retry-After`; production distributed limiter failures return `503 RATE_LIMIT_UNAVAILABLE` unless migration/schema errors trigger emergency in-memory fallback. |

---

### 4) App-context / app-metadata consumer inventory

#### `apps/api-server`
- `lib/appAccess.ts`
  - **Consumes**: `slug`, `isActive`, `accessMode`, `staffInvitesEnabled`, `customerRegistrationEnabled`, plus relation state.
  - **Mode**: metadata-driven for access profile; hardcoded defaults in route derivation (`admin -> /dashboard`, else `/${slug}`).
  - **Assumptions**: slug (`admin`), access profiles, onboarding model.
- `lib/appAccessProfile.ts`
  - **Consumes**: `accessMode`, org capability booleans.
  - **Mode**: metadata-driven with hardcoded profile map.
- `lib/postAuthFlow.ts`, `lib/postAuthDestination.ts`, `lib/postAuthRedirect.ts`
  - **Consumes**: normalized profile + onboarding requirement.
  - **Mode**: mixed; hardcoded `/dashboard`, hardcoded onboarding paths.
- `routes/auth.ts`
  - **Consumes**: slug resolution, `accessMode`, staff/customer flags, `isActive` through `getAppBySlug`.
  - **Mode**: mixed; auth-entry context resolution is explicit appSlug first, origin-derived context second, session-group fallback last, and always requires canonical app lookup with no implicit admin fallback or hardcoded admin origin/slug shortcut authority.
- `routes/apps.ts`
  - **Consumes**: many app fields to serialize metadata and authRoutePolicy.
  - **Mode**: metadata-driven API source for frontend app metadata.
- `routes/invitations.ts`
  - **Consumes**: `slug`, `isActive`, `accessMode`, `staffInvitesEnabled`, `id`.
  - **Mode**: metadata + hardcoded organization-only checks.
- `routes/organizations.ts`
  - **Consumes**: `slug`, `isActive`, `metadata.sessionGroup`, `id`.
  - **Mode**: metadata-driven compatibility with hardcoded legacy appId fallback.
- `lib/sessionGroupCompatibility.ts`
  - **Consumes**: `metadata.sessionGroup`, `slug`.
  - **Mode**: metadata-driven with hardcoded fallback (`admin` => admin group).
- `lib/invitationEmail.ts`
  - **Consumes**: `isActive`, `transactionalFrom*`, `name`.
  - **Mode**: metadata-driven sender context; ignores invitation subject/html legacy fields.

#### `lib/frontend-security`
- `useCurrentPlatformAppMetadata()` / `fetchPlatformAppMetadataBySlug()`
  - **Consumes**: `/api/apps` payload fields `slug`, `normalizedAccessProfile`, optional `authRoutePolicy`.
  - **Mode**: metadata-driven but list-scan by slug (not context endpoint).
  - **Assumptions**: `VITE_APP_SLUG` exists and matches backend slug.
- `deriveAppAuthRoutePolicy()`
  - **Consumes**: normalized profile + optional policy.
  - **Mode**: hardcoded fallback when backend policy missing.
  - **Assumptions**: profile->policy mapping, especially solo/organization defaults.
- `resolveAuthenticatedNextStep()`
  - **Consumes**: `user.appAccess` (`requiredOnboarding`, `canAccess`, `normalizedAccessProfile`).
  - **Mode**: mixed; data-driven plus hardcoded route fallbacks (`/dashboard`, `/login`).
- `loginWithGoogle/loginWithPassword/verifyEmail/acceptInvitation*`
  - **Consumes**: returnToPath continuation and MFA response payload.
  - **Mode**: backend-driven contracts + frontend hardcoded destination defaults.

#### `apps/admin`
- `App.tsx`
  - **Consumes**: `useCurrentPlatformAppMetadata()` + `auth.user.appAccess` snapshot.
  - **Mode**: mixed; metadata-driven route allowance + hardcoded redirects/paths.
  - **Assumptions**: route structure (`/dashboard`, `/onboarding/*`, `/invitations/:token/accept`), superadmin handling.
- `pages/auth/Login.tsx`
  - **Consumes**: `next` query param, metadata-driven login composition.
  - **Mode**: mixed; hardcoded default `/dashboard` and static `/signup` links.
- `pages/auth/Signup.tsx`
  - **Consumes**: signup policy from metadata hook composition.
- `pages/auth/InvitationAccept.tsx`
  - **Consumes**: invitation resolve payload (`state`, `emailMode`, `googleAllowed`).
  - **Mode**: backend-driven for state; hardcoded continuation path shape.
- `pages/auth/Onboarding.tsx`
  - **Consumes**: backend post-onboarding endpoint response.
  - **Mode**: hardcoded fallback `/dashboard` if nextPath missing.

---

### 5) Hardcoded behavior detection (auth/session/onboarding/invitation/routing)

| Location | Hardcoded assumption/value | Risk | Likely metadata/config replacement |
|---|---|---|---|
| `appAccess.ts` | `admin` slug default route `/dashboard`; else `/${appSlug}` | Route model drift if app routes differ | App-level route metadata/default route config |
| `postAuthRedirect.ts` + frontend resolver | fallback `/dashboard`, onboarding paths fixed | Multi-app route divergence risk | App metadata route policy |
| `routes/auth.ts` | auth-entry app-context resolution precedence is explicit `appSlug` → trusted origin-derived context → session-group fallback | Candidate-source ordering drift risk if contracts diverge across layers | Keep precedence and failure-code mapping aligned with `resolveAppContextForAuth` contract (`app_slug_missing`, `app_not_found`) |
| `routes/auth.ts` | fail-closed auth-entry mapping returns `400` with typed app-context errors when candidates are unresolved or canonical lookup is null | Client handling can regress if callers expect legacy status codes | Keep `sendAppContextResolutionError` as the single mapping surface (`app_slug_missing`, `app_not_found`) |
| `lib/frontend-security resolveAuthenticatedNextStep()` | default destination fallback `/dashboard` | Non-admin apps may inherit admin-biased post-auth route | Backend-issued default-route metadata per app |
| `sessionGroupCompatibility.ts` | session-group compatibility is metadata-driven, and auth-entry session-group fallback is only the last candidate source (no implicit admin fallback) | Context selection drift if metadata/session signals are inconsistent | Keep session-group fallback as terminal candidate only after explicit appSlug and origin-derived context |
| `postAuthContinuation.ts` | invitation/event/client regex path typing | Path contract fragility, duplicates routing semantics | Explicit continuation type from caller + server-side allowlist registry |
| `frontend-security deriveAppAuthRoutePolicy()` | fallback policy map (organization/solo/superadmin) | Frontend/back drift if backend policy changes | Always consume backend `authRoutePolicy` |
| `App.tsx` + auth pages | static route guard redirects (`/login`, `/dashboard`, `/onboarding/...`) | Hard to support app-specific auth shells | App metadata routing map |
| `InvitationAccept.tsx` | continuation path format `/invitations/${token}/accept` | Tight coupling to invitation route template | Backend-issued continuation token/path |
| `ConfigDrivenAuthRoute` | unauthenticated invitation route special case before policy block | Behavior order dependency | Explicit backend-provided route gating contract |

---

### 6) Current limitations and split-source-of-truth risks

1. **Duplicated logic**
   - Post-auth destination logic exists both backend (`resolveAuthenticatedPostAuthDestination`) and frontend (`resolveAuthenticatedNextStep`) with overlapping but not identical fallbacks.
2. **Split source-of-truth**
   - Frontend app metadata via `/api/apps` list scan while backend auth decisions use `getAppContext()` and `/api/auth/me` `appAccess` snapshot.
3. **Frontend/backend validation drift risk**
   - Frontend fallback `deriveAppAuthRoutePolicy()` can diverge from backend `getAuthRoutePolicyForProfile()`.
4. **Partial metadata adoption**
   - `apps.metadata` only used for optional `sessionGroup`; other behavior remains hardcoded.
5. **Auth boundary leakage risk**
   - Auth entry must remain explicit and fail closed: `appSlug` is authoritative, origin-derived context is secondary, session-group fallback is last, and unresolved context maps to typed `400` auth errors (`app_slug_missing`, `app_not_found`) without implicit admin behavior.
6. **Routing inconsistencies**
   - Multiple hardcoded `/dashboard` fallbacks across backend and frontend.
7. **Invitation/auth continuation inconsistencies**
   - Continuation preservation is good, but invitation accept still requires org-app session compatibility, which can reject a valid token under incompatible session context.
8. **MFA/account-state inconsistencies**
   - MFA requirement role check intentionally fails open on org role read outages (`isMfaRequiredForUser` catch path), while `/api/auth/me` pending resolution fails closed on factor-read outages.

---

## System Truth vs Drift

### STABLE
- `accessMode` normalization and enforcement (`superadmin`/`solo`/`organization`) are consistently applied in backend app access and auth flow decision paths.
- OAuth continuation (`returnToPath`) is preserved through OAuth start/state/callback and integrated into post-auth destination resolution.
- MFA pending contract is explicit and blocks protected access until challenge/enrollment completes; `nextStep` is returned consistently.
- Trusted-device implementation is server authoritative with hashed token storage and cookie transport.

### PARTIAL
- Frontend app metadata consumption is policy-aware but built on `/api/apps` list scan and fallback policy derivation; does not exclusively rely on backend canonical policy payloads.
- `customerRegistrationEnabled` affects backend access and signup admission, but frontend route policy intentionally fail-closes customer registration surface.
- Onboarding continuation preservation works, but depends on session-stored `postAuthContinuation` and hardcoded route defaults.
- `metadata.sessionGroup` is honored by backend compatibility checks but not surfaced as an explicit cross-layer contract.
- Invitation → login → continuation is preserved end-to-end, but completion still depends on org-app-compatible authenticated session middleware at the final invitation accept endpoint.
- Email verification continuation is appSlug-dependent; verification without `appSlug` is intentionally non-session-establishing.

### BROKEN
- No direct runtime consumer for `platform.apps.invitationEmailSubject` and `platform.apps.invitationEmailHtml`; schema fields are inert while email behavior is template-table-driven.
- Frontend fallback auth-route policy still fail-closes customer-registration affordances when backend `authRoutePolicy` metadata is absent, so metadata delivery remains a source-of-truth dependency.

### MISSING
- No unified, single app-context endpoint contract consumed by both frontend route policy and backend auth resolution.
- No metadata-driven default-route registry (still hardcoded `/dashboard` and slug path assumptions).
- No fully implemented customer/client registration route flow despite continuation type support (`client_registration`, `event_registration`).
- Remaining hardcoded route defaults (for example `/dashboard`) still represent drift risk, but auth-entry context resolution no longer depends on implicit admin slug/hostname assumptions.

## Inferred
- The system is in an intermediate migration state for routing/policy metadata convergence, while auth-entry context resolution is already hardened to explicit precedence and fail-closed typed `400` responses.

## Unclear
- Whether inert `platform.apps` email override fields are planned for removal or reactivation.
- Whether frontend should migrate from `/api/apps` list scan to context endpoint consumption for auth-route gating.

## Do not break
- Keep backend `resolvePostAuthFlowDecision()` + `resolveAuthenticatedPostAuthDestination()` precedence order intact unless frontend + backend are updated together.
- Do not loosen invitation acceptance checks around app profile/session-group compatibility without explicit security review.
- Do not introduce new route-level auth policy in frontend without backend parity (or explicit backend policy contract changes).
