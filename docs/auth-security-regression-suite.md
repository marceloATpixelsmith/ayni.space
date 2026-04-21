# Auth Security Regression Suite

## Scope
- Permanent integration-level regression suite for authentication, session-group isolation, and security controls.
- Defines required GitHub Actions check name and local execution contract.

## Confirmed
- Backend auth core hardening coverage is included via `apps/api-server/src/__tests__/auth-security-regression-suite.test.ts` (session-group isolation, denial cleanup, turnstile/rate-limit/origin fail-closed behavior, and stable CSRF/origin error-code contracts).
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
- Frontend auth runtime coverage now includes route-guard outcomes (unauthenticated, MFA-pending, onboarding, denied), login/signup branching, superadmin affordance hiding, and invitation continuation branch assertions (`apps/admin/src/__tests__/auth-routing.runtime.test.tsx`, `apps/admin/src/__tests__/invitation-flow.runtime.test.tsx`).

## Test location
- `apps/api-server/src/__tests__/auth-security-regression-suite.test.ts`

## How to run locally
- From repository root (frontend auth route orchestration + backend auth hardening regression set):
  - `pnpm run test:auth-security-regression`
- Frontend runtime auth tests only:
  - `pnpm --filter @workspace/admin run test:auth-runtime`
- Backend targeted auth-flow tests only:
  - `pnpm --filter @workspace/api-server exec tsx --test src/__tests__/auth-security-regression-suite.test.ts src/__tests__/auth-session-group-hardening.test.ts src/__tests__/auth-real-journey-routes.test.ts src/__tests__/invitation-password-mfa-routing.test.ts`

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
