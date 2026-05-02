# Auth Security Regression Suite

## Scope
- Permanent integration-level regression suite for authentication, session-group isolation, and security controls.
- Defines required GitHub Actions check name and local execution contract.

## Confirmed
- Backend auth core hardening coverage is included via `apps/api-server/src/__tests__/auth-security-regression-suite.test.ts` (session-group isolation, denial cleanup, turnstile/rate-limit/origin fail-closed behavior, and stable CSRF/origin error-code contracts).
- Password auth and OAuth start now fail closed via centralized app-context resolution (`resolveAppContextForAuth`) with no implicit `admin` fallback and no slug-only synthesized policy.
- Auth-context candidate priority is fixed as: explicit `appSlug` (request body/query/param) → trusted origin/host-derived context (`APP_SLUG_BY_ORIGIN` then DB origin lookup) → session-group fallback mapping; explicit input is authoritative over mismatched origin/session-group hints (`apps/api-server/src/lib/authContextPolicy.ts`, `apps/api-server/src/__tests__/auth-app-context-policy.test.ts`).
- Missing all context candidates fails closed with `app_slug_missing`; canonical slug lookup returning null fails with `app_not_found`; canonical lookup exceptions fail as `app_context_unavailable` for request/origin sources and `app_not_found` for session-group fallback source (`apps/api-server/src/lib/authContextPolicy.ts`, `apps/api-server/src/__tests__/auth-app-context-policy.test.ts`).
- Explicit-vs-origin/session-group mismatch fail-closed behavior is scoped: conflicts are enforced only when no explicit `appSlug` is supplied (origin-derived or authenticated-session group conflict branches), mapping to `access_denied` for admin-context-required cases and `app_context_unavailable` for non-admin context conflicts (`apps/api-server/src/lib/authContextPolicy.ts`, `apps/api-server/src/routes/auth.ts`, `apps/api-server/src/__tests__/auth-app-context-policy.test.ts`).
- Admin OAuth start hardening is enforced on `/api/auth/google/url`: admin context derived from origin/session data alone is rejected (`400 app_not_found`) unless explicit `appSlug=admin` is provided; valid explicit admin requests still return OAuth URL success (`200`) (`apps/api-server/src/routes/auth.ts`, `apps/api-server/src/__tests__/auth-session-group-hardening.test.ts`).
- Admin privilege enforcement in auth context policy now derives only from canonical app access mode (`superadmin`) plus canonical app metadata-derived session group checks; slug literals and env-derived known-slug fallbacks no longer grant admin behavior (`apps/api-server/src/lib/authContextPolicy.ts`, `apps/api-server/src/__tests__/auth-app-context-policy.test.ts`).
- Auth-entry status contracts are protected in tests: valid OAuth start returns `200`, valid password login may return `202` for MFA challenge/enrollment, and app-context fail-closed errors in this auth-entry surface return `400` (shared `sendAppContextResolutionError`, not `404`) (`apps/api-server/src/routes/auth.ts`, `apps/api-server/src/__tests__/auth-logout-turnstile.test.ts`, `apps/api-server/src/__tests__/auth-session-group-hardening.test.ts`).
- Post-auth destination resolution now fails closed with explicit `POST_AUTH_DESTINATION_UNRESOLVED` instead of silently defaulting to dashboard-like fallbacks during login/verify-email/MFA/onboarding completion (`apps/api-server/src/routes/auth.ts`).
- Pending MFA contract remains test-protected: pending session fields (`pendingUserId`, `pendingAppSlug`, `pendingMfaReason`, `pendingStayLoggedIn`) persist through challenge flow and `/api/auth/me` exposes pending bootstrap semantics (`authState=\"mfa_pending\"`, `nextStep`) until completion (`apps/api-server/src/routes/auth.ts`, `apps/api-server/src/lib/session.ts`, `apps/api-server/src/__tests__/auth-session-group-hardening.test.ts`).
- Continuation contract remains test-protected with canonical precedence `MFA -> onboarding -> continuation -> default`, app-bound continuation replay, and fail-closed rejection of invalid/mismatched continuation paths (`apps/api-server/src/lib/postAuthDestination.ts`, `apps/api-server/src/lib/postAuthContinuation.ts`, `apps/api-server/src/__tests__/auth-session-group-hardening.test.ts`, `lib/frontend-security/src/__tests__/auth-flow-closure-regression.test.ts`).
- Multi-session-group behavior with one browser cookie jar (`admin` + `default` cookies coexist and remain independently valid).
- Cross-group isolation (auth in one group does not authenticate another group).
- Admin denial flow for non-super-admin users (`/login?error=access_denied`, admin-group session destroyed/cleared, other group cookie left intact).
- Admin callback outage fallback remains fail-closed (when admin app/app-context lookup is unavailable, callback redirects to `/login?error=access_denied` and clears only the admin-group session/cookie instead of returning `500`).
- Group-scoped logout behavior (only targeted group session/cookie is invalidated).
- Session lifecycle safeguards (`platform.sessions` configuration, logout invalidation behavior, non-reusability after destruction).
- Cookie correctness (per-group cookie names, secure/httpOnly/sameSite handling, clearing uses matching config).
- Turnstile enforcement (missing token rejected, valid token accepted, invalid token rejected).
- Basic auth rate limiting (normal use passes, rapid repeated attempts are limited, unaffected traffic still works).
- CORS/origin behavior (allowed origin succeeds, disallowed origin blocked, preflight handled correctly).
- Fail-closed behavior (missing session denied, invalid/ambiguous group resolution denied).
- Route-level auth journey coverage now includes explicit backend route chains for signup/verify-email/MFA/onboarding/dashboard, invitation accept branches (password/sign-in/google continuations), and forgot/reset-password bootstrap cleanup (`apps/api-server/src/__tests__/auth-real-journey-routes.test.ts`).
- Backend session/MFA pending and continuation-precedence coverage is exercised in `apps/api-server/src/__tests__/auth-session-group-hardening.test.ts` and `apps/api-server/src/__tests__/invitation-password-mfa-routing.test.ts`.
- Auth-entry contract guards are part of backend coverage via `apps/api-server/src/__tests__/auth-entry-regression-guards.test.ts` and are executed by `pnpm run test:auth-security-regression`.
- Frontend auth runtime coverage now includes route-guard outcomes (unauthenticated, MFA-pending, onboarding, denied), login/signup branching, superadmin affordance hiding, and invitation continuation branch assertions (`apps/admin/src/__tests__/auth-routing.runtime.test.tsx`, `apps/admin/src/__tests__/invitation-flow.runtime.test.tsx`).
- Shared frontend-security contracts are part of this suite and cover continuation precedence, session/MFA pending route resolution, CSRF requirement behavior, Turnstile lifecycle state, and stable auth/CSRF error-code mapping. CSRF retry/detection is code-based only (`code === "CSRF_INVALID"`) with no message-text fallback (`lib/frontend-security/src/__tests__/post-auth-resolver.test.ts`, `lib/frontend-security/src/__tests__/auth-flow-closure-regression.test.ts`, `lib/frontend-security/src/__tests__/csrf-requirement.test.ts`, `lib/frontend-security/src/__tests__/turnstile-lifecycle.test.ts`, `lib/frontend-security/src/__tests__/google-signin-error-mapping.test.ts`).

## Test location
- `apps/api-server/src/__tests__/auth-security-regression-suite.test.ts`

## How to run locally
- From repository root (shared frontend-security + frontend auth routing + backend auth hardening regression set):
  - `pnpm run test:auth-security-regression`
- Frontend runtime auth tests only:
  - `pnpm --filter @workspace/admin run test:auth-runtime`
- Backend targeted auth-flow tests only:
  - `pnpm --filter @workspace/api-server exec tsx --test src/__tests__/auth-security-regression-suite.test.ts src/__tests__/auth-session-group-hardening.test.ts src/__tests__/auth-real-journey-routes.test.ts src/__tests__/invitation-password-mfa-routing.test.ts src/__tests__/auth-entry-regression-guards.test.ts`

## Required GitHub check
- Workflow name: `Auth Security Regression Suite`
- Required job/check name for branch protection: `auth-security-regression-suite`

## Inferred
- Running this suite on every PR and push to `master` prevents path-filter skips from bypassing auth/security validation.
- The suite is designed to fail if behavior regresses toward single-cookie or cross-group-coupled session handling.

## Unclear
- Whether additional future session groups beyond `default` and `admin` should be promoted into this same suite or split into app-specific suites.

## Do not break
- Any authentication/session/security behavior change must pass this suite before merge.
- This suite is expected to fail if behavior regresses to single-cookie session handling, cross-group leakage, or non-group-scoped logout/denial flows.


## AUTH freeze policy (current phase)
- AUTH is a protected/frozen subsystem for the current phase.
- Auth-critical files must not be changed unless the task explicitly requires AUTH work.
- Unrelated tasks must not opportunistically modify auth redirects, MFA flow, session-group behavior, CSRF behavior, Turnstile behavior, app-context resolution, login/signup routing, invitation auth flow, or post-auth continuation behavior.

### Auth-critical file groups
- `apps/api-server/src/routes/auth.ts`
- `apps/api-server/src/middlewares/requireAuth.ts`
- `apps/api-server/src/middlewares/csrf.ts`
- `apps/api-server/src/middlewares/turnstile.ts`
- `apps/api-server/src/lib/auth*.ts`
- `apps/api-server/src/lib/session*.ts`
- `apps/api-server/src/lib/mfa.ts`
- `apps/api-server/src/lib/postAuth*.ts`
- `lib/frontend-security/**`
- `lib/api-client-react/src/custom-fetch.ts`
- `lib/auth-ui/**`
- `apps/admin/src/pages/auth/**`
- auth/security regression test files
- auth-related workflow/docs

### Required gate (must be preserved)
- Workflow: `Auth Security Regression Suite`
- Required job/check: `auth-security-regression-suite`
- Command: `pnpm run test:auth-security-regression`

### Change discipline when AUTH work is explicitly requested
- Any auth change must update tests and docs in the same PR.
- Do not remove or weaken existing auth/security regression coverage.
