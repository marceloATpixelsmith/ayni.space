# 07 — Tenant Isolation and Data Ownership

## Scope
- This document defines architecture constraints for its domain using `docs/01-monorepo-overview.md` as baseline and concrete repository paths as evidence.

## Confirmed
- Tenant/org domain routes are implemented in:
  - `apps/api-server/src/routes/organizations.ts`
  - `apps/api-server/src/routes/invitations.ts`
  - `apps/api-server/src/routes/subscriptions.ts`
  - `apps/api-server/src/routes/users.ts` (active org switching)
- Session context and rotation support org scoping in `apps/api-server/src/lib/session.ts`.
- Tenant ownership structures are represented in DB schema tables:
  - `lib/db/src/schema/organizations.ts`
  - `lib/db/src/schema/memberships.ts`
  - `lib/db/src/schema/users.ts`
- API server uses shared DB layer via `@workspace/db`.

## Inferred
- Tenant isolation is enforced through membership/org context resolution before resource access.
- Data ownership boundaries are modeled around org membership and app access checks.

## Unclear
- Exact cross-tenant data sharing policy (if any) beyond current membership/app-access middleware.
- Whether future app directories (`apps/ayni`, `apps/shipibo`, `apps/screening`) will use identical tenancy patterns.

## Do not break
- Do not bypass org membership and app access checks when adding tenant-scoped routes.
- Do not access tenant data without org/user context established by auth/session + middleware stack.
- Do not introduce parallel DB access paths that skip `@workspace/db` ownership conventions.
- Do not change session org-switch semantics without reviewing downstream authz and tenant-route effects.
