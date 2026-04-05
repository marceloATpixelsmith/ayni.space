# 04 — Auth and Session Inventory

## Scope
- Inventory auth/session architecture at the system level without adding policy details not present in `01`.
- Canonical companion: `docs/authentication-and-session-architecture.md`.

## Confirmed
- Login requests can now opt into 14-day persistence (`stayLoggedIn`) and backend session cookies are adjusted authoritatively in `apps/api-server/src/lib/session.ts`/`apps/api-server/src/routes/auth.ts` (including Google OAuth state handoff).
- Backend auth implementation location: `apps/api-server/src/lib/auth.ts`.
- Backend auth/session route wiring: `apps/api-server/src/routes/auth.ts`.
- Session lifecycle/rotation helpers and canonical session destruction/cookie clearing/logout-others helpers: `apps/api-server/src/lib/session.ts`.
- Session-group resolver/cookie mapping helpers: `apps/api-server/src/lib/sessionGroup.ts`.
- Session middleware issuance is request-scoped by group in `apps/api-server/src/lib/session.ts` (group is resolved per request and routed to a matching per-group `express-session` middleware instance/cookie name).
- Session issuance also namespaces generated session IDs by group (`<group>.<uuid>` in `apps/api-server/src/lib/session.ts`) so one backend/store can persist multiple group sessions for the same browser without SID collisions.
- Request group resolution is trust-aware and fail-closed for ambiguous multi-cookie flows via `resolveSessionGroupForRequest` in `apps/api-server/src/lib/sessionGroup.ts`.
- OAuth denial and logout are group-scoped in `apps/api-server/src/routes/auth.ts` (admin denial destroys/clears admin-group session state only).
- Session persistence table is `platform.sessions` and is owned by DB migrations.
- Session revocation for `/api/users/logout-others` is group-aware (`apps/api-server/src/lib/session.ts`, `apps/api-server/src/routes/users.ts`) and does not wipe unrelated session groups.
- Password-reset completion revokes all other sessions for the recovered user across session groups, then clears the current group cookie/session (`apps/api-server/src/lib/session.ts`, `apps/api-server/src/routes/auth.ts`).
- Frontend auth provider/route gate: `lib/frontend-security/src/index.tsx`.
- CSRF-aware API fetch path: `lib/api-client-react/src/custom-fetch.ts`.
- OAuth start origin derivation in auth route resolves trusted `origin`/`referer` and trusted forwarded host/proto headers before allowlist checks (`apps/api-server/src/routes/auth.ts`).
- Shared frontend fetch layers force credentialed auth/session requests (`/api/auth/*`, `/api/csrf-token`) via `credentials: "include"` (`lib/api-client-react/src/custom-fetch.ts`, `lib/frontend-security/src/index.tsx`).
- Shared frontend fetch now includes one-shot CSRF recovery for unsafe requests: on `403` CSRF mismatches, `customFetch` requests a refreshed token from `AuthProvider` and retries once, which covers auth and onboarding forms that use generated hooks (`lib/api-client-react/src/custom-fetch.ts`, `lib/frontend-security/src/index.tsx`, `apps/admin/src/pages/auth/Onboarding.tsx`).
- Frontend startup auth bootstrap now respects a recent auth-transition marker (password login/verify-email/MFA) in addition to OAuth-start markers to prevent transient login-page renders before post-auth session state is visible (`lib/frontend-security/src/index.tsx`).
- Auth/session middleware integration lives in `apps/api-server/src/app.ts`.
- `/api/auth/verify-email` remains a public, rate-limited endpoint but is exempt from Turnstile because emailed link possession is the verification proof and must not require an extra interactive challenge (`apps/api-server/src/lib/securityPolicy.ts`, `apps/api-server/src/routes/auth.ts`).
- Verification-link consumption now distinguishes token failure states (`invalid`, `expired`, `already_used`) at the API layer and frontend verification calls now acquire CSRF state before posting, preventing initial CSRF race failures from being mislabeled as token-invalid errors (`apps/api-server/src/routes/auth.ts`, `lib/frontend-security/src/index.tsx`, `apps/admin/src/pages/auth/VerifyEmail.tsx`).
- Verification-link emails now include `appSlug` so verify completion can continue through backend post-auth/MFA routing when appropriate, rather than defaulting to token-only completion (`apps/api-server/src/lib/invitationEmail.ts`, `apps/api-server/src/routes/auth.ts`).
- Verify-email UI now uses explicit completion/error/redirecting states and avoids stale effect-cancel dead-ends that could leave users stuck on "Verifying your email..." (`apps/admin/src/pages/auth/VerifyEmail.tsx`).
- Verify-email continuation now performs a transition-aware session refresh before frontend navigation (`nextPath` or MFA routes), and root-fallback continuation uses `/` (home policy resolver) instead of hard-routing to `/login`, preventing pre-bootstrap login flashes after successful verification (`lib/frontend-security/src/index.tsx`, `apps/admin/src/pages/auth/VerifyEmail.tsx`).
- MFA completion continuation now refreshes backend-authenticated session state and CSRF state before redirecting to resolved post-auth destinations, and MFA screens no longer force a local `/` fallback route after successful challenge/recovery (`lib/frontend-security/src/index.tsx`, `apps/admin/src/pages/auth/MfaChallenge.tsx`, `apps/admin/src/pages/auth/MfaEnroll.tsx`).
- MFA enrollment start is now idempotent-safe for already-enrolled users: `POST /api/auth/mfa/enroll/start` returns conflict when an active factor already exists instead of resetting it to pending, preventing accidental re-enrollment loops on subsequent logins (`apps/api-server/src/routes/auth.ts`, `apps/admin/src/pages/auth/MfaEnroll.tsx`, `apps/api-server/src/lib/mfa.ts`).
- MFA state decisions now expose explicit post-login MFA intent (`nextStep: mfa_enroll | mfa_challenge`) from backend login/verify-email responses and frontend honors that contract before fallback booleans; backend challenge eligibility also treats legacy enrolled factors (`enrolled_at` present and not disabled) as active to avoid false setup routing (`apps/api-server/src/routes/auth.ts`, `lib/frontend-security/src/index.tsx`, `apps/api-server/src/lib/mfa.ts`).
- Verify-email backend outcomes are now audit-logged through the existing `writeAuditLog` pipeline (`auth.verify_email`) for branch-level traceability (`apps/api-server/src/routes/auth.ts`, `apps/api-server/src/lib/audit.ts`).
- Login/signup/forgot-password email field validation now defers inline errors until blur/touch or submit, while signup password feedback renders progressively after typing by showing only missing policy requirements (8+ chars, uppercase, lowercase, number) (`apps/admin/src/pages/auth/Login.tsx`, `apps/admin/src/pages/auth/Signup.tsx`, `apps/admin/src/pages/auth/ForgotPassword.tsx`, `apps/admin/src/pages/auth/authValidation.ts`).

## Inferred
- Session/auth is backend-authoritative, with frontend consuming session state via shared provider and API client.

## Unclear
- Full auth provider roadmap and lifecycle policy documentation beyond current implementation files.

## Do not break
- Do not introduce app-local auth/session flows that bypass `lib/frontend-security`.
- Do not decouple auth/session handling from `apps/api-server` middleware pipeline.
