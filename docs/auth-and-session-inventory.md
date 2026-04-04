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
- Auth/session middleware integration lives in `apps/api-server/src/app.ts`.
- `/api/auth/verify-email` remains a public, rate-limited endpoint but is exempt from Turnstile because emailed link possession is the verification proof and must not require an extra interactive challenge (`apps/api-server/src/lib/securityPolicy.ts`, `apps/api-server/src/routes/auth.ts`).
- Verification-link consumption now distinguishes token failure states (`invalid`, `expired`, `already_used`) at the API layer and frontend verification calls now acquire CSRF state before posting, preventing initial CSRF race failures from being mislabeled as token-invalid errors (`apps/api-server/src/routes/auth.ts`, `lib/frontend-security/src/index.tsx`, `apps/admin/src/pages/auth/VerifyEmail.tsx`).
- Login/signup/forgot-password email field validation now defers inline errors until blur/touch or submit, while signup password feedback renders progressively after typing by showing only missing policy requirements (8+ chars, uppercase, lowercase, number) (`apps/admin/src/pages/auth/Login.tsx`, `apps/admin/src/pages/auth/Signup.tsx`, `apps/admin/src/pages/auth/ForgotPassword.tsx`, `apps/admin/src/pages/auth/authValidation.ts`).

## Inferred
- Session/auth is backend-authoritative, with frontend consuming session state via shared provider and API client.

## Unclear
- Full auth provider roadmap and lifecycle policy documentation beyond current implementation files.

## Do not break
- Do not introduce app-local auth/session flows that bypass `lib/frontend-security`.
- Do not decouple auth/session handling from `apps/api-server` middleware pipeline.
