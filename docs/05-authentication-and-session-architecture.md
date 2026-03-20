# 05 — Authentication and Session Architecture

## Scope
- This document defines architecture constraints for its domain using `docs/01-monorepo-overview.md` as baseline and concrete repository paths as evidence.

## Confirmed
- Backend authentication core is implemented in `apps/api-server/src/lib/auth.ts`.
- Authentication routes/session binding are implemented in `apps/api-server/src/routes/auth.ts`.
- Session lifecycle helpers are implemented in `apps/api-server/src/lib/session.ts`.
- Frontend auth state, bootstrap, and route gating are implemented in `lib/frontend-security/src/index.tsx`.
- CSRF-aware shared fetch path is implemented in `lib/api-client-react/src/custom-fetch.ts`.
- Backend app middleware composition runs through `apps/api-server/src/app.ts`, where session and security middleware ordering is centralized.

## Inferred
- Auth/session is designed as backend-authoritative with frontend providers/guards consuming backend session state.
- Session rotation and active-org switching are tied to user/session flows (`apps/api-server/src/routes/users.ts` + `apps/api-server/src/lib/session.ts`).

## Unclear
- Full login method matrix and provider roadmap beyond current backend auth implementation.
- Whether any additional frontend shells (beyond admin) will share the same auth provider behavior.

## Do not break
- Do not bypass `lib/frontend-security` for auth gating in the admin frontend.
- Do not move auth/session logic outside the API server auth/session modules without updating route/middleware integration.
- Do not break CSRF/session coupling between `lib/frontend-security` and `lib/api-client-react/src/custom-fetch.ts`.
- Do not change middleware sequencing in `apps/api-server/src/app.ts` in ways that weaken auth/session enforcement.
