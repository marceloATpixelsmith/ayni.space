# 05 — Authentication and Session Architecture

## Scope
- This document defines architecture constraints for its domain using `docs/monorepo-overview.md` as baseline and concrete repository paths as evidence.

## Confirmed
- Backend authentication core is implemented in `apps/api-server/src/lib/auth.ts`.
- Authentication routes/session binding are implemented in `apps/api-server/src/routes/auth.ts`.
- Session lifecycle helpers are implemented in `apps/api-server/src/lib/session.ts` (canonicalized for store config, cookie options/clearing, session destruction, and logout-other-sessions cleanup).
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
- Backend app middleware composition runs through `apps/api-server/src/app.ts`, where session and security middleware ordering is centralized.
- Session middleware runtime provisioning is explicitly migration-managed (`createTableIfMissing=false`) and pinned to schema-qualified persistence (`platform.sessions`).

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
