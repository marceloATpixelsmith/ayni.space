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
- `customerRegistrationEnabled` is functionally active in backend access decisions but not reflected in frontend `deriveAppAuthRoutePolicy()` fallback semantics (frontend fallback denies customer registration and may deny onboarding for solo depending on fallback path), increasing split-source-of-truth risk.
- `invitationEmailSubject`/`invitationEmailHtml` are schema-present but superseded by `platform.email_templates` resolution in `resolveEmailTemplate()` + lane1 send path.
- `metadata` is used for `sessionGroup` only; no generic metadata contract exists between backend and frontend.

---

### 2) Real auth flow truth map (by user type)

#### 2.1 Superadmin (admin app)
- **Entry routes/pages**: `/login` (password/google), `/api/auth/login`, `/api/auth/google/url`, `/api/auth/google/callback`.
- **Session creation/regeneration points**:
  - password: `beginMfaPendingSession()` may regenerate to pending MFA session; `establishPasswordSession()` regenerates on full login.
  - OAuth: callback regenerates session before user binding.
- **Email verification timing**: password login blocks until `emailVerifiedAt` exists; Google-created users are set `emailVerifiedAt=now` at create.
- **MFA timing**: `isMfaRequiredForUser()` forces MFA for `users.isSuperAdmin=true`; pending session created until challenge/enroll done.
- **Trusted device**: trusted cookie bypasses challenge in `beginMfaPendingSession()` when valid.
- **Onboarding trigger**: none (superadmin profile maps required onboarding to `none`).
- **Invitation continuation**: generally not relevant; continuation path still parsed if provided.
- **Final destination**: `/dashboard` if true superadmin, else `/login?error=access_denied`.
- **EXPECTED**: strict superadmin-only access.
- **ACTUAL**: strict check enforced in backend flow + frontend route guard.
- **MISMATCH / DRIFT**: fallback app slug resolution defaults to `admin` in password login slug resolver when app cannot be resolved, which can misclassify non-admin contexts.

#### 2.2 Organization admin (org_owner/org_admin in organization app)
- **Entry routes/pages**: `/login`, OAuth flow, invitation accept route, onboarding routes.
- **Backend endpoints**: `/api/auth/login`, `/api/auth/google/*`, `/api/auth/me`, `/api/auth/post-onboarding/next-path`, org/invite APIs.
- **Session points**: same as above; plus `switchOrganization` updates active org in session (`/api/users/switch-org` path not re-documented here).
- **Email verification**: required for password login unless verified via `/api/auth/verify-email`.
- **MFA timing**: role-based MFA required by `isMfaRequiredForUser()` active membership role check.
- **Trusted device**: same bypass behavior.
- **Onboarding trigger**: `requiredOnboarding` from `getAppContext()` (`organization` or `user`).
- **Invitation continuation**: invitation pages set continuation path `/invitations/:token/accept`; backend stores pending continuation through MFA.
- **Final destination**: precedence from `resolveAuthenticatedPostAuthDestination`: onboarding (post_auth stage) > continuation > flow destination > `/dashboard`.
- **EXPECTED**: org leaders challenged for MFA, then onboarding/continuation.
- **ACTUAL**: implemented as expected.
- **MISMATCH / DRIFT**: `requiredOnboarding=organization` is treated specially (`canAccess=false` but still routed to onboarding), creating subtle “deny-but-onboard” dual semantics.

#### 2.3 Invited user (staff invite)
- **Entry routes/pages**: `/invitations/:token/accept` (pre-auth allowed), optional Google start from invitation page, optional password bootstrap via `accept-email`.
- **Backend endpoints**: `GET /api/invitations/:token/resolve`, `POST /api/invitations/:token/accept-email`, `POST /api/invitations/:token/accept`.
- **Session points**:
  - `accept-email`: creates credential, then either pending MFA session (regenerate) or full invitation session (regenerate).
  - `accept` requires authenticated org-app session.
- **Email verification timing**: `accept-email` auto-creates user with `emailVerifiedAt` set; no extra verify step.
- **MFA timing**: invite acceptance password path runs `beginInvitationMfaPendingSession()` before finalize.
- **Trusted device**: checked during invitation MFA gating.
- **Onboarding trigger**: post-accept destination computed with post-auth flow decision (could route to onboarding/user).
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
- **Onboarding trigger**: `requiredOnboarding=user` when missing name.
- **Invitation continuation**: not typically used.
- **Final destination**: `/onboarding/user` or continuation/default.
- **EXPECTED**: direct access + optional user onboarding.
- **ACTUAL**: `getAppContext()` sets `canAccess=true` for solo and user-onboarding when name missing.
- **MISMATCH / DRIFT**: frontend fallback policy for solo in `deriveAppAuthRoutePolicy()` denies onboarding when backend metadata policy missing, creating potential fail-closed redirect mismatch.

#### 2.5 Client / participant / registration user
- **Entry routes/pages**: no dedicated frontend route implemented in `apps/admin` for customer registration.
- **Backend signals**: continuation parser supports `client_registration` and `event_registration` types.
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
| Invitation accept continuation | `InvitationAccept.tsx` sets continuation `/invitations/:token/accept`; `loginWithGoogle/loginWithPassword` pass `returnToPath`; backend `resolvePostAuthContinuation()` + pending continuation session fields | **Correct (partial constraints)** | Continuation is preserved across password/OAuth/MFA. Constraint: final `/accept` API requires authenticated org-app session middleware. |
| Login page `next` param handling | `Login.tsx` reads `query.get("next")`; passes into `auth.loginWithPassword` / `auth.loginWithGoogle`; `resolveAuthenticatedNextStep()` uses normalized return path | **Correct** | Open redirects blocked (must start with `/`, no `//`). |
| OAuth start/callback continuation preservation | `/api/auth/google/url` stores `returnToPath` in OAuth state + session; callback parses state, reconstructs continuation, uses `resolveNextPathForEstablishedSession()` | **Correct** | Continuation survives callback and MFA pending transitions. |
| Password login continuation preservation | `/api/auth/login` parses return path to `PostAuthContinuation`; stores in `pendingPostAuthContinuation` for MFA path; immediate session path passes continuation directly | **Correct** | Preserved with or without MFA. |
| MFA-pending session behavior | `beginMfaPendingSession()`, `completePendingMfaSession()`, `/api/auth/me` pending contract branch | **Correct** | Pending sessions return `authState=mfa_pending`, `appAccess=null`, `nextStep` derived fail-closed when factor read fails. |
| Trusted device cookie behavior | `mfa.ts` trusted device storage/check/revoke; login and invite MFA gate consult cookie; challenge/enroll can set cookie | **Correct** | Valid trusted cookie bypasses challenge; revoked/expired/invalid tokens fail closed silently. |
| Session regeneration points | `establishPasswordSession()`, `beginMfaPendingSession()`, OAuth callback regenerate, invitation session establish regenerate | **Correct** | Regeneration used at privilege boundaries; reduces fixation risk. |
| Post-auth destination precedence | `resolveAuthenticatedPostAuthDestination()` | **Correct** | `post_auth`: onboarding destination first, then continuation, then flow, then fallback. `post_onboarding`: continuation can resume after onboarding. |
| Email verification redirect behavior | `VerifyEmail.tsx` -> `auth.verifyEmail`; backend `/api/auth/verify-email` returns nextPath or MFA requirements | **Partial** | Works when `appSlug` provided; if omitted, backend returns success without session establishment (`verified_no_app_slug`) causing no direct authenticated continuation. |
| Onboarding redirect behavior | Backend computes `requiredOnboarding`; frontend `ProtectedAppAccess` + `resolveAuthenticatedNextStep` enforce redirects; post-onboarding endpoint resolves next path | **Partial** | Works for organization/user onboarding; drift risk due to frontend metadata fallback policy differences and hardcoded `/dashboard` fallback. |

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
  - **Mode**: mixed; metadata-based app lookup plus hardcoded admin origin/slug shortcuts.
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
| `routes/auth.ts` | host-based admin slug detection (`admin.ayni.space` / `admin.*`) | Environment/domain coupling | Explicit origin→app mapping only |
| `routes/auth.ts` | password auth slug fallback returns `admin` when unresolved | Can mis-route or mis-apply superadmin policy | Required explicit app slug/session app binding |
| `sessionGroupCompatibility.ts` | slug `admin` => admin session group fallback | Hidden slug/session coupling | Canonical metadata `sessionGroup` required |
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
   - `getRequestedEmailPasswordAppSlug()` defaulting to `admin` can apply admin profile rules outside intended app context.
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

### BROKEN
- No direct runtime consumer for `platform.apps.invitationEmailSubject` and `platform.apps.invitationEmailHtml`; schema fields are inert while email behavior is template-table-driven.
- Password-login app resolution fallback to `admin` can create incorrect app-context decisions when slug/origin/session context is absent or ambiguous.
- Frontend fallback auth-route policy for `solo` (`allowOnboarding: false` in fallback) can disagree with backend profile policy (`allowOnboarding: true`), causing potential route gating drift when metadata policy payload is absent.

### MISSING
- No unified, single app-context endpoint contract consumed by both frontend route policy and backend auth resolution.
- No metadata-driven default-route registry (still hardcoded `/dashboard` and slug path assumptions).
- No fully implemented customer/client registration route flow despite continuation type support (`client_registration`, `event_registration`).
- No comprehensive elimination of hardcoded slug/hostname assumptions (`admin` special-casing still present in multiple layers).

## Inferred
- The system is in an intermediate migration state from legacy hardcoded app/auth routing toward metadata-derived policy, but only partial layers have converged.

## Unclear
- Whether inert `platform.apps` email override fields are planned for removal or reactivation.
- Whether frontend should migrate from `/api/apps` list scan to context endpoint consumption for auth-route gating.

## Do not break
- Keep backend `resolvePostAuthFlowDecision()` + `resolveAuthenticatedPostAuthDestination()` precedence order intact unless frontend + backend are updated together.
- Do not loosen invitation acceptance checks around app profile/session-group compatibility without explicit security review.
- Do not introduce new route-level auth policy in frontend without backend parity (or explicit backend policy contract changes).
