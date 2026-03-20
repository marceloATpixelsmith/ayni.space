# 08 — Tenant Isolation and Data Ownership Inventory

## Scope
- Inventory tenant/org boundaries and ownership-related schema/routes.
- Canonical companion: `docs/10-tenant-isolation-and-data-ownership.md`.

## Confirmed
- Tenant/org routes:
  - `apps/api-server/src/routes/organizations.ts`
  - `apps/api-server/src/routes/invitations.ts`
  - `apps/api-server/src/routes/subscriptions.ts`
  - `apps/api-server/src/routes/users.ts`
- Session context and org switching: `apps/api-server/src/lib/session.ts`.
- Core tenant ownership tables:
  - `lib/db/src/schema/organizations.ts`
  - `lib/db/src/schema/memberships.ts`
  - `lib/db/src/schema/users.ts`
- Shared DB access path: `lib/db/src/index.ts` via `@workspace/db`.

## Inferred
- Tenant isolation is enforced through org membership/app-access checks plus session context.

## Unclear
- Future tenancy patterns for placeholder apps remain undefined.

## Do not break
- Do not bypass org/membership checks for tenant-scoped data access.
- Do not introduce direct DB access patterns outside `@workspace/db`.
