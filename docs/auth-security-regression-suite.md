# Auth Security Regression Suite

## Scope
- Permanent integration-level regression suite for authentication, session-group isolation, and security controls.
- Defines required GitHub Actions check name and local execution contract.

## Confirmed
- Multi-session-group behavior with one browser cookie jar (`admin` + `default` cookies coexist and remain independently valid).
- Cross-group isolation (auth in one group does not authenticate another group).
- Admin denial flow for non-super-admin users (`/login?error=access_denied`, admin-group session destroyed/cleared, other group cookie left intact).
- Group-scoped logout behavior (only targeted group session/cookie is invalidated).
- Session lifecycle safeguards (`platform.sessions` configuration, logout invalidation behavior, non-reusability after destruction).
- Cookie correctness (per-group cookie names, secure/httpOnly/sameSite handling, clearing uses matching config).
- Turnstile enforcement (missing token rejected, valid token accepted, invalid token rejected).
- Basic auth rate limiting (normal use passes, rapid repeated attempts are limited, unaffected traffic still works).
- CORS/origin behavior (allowed origin succeeds, disallowed origin blocked, preflight handled correctly).
- Fail-closed behavior (missing session denied, invalid/ambiguous group resolution denied).

## Test location
- `apps/api-server/src/__tests__/auth-security-regression-suite.test.ts`

## How to run locally
- From repository root:
  - `pnpm run test:auth-security-regression`
- Directly in API package:
  - `pnpm --filter @workspace/api-server run test:auth-security-regression`

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
