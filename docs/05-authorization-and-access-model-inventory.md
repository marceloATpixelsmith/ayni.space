# 05 — Authorization and Access Model Inventory

## Scope
- Inventory backend authorization boundaries and access enforcement locations.
- Canonical companion: `docs/06-authorization-roles-and-access-model.md`.

## Confirmed
- Core middleware files:
  - `apps/api-server/src/middlewares/requireAuth.ts`
  - `apps/api-server/src/middlewares/requireOrgAccess.ts`
  - `apps/api-server/src/middlewares/requireAppAccess.ts`
- App access helper: `apps/api-server/src/lib/appAccess.ts`.
- Route registration integration point: `apps/api-server/src/routes/*` via `apps/api-server/src/routes/index.ts`.
- Overview non-negotiable role of middleware remains explicit in `docs/01-monorepo-overview.md`.

## Inferred
- Authz is layered via middleware composition rather than ad hoc per-handler checks.

## Unclear
- Canonical role taxonomy documentation is still not centralized in a single policy file.

## Do not break
- Do not remove middleware-first authorization pattern.
- Do not add protected routes without explicit auth + scope checks.
