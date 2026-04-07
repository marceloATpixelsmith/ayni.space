# 11 — Security Standards and Non-Negotiables

## Scope
- This document defines architecture constraints for its domain using `docs/monorepo-overview.md` as baseline and concrete repository paths as evidence.

## Confirmed
- Security-critical controls are centralized in API middleware stack (`apps/api-server/src/app.ts`) including security headers, CORS, CSRF, origin/referer checks, and auth/session middleware integration.
- Proxy trust for backend client-IP derivation is explicit in app bootstrap (`trust proxy` only when expected in production), and abuse/rate-limit identity derives from `req.ip` so raw forwarded headers are not trusted directly by auth abuse controls (`apps/api-server/src/app.ts`, `apps/api-server/src/middlewares/rateLimit.ts`, `apps/api-server/src/lib/authAbuse.ts`).
- Origin/referer protection now denies unsafe requests missing both headers by default, with explicit machine exception only for Stripe webhook ingestion (`apps/api-server/src/middlewares/csrf.ts`).
- Authorization controls are middleware-based (`requireAuth`, `requireOrgAccess`, `requireAppAccess`, plus overview-listed `requireOrgAdmin` and `requireSuperAdmin`).
- Central security classification includes explicit ADMIN mapping for privileged non-`/api/admin` user suspend/unsuspend routes to prevent accidental under-classification (`apps/api-server/src/lib/securityPolicy.ts`).
- Frontend security layer is centralized in `lib/frontend-security/src/index.tsx` with related Turnstile support in `lib/frontend-security/src/turnstile.tsx`.
- Shared CSRF-aware API client behavior is in `lib/api-client-react/src/custom-fetch.ts`.
- Shared DB client configuration now enforces CA/certificate validation in production (`ssl.rejectUnauthorized=true`) and keeps non-production behavior explicit (`ssl=false`) in `lib/db/src/index.ts`.
- Overview non-negotiables explicitly require middleware-driven auth/authz and continued use of shared frontend security layer.

## Inferred
- Security posture depends on preserving centralized middleware ordering and shared client security behavior.
- Security consistency across routes/frontends is achieved through shared libraries, not duplicated per-app logic.

## Unclear
- Formal policy baselines (e.g., external compliance mapping) are not defined in current docs.
- Whether additional app shells will have stricter/different security hardening requirements.

## Do not break
- Do not weaken CSRF/origin/referer enforcement path in API middleware.
- Do not bypass shared `frontend-security` provider/guards in admin.
- Do not implement protected backend endpoints without auth and scope middleware.
- Do not introduce parallel auth/session flows outside established API/server and shared frontend-security modules.
