# 10 — Shared Systems Inventory

## Scope
- Inventory shared cross-cutting systems and their concrete locations.
- Canonical companions: `03`, `05`, `06`, `07`, `09`, `10`, `11`, `12`, `13` docs.

## Confirmed
- Auth/session systems:
  - `apps/api-server/src/lib/auth.ts`
  - `apps/api-server/src/routes/auth.ts`
  - `apps/api-server/src/lib/session.ts`
  - `lib/frontend-security/src/index.tsx`
- Authorization/access systems:
  - `apps/api-server/src/middlewares/requireAuth.ts`
  - `apps/api-server/src/middlewares/requireOrgAccess.ts`
  - `apps/api-server/src/middlewares/requireAppAccess.ts`
  - `apps/api-server/src/lib/appAccess.ts`
- Observability/error systems:
  - `apps/api-server/src/middlewares/observability.ts`
  - `lib/frontend-observability/src/index.tsx`
  - `lib/api-client-react/src/custom-fetch.ts`
- API contract/data systems:
  - `lib/api-spec/openapi.yaml`, `lib/api-spec/orval.config.ts`
  - `lib/api-client-react/src/index.ts`, `lib/api-zod/src/index.ts`
  - `lib/db/src/index.ts`, `lib/db/src/schema/*.ts`, `lib/db/migrations/*.sql`
- Transactional email Lane 2 foundation:
  - `lib/integrations/transactional-email/src/*`
  - `lib/db/src/schema/transactional_email.ts`
  - `lib/db/migrations/20260403_lane2_transactional_email_foundation.sql`

## Inferred
- Shared systems are centralized to keep security, observability, and data access behavior consistent across active apps.

## Unclear
- Which dormant or placeholder surfaces will eventually become first-class shared-system consumers.

## Do not break
- Do not duplicate shared systems into app-local forks without explicit architecture change.
- Do not bypass shared auth, observability, or DB layers for convenience.
