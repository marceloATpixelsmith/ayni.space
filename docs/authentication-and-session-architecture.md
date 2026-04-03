# 05 — Authentication and Session Architecture

## Scope
- This document defines architecture constraints for its domain using `docs/monorepo-overview.md` as baseline and concrete repository paths as evidence.

## Confirmed
- OAuth callback authorization now resolves active app context and normalized access profile before redirecting, then performs group-scoped denial cleanup on `access_denied` (`apps/api-server/src/routes/auth.ts`, `apps/api-server/src/lib/appAccess.ts`).
- OAuth start/callback continuation now supports a sanitized root-relative `returnToPath` (for example invitation acceptance URLs), carries it inside signed OAuth state, and prioritizes that continuation after successful callback session establishment (`apps/api-server/src/routes/auth.ts`, `apps/admin/src/pages/auth/Login.tsx`, `lib/frontend-security/src/index.tsx`).
- OAuth state now carries an encoded payload (`appSlug`, `returnTo`, `sessionGroup`, nonce) and callback validation fails closed when `appSlug` is missing or malformed, preventing callback authorization with incomplete app context (`apps/api-server/src/routes/auth.ts`).
- OAuth initiation accepts `intent` input, but callback redirect behavior is now explicitly intent-agnostic (no session `oauthIntent` plumbing).
- OAuth callback identity resolution now logs callback identity details, resolves users by `google_subject` first and email second, binds `google_subject` onto pre-provisioned rows when null, and denies unknown identities in `superadmin` access mode without auto-provisioning (`apps/api-server/src/routes/auth.ts`).
- Invitation acceptance UI now prevents duplicate turnstile-backed submissions for the same solved challenge and only resets the widget on turnstile-specific backend errors, preventing silent re-challenge loops (`apps/admin/src/pages/auth/InvitationAccept.tsx`, `lib/frontend-security/src/index.tsx`).

- Backend authentication core is implemented in `apps/api-server/src/lib/auth.ts`.
- Authentication routes/session binding are implemented in `apps/api-server/src/routes/auth.ts`.
- Session lifecycle helpers are implemented in `apps/api-server/src/lib/session.ts` (canonicalized for store config, cookie options/clearing, session destruction, and logout-other-sessions cleanup).
- Session cookie policy is centralized in `apps/api-server/src/lib/session.ts` with production-safe cross-origin defaults (`SameSite=None`, `Secure=true` in production) and explicit trace logging (`[AUTH-CHECK-TRACE] COOKIE CONFIG ...`).
- Session-group resolution and group-specific cookie naming are centralized in `apps/api-server/src/lib/sessionGroup.ts` and consumed by auth routes in `apps/api-server/src/routes/auth.ts`.
- Session issuance is request-scoped by group: `apps/api-server/src/lib/session.ts` now resolves the group per request (`origin`/`referer` allowlist, OAuth callback `state`, or single matching group cookie) and dispatches to a per-group `express-session` middleware with a group-specific cookie name.
- Session IDs are group-namespaced at issuance time (`<sessionGroup>.<uuid>` via `genid`) in `apps/api-server/src/lib/session.ts`, which prevents cross-group SID collisions in `platform.sessions` while still using one shared store table.
- Session group resolution fails closed for ambiguous multi-group cookie requests in sensitive flows (for example `/api/auth/logout`), preventing fallback to an arbitrary cookie when the request context is not trustworthy.
- Restricted app denial in OAuth callback now performs group-scoped cleanup: for the admin session group, non-super-admin users are redirected to `/login?error=access_denied` only after the admin-group session is destroyed and the admin-group cookie is cleared (`apps/api-server/src/routes/auth.ts`).
- Logout is group-scoped by default: `/api/auth/logout` resolves the current request's session group and only clears that group's cookie/session (`apps/api-server/src/routes/auth.ts`, `apps/api-server/src/lib/session.ts`).
- OAuth callback state now encodes the session group prefix (`<group>.<uuid>`), which allows callback session selection to remain correct even if a browser already has multiple group cookies.
- Session persistence is a shared platform concern and is stored in `platform.sessions` (migration-managed), not `public.sessions`.
- Session persistence queries that revoke other sessions are group-isolated (`sessionGroup` match) rather than user-global, preventing cross-group revocation from `logout-others`.
- Frontend auth state, bootstrap, and route gating are implemented in `lib/frontend-security/src/index.tsx`.
- CSRF-aware shared fetch path is implemented in `lib/api-client-react/src/custom-fetch.ts`.
- OAuth start return-origin resolution accepts trusted `origin`/`referer` and trusted forwarded host/proto headers (`x-forwarded-host`, `x-forwarded-proto`) before allowlist validation so reverse-proxied admin logins derive correct app context at initiation (`apps/api-server/src/routes/auth.ts`).
- Frontend auth/session calls are hard-pinned to credentialed fetch mode in shared clients (`/api/auth/*` and `/api/csrf-token` always use `credentials: "include"` in `lib/api-client-react/src/custom-fetch.ts` and `lib/frontend-security/src/index.tsx`).
- Backend app middleware composition runs through `apps/api-server/src/app.ts`, where session and security middleware ordering is centralized.
- Session middleware runtime provisioning is explicitly migration-managed (`createTableIfMissing=false`) and pinned to schema-qualified persistence (`platform.sessions`).

- OAuth callback app resolution is now strict: callback app context is derived from `state.appSlug` only, `getAppBySlug(appSlug)`/`getAppContext(userId, appSlug)` must succeed, and missing/invalid app slug state now returns explicit controlled login errors (`app_slug_invalid`, `app_not_found`, `app_context_unavailable`) instead of silent fallback redirects (`apps/api-server/src/routes/auth.ts`).
- Organization-mode create-account callbacks now redirect to root-relative onboarding (`/onboarding/organization`) via `apps/api-server/src/lib/postAuthRedirect.ts` instead of legacy generic `/onboarding`.
## Inferred
- Auth/session is designed as backend-authoritative with frontend providers/guards consuming backend session state.
- Session-group isolation is achieved end-to-end: cookie selection + cookie issuance + store revocation now all include group context, so unrelated groups are not globally logged out during denial/logout/revoke flows.
- Session rotation and active-org switching are tied to user/session flows (`apps/api-server/src/routes/users.ts` + `apps/api-server/src/lib/session.ts`).

## Unclear
- Full login method matrix and provider roadmap beyond current backend auth implementation.
- Whether any additional frontend shells (beyond admin) will share the same auth provider behavior.
- Whether future apps will require additional restricted session groups beyond `admin`.

## Intentional remaining gaps
- Session anomaly handling is currently observational (audit signal) and does not enforce adaptive/risk-based re-authentication.
- Rate limiting is currently in-process memory (production-safe defaults are in place, but no distributed/session-store-backed limiter yet).
- Turnstile remains intentionally targeted to public/high-risk auth entry points instead of blanket enforcement across every route.

## Do not break
- Do not move shared session storage out of `platform.sessions`; shared cross-app tables belong in `platform`, app-specific tables belong in app schemas.
- Do not bypass `lib/frontend-security` for auth gating in the admin frontend.
- Do not move auth/session logic outside the API server auth/session modules without updating route/middleware integration.
- Do not break CSRF/session coupling between `lib/frontend-security` and `lib/api-client-react/src/custom-fetch.ts`.
- Do not change middleware sequencing in `apps/api-server/src/app.ts` in ways that weaken auth/session enforcement.
