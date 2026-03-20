# 09 — API and Backend Architecture

## Confirmed
- Backend runtime entrypoint is `apps/api-server/src/index.ts`.
- API app composition and middleware ordering are centralized in `apps/api-server/src/app.ts`.
- API route aggregation is centralized via `apps/api-server/src/routes/index.ts` and route modules in `apps/api-server/src/routes/*`.
- Request path is implemented as: frontend -> API client/fetch layer -> API routes -> `@workspace/db` -> PostgreSQL.
- The API server is the single active backend gateway in current repository state.

## Inferred
- The backend is intentionally a single service boundary for auth, org, app-access, and operational middleware concerns.
- Route/middleware centralization is intended to keep cross-cutting controls (security, CSRF, observability) consistent.

## Unclear
- Whether backend decomposition into multiple services is planned.
- Whether placeholder apps will eventually require dedicated backend runtime boundaries.

## Do not break
- Do not bypass `apps/api-server/src/app.ts` as the central middleware composition point.
- Do not split route registration away from `apps/api-server/src/routes/index.ts` without explicit architecture change.
- Do not introduce alternate backend entrypoints that circumvent existing security/observability middleware ordering.
- Do not bypass `@workspace/db` for backend data access.
