# 01 — Monorepo Overview (DRAFT)

## Confirmed from code

### Workspace topology (exhaustive)
- Workspace package globs are exactly:
  - `apps/*`
  - `lib/*`
  - `packages/*`
  - `lib/integrations/*`
  - `scripts`.
  (Source: `pnpm-workspace.yaml`.)
- Actual directories currently matching those roots:
  - `apps/`: `admin`, `api-server`, `mockup-sandbox`, `ayni`, `shipibo`, `screening`.
  - `lib/`: `api-client-react`, `api-spec`, `api-zod`, `db`, `frontend-observability`, `frontend-security`.
  - `packages/`: `auth`, `config`, `opentelemetry-instrumentation-http`, `security`, `types`, `ui`.
  - `scripts/` present and workspace-enabled.
  - `lib/integrations/` is referenced by workspace config but does not exist in the repository.

### App inventory with implementation status
- `apps/api-server` — **active**:
  - Own `package.json` + scripts (`dev`, `build`, `typecheck`).
  - Has full source tree (`src/app.ts`, routes, middlewares, auth/session/rbac/app-access libs).
  - Consumed by root scripts (`pnpm dev` points to api-server) and shared architecture docs/readme.
- `apps/admin` — **active**:
  - Own `package.json` + app scripts + security-shell test.
  - Uses shared workspace libs (`@workspace/api-client-react`, `@workspace/frontend-security`, `@workspace/frontend-observability`) via `vite.config.ts`, `tsconfig.json`, and runtime imports in `src/App.tsx` / pages.
  - Covered by CI workflow `admin-security-shell-test-and-deploy.yml`.
- `apps/mockup-sandbox` — **partially implemented**:
  - Own `package.json` + Vite scripts + source tree.
  - Uses `@workspace/frontend-observability` in deps and aliases.
  - No references in CI workflows, no root scripts, and no import/use from other apps.
- `apps/ayni` — **placeholder** (`.gitkeep` only).
- `apps/shipibo` — **placeholder** (`.gitkeep` only).
- `apps/screening` — **placeholder** (`.gitkeep` only).

### `lib/*` directories and real usage
- `lib/db` (`@workspace/db`) — real shared data layer:
  - Imported broadly by `apps/api-server` route/middleware/lib files and by `scripts/src/seed.ts`.
- `lib/api-client-react` (`@workspace/api-client-react`) — real shared client layer:
  - Imported by admin pages/components and by `lib/frontend-security`.
- `lib/api-zod` (`@workspace/api-zod`) — partially used shared contract layer:
  - Imported in `apps/api-server/src/routes/health.ts`.
- `lib/frontend-security` (`@workspace/frontend-security`) — real shared frontend security/auth layer:
  - Imported by admin app shell/pages (`src/App.tsx`, auth/onboarding/invitation pages, layout).
- `lib/frontend-observability` (`@workspace/frontend-observability`) — real shared frontend monitoring layer:
  - Imported by admin bootstrap/components and used in `apps/mockup-sandbox` dependency/alias config.
- `lib/api-spec` (`@workspace/api-spec`) — spec/codegen source layer:
  - Provides `codegen` script (`orval --config ./orval.config.ts`); not runtime-imported by apps.

### `packages/*` directories and real usage
- `packages/opentelemetry-instrumentation-http` (named `@opentelemetry/instrumentation-http`) — workspace package used as dependency by `apps/api-server/package.json`; implementation is local CommonJS stub (`index.js`).
- `packages/types` (`@workspace/types`) — defines app/tenancy/access types in `src/index.ts`; no imports found across apps/libs/scripts.
- `packages/auth`, `packages/config`, `packages/security`, `packages/ui` — each has package + tsconfig + `src/index.ts` exporting `{}` only; no imports found across apps/libs/scripts.

### Dependency/workspace architecture (actual flow)
- **apps → lib**
  - `api-server` → `@workspace/db`, `@workspace/api-zod` (package deps + source imports).
  - `admin` → `@workspace/api-client-react`, `@workspace/frontend-security`, `@workspace/frontend-observability`.
  - `mockup-sandbox` → `@workspace/frontend-observability`.
- **apps → packages**
  - `api-server` → `@opentelemetry/instrumentation-http` (workspace package).
  - `admin`, `mockup-sandbox` have no direct `@workspace/*` package deps under `packages/`.
- **lib → lib**
  - `frontend-security` → `api-client-react`.
  - Other `lib/*` units are mostly leafs from app perspective (`db`, `api-zod`, `frontend-observability`, `api-client-react`).
- **scripts → lib**
  - `scripts` depends on `@workspace/db` and imports its tables/db client for seeding.

### Shared system implementation locations (concrete)
- **Authentication**:
  - OAuth + login callback/session binding: `apps/api-server/src/routes/auth.ts`, `apps/api-server/src/lib/auth.ts`.
  - Session middleware: `apps/api-server/src/lib/session.ts`.
  - Frontend auth provider + route guard: `lib/frontend-security/src/index.tsx`.
- **Authorization / access control**:
  - Authn/authz middleware: `apps/api-server/src/middlewares/requireAuth.ts`, `requireOrgAccess.ts`, `requireAppAccess.ts`.
  - App access logic: `apps/api-server/src/lib/appAccess.ts`.
- **Tenant / org scoping**:
  - Org membership and role lookup: `apps/api-server/src/lib/rbac.ts`, org routes in `apps/api-server/src/routes/organizations.ts`.
  - Active org switching/session rotation: `apps/api-server/src/routes/users.ts`, `apps/api-server/src/lib/session.ts`.
  - Core tenant tables: `lib/db/src/schema/organizations.ts`, `memberships.ts`, `users.ts`.
- **Frontend security layer**:
  - CSRF fetch/bootstrap + provider wiring + guarded rendering + turnstile hook export: `lib/frontend-security/src/index.tsx`, `lib/frontend-security/src/turnstile.tsx`.
  - CSRF-aware shared fetch: `lib/api-client-react/src/custom-fetch.ts`.
- **Observability / error handling / Sentry**:
  - Backend Sentry and correlation IDs: `apps/api-server/src/middlewares/observability.ts`.
  - API error shape and robust response parsing: `lib/api-client-react/src/custom-fetch.ts`.
  - Frontend monitoring abstraction and error boundary: `lib/frontend-observability/src/index.tsx`.
- **API contract generation**:
  - OpenAPI source/config: `lib/api-spec/openapi.yaml`, `lib/api-spec/orval.config.ts`.
  - Generated client exports: `lib/api-client-react/src/index.ts` (re-exporting generated files).
  - Generated zod/types exports: `lib/api-zod/src/index.ts`.
- **Database access layer**:
  - DB client/pool export: `lib/db/src/index.ts`.
  - Schema modules: `lib/db/src/schema/*.ts`.
  - Migration file(s): `lib/db/migrations/*.sql`.

### CI/CD enforcement and deploy assumptions (actual)
- `lockfile-sync-check.yml` enforces `pnpm install --frozen-lockfile` on PRs touching package manifests/workspace/lockfile; assumes workspace graph remains installable with single root lockfile.
- `admin-security-shell-test-and-deploy.yml` enforces only admin security shell test (`pnpm --filter @workspace/admin run test:security-shell`) and deploy hook on push to `master`; assumes admin app is the deploy-gated frontend surface.
- `codex-auto-promote.yml` force-resets `master` to qualifying codex PR branch head; assumes this governance model is intentional and safe.

### Directly observable unused or weakly wired areas
- `lib/integrations/*` workspace path is configured but missing on disk.
- `apps/ayni`, `apps/shipibo`, `apps/screening` have no source beyond `.gitkeep`.
- `packages/auth`, `packages/config`, `packages/security`, `packages/ui`, `packages/types` are not imported by apps/libs/scripts.
- `apps/mockup-sandbox` is self-contained but not referenced by root scripts or workflows.

## Strong inference from code structure

### App architecture reality check
- `apps/admin` is not “super-admin only”; it is a **hybrid tenant + platform-admin UI shell**:
  - tenant routes under `/dashboard/*` and `/apps/*`,
  - platform admin route under `/admin`.
  (Confirmed by route map in `apps/admin/src/App.tsx` and layout behavior in `components/layout/AppLayout.tsx`.)
- `apps/api-server` is a **single shared backend boundary** for platform and app modules:
  - central auth/session/security middleware in `src/app.ts`,
  - modular routers mounted in `src/routes/index.ts`.
- `apps/mockup-sandbox` functions as an **experimental/prototyping app surface** because it has full UI toolchain but no integration into CI/deploy/root command entrypoints.
- Placeholder app directories under `apps/` indicate planned separation of app frontends, while current runtime app UX is still delivered through admin routes.

### Layer boundary interpretation (`lib` vs `packages`)
- Current implementation shows `lib/*` as the operational shared layer and `packages/*` as mostly dormant/placeholder, with one notable exception (`packages/opentelemetry-instrumentation-http`).
- This is an **inconsistent pattern in practice** rather than a strongly enforced architecture boundary:
  - root TS references point to `lib/*` only,
  - runtime imports resolve mainly through `lib/*`,
  - most `packages/*` are structurally present but functionally idle.

### Architecture Reality vs Intended Direction
- **Implemented and working now**:
  - one shared API backend (`apps/api-server`),
  - one production-oriented frontend shell (`apps/admin`),
  - shared DB/access/auth/observability/client systems in `lib/*`.
- **Planned but incomplete signals**:
  - placeholder app directories (`apps/ayni`, `apps/shipibo`, `apps/screening`),
  - workspace slot for `lib/integrations/*`,
  - dormant foundational `packages/*`.
- **Inconsistent/drifting signals**:
  - mixed `lib` vs `packages` strategy without enforcement,
  - mockup app exists with no delivery pipeline,
  - CI focuses on admin shell only while repo contains broader platform surface.

## Unclear / requires confirmation
- Whether `apps/mockup-sandbox` should become a supported app with CI/deploy coverage or remain local-only experimentation.
- Whether placeholder app directories are committed roadmap items vs reserved namespace.
- Whether `packages/*` (except instrumentation-http) are intended future extraction targets or should be removed until needed.
- Whether `lib/integrations/*` should exist now (missing directory vs stale workspace config).
- Whether `@workspace/types` should be integrated into runtime/shared libs or remain dormant.

## Critical shared systems locations
- Authentication/session: `apps/api-server/src/routes/auth.ts`, `apps/api-server/src/lib/auth.ts`, `apps/api-server/src/lib/session.ts`, `lib/frontend-security/src/index.tsx`.
- Authorization/access control: `apps/api-server/src/middlewares/requireAuth.ts`, `requireOrgAccess.ts`, `requireAppAccess.ts`, `apps/api-server/src/lib/appAccess.ts`.
- Tenant/org scoping: `apps/api-server/src/routes/organizations.ts`, `apps/api-server/src/routes/users.ts`, `lib/db/src/schema/organizations.ts`, `memberships.ts`, `users.ts`.
- Frontend security layer: `lib/frontend-security/src/index.tsx`, `lib/frontend-security/src/turnstile.tsx`, `lib/api-client-react/src/custom-fetch.ts`.
- Observability/Sentry/error handling: `apps/api-server/src/middlewares/observability.ts`, `lib/frontend-observability/src/index.tsx`, `lib/api-client-react/src/custom-fetch.ts`.
- API contracts/codegen: `lib/api-spec/openapi.yaml`, `lib/api-spec/orval.config.ts`, `lib/api-client-react/src/index.ts`, `lib/api-zod/src/index.ts`.
- Database access: `lib/db/src/index.ts`, `lib/db/src/schema/*.ts`, `lib/db/migrations/*.sql`.

## Potential architectural risks
- Dormant workspace slices (`packages/*`, `apps/*` placeholders, missing `lib/integrations/*`) can create false confidence in capabilities not yet implemented.
- CI coverage is narrow (lockfile + admin security shell test) relative to the full backend/platform surface.
- Boundary drift (`lib` vs `packages`) increases risk of duplicated or fragmented shared concerns.
- Local stub package for `@opentelemetry/instrumentation-http` may mask observability expectations if treated as full instrumentation.

## Open questions requiring user confirmation
- Should we treat `apps/admin` as the long-term single shell, or split app frontends into separate active `apps/*` projects?
- Should `apps/mockup-sandbox` be promoted into CI/deploy scope, archived, or removed?
- Which `packages/*` are strategic and should be activated vs deleted?
- Do you want `lib/integrations/*` created and used now, or removed from workspace config until needed?
- Do you want a stricter architectural rule documented/enforced for where shared code must live (`lib` only, `packages` only, or split by concern)?
