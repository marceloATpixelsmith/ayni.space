# Monorepo Overview

## Scope
- Canonical architecture baseline for this repository.
- All other architecture docs must align to this document unless code changes establish a new baseline.

## Confirmed

### Workspace topology (exhaustive)
- Workspace package globs in `pnpm-workspace.yaml` are exactly:
  - `apps/*`
  - `lib/*`
  - `packages/*`
  - `lib/integrations/*`
  - `scripts`.
- Actual directories currently present under those roots:
  - `apps/`: `admin`, `api-server`, `mockup-sandbox`, `ayni`, `shipibo`, `screening`.
  - `lib/`: `api-client-react`, `api-spec`, `api-zod`, `db`, `frontend-observability`, `frontend-security`.
  - `packages/`: `auth`, `config`, `opentelemetry-instrumentation-http`, `security`, `types`, `ui`.
  - `scripts/` exists and has its own workspace package.
- `lib/integrations/*` is configured in workspace globs but no `lib/integrations` directory exists in the repository.

### App inventory with implementation status
- `apps/api-server` — **active**:
  - Has executable scripts in `apps/api-server/package.json` (`dev`, `build`, `typecheck`).
  - Has runtime source and route stack in `apps/api-server/src`.
  - Is the default root dev target (`package.json` root script: `pnpm --filter api-server dev`).
- `apps/admin` — **active**:
  - Has executable scripts in `apps/admin/package.json` including `test:security-shell`.
  - Is wired to shared runtime libs via both alias config and imports:
    - aliases in `apps/admin/vite.config.ts`, `apps/admin/tsconfig.json`,
    - runtime imports in `apps/admin/src/main.tsx`, `apps/admin/src/App.tsx`, dashboard/auth pages.
  - Is explicitly targeted by CI in `.github/workflows/admin-security-shell-test-and-deploy.yml`.
- `apps/mockup-sandbox` — **partially implemented**:
  - Has runnable Vite scripts and source tree (`apps/mockup-sandbox/package.json`, `src/`).
  - Has alias/dependency wiring only to `@workspace/frontend-observability`.
  - Has no references in root scripts and no CI workflow targeting it.
- `apps/ayni` — **placeholder** (`apps/ayni/.gitkeep` only).
- `apps/shipibo` — **placeholder** (`apps/shipibo/.gitkeep` only).
- `apps/screening` — **placeholder** (`apps/screening/.gitkeep` only).

### `lib/*` directories and real usage
- `lib/db` (`@workspace/db`) — runtime shared data layer:
  - Imported in API server routes/libs/middleware (for example `apps/api-server/src/routes/*.ts`, `apps/api-server/src/lib/*.ts`, `apps/api-server/src/middlewares/requireAuth.ts`).
  - Imported in script tooling (`scripts/src/seed.ts`).
- `lib/api-client-react` (`@workspace/api-client-react`) — runtime shared client/hooks layer:
  - Imported across admin pages and shell.
  - Imported by `lib/frontend-security/src/index.tsx`.
- `lib/api-zod` (`@workspace/api-zod`) — runtime shared schema layer with narrow current usage:
  - Imported by `apps/api-server/src/routes/health.ts`.
- `lib/frontend-security` (`@workspace/frontend-security`) — runtime shared frontend auth/security layer:
  - Imported by `apps/admin/src/App.tsx`, `apps/admin/src/components/layout/AppLayout.tsx`, and auth/dashboard pages.
- `lib/frontend-observability` (`@workspace/frontend-observability`) — runtime shared frontend monitoring layer:
  - Imported by `apps/admin/src/main.tsx`, `apps/admin/src/App.tsx`, and pages.
  - Referenced by `apps/mockup-sandbox` dependency + alias config.
- `lib/api-spec` (`@workspace/api-spec`) — build-time spec/codegen source:
  - Contains OpenAPI source and Orval config.
  - Invoked via `codegen` script; not imported by app runtime code.

### `packages/*` directories and real usage
- `packages/opentelemetry-instrumentation-http` (`@opentelemetry/instrumentation-http`):
  - Declared as dependency by `apps/api-server/package.json`.
  - Local implementation exists at `packages/opentelemetry-instrumentation-http/index.js`.
  - No source import in `apps/api-server/src` references it directly.
- `packages/types` (`@workspace/types`):
  - Exports concrete app/tenancy/access types in `packages/types/src/index.ts`.
  - No imports found across `apps/`, `lib/`, or `scripts/`.
- `packages/auth`, `packages/config`, `packages/security`, `packages/ui`:
  - Each has package metadata and `src/index.ts` exporting `{}`.
  - No imports found across `apps/`, `lib/`, or `scripts/`.

### Dependency/workspace architecture (actual flow)
- **apps → lib (runtime)**
  - `apps/api-server` → `@workspace/db`, `@workspace/api-zod`.
  - `apps/admin` → `@workspace/api-client-react`, `@workspace/frontend-security`, `@workspace/frontend-observability`.
  - `apps/mockup-sandbox` → `@workspace/frontend-observability`.
- **apps → packages**
  - `apps/api-server` → `@opentelemetry/instrumentation-http` declared dependency.
  - No `apps/*` package depends on `@workspace/auth`, `@workspace/config`, `@workspace/security`, `@workspace/types`, or `@workspace/ui`.
- **lib → lib**
  - `lib/frontend-security` imports `@workspace/api-client-react`.
  - Other `lib/*` modules are consumed by apps/scripts and do not import each other broadly.
- **scripts → lib**
  - `scripts` depends on and imports `@workspace/db` for seeding.

### Shared system implementation locations (concrete)
- **Authentication**
  - Backend OAuth: `apps/api-server/src/lib/auth.ts`.
  - Backend auth routes/session binding: `apps/api-server/src/routes/auth.ts`.
  - Frontend auth state and gating: `lib/frontend-security/src/index.tsx`.
- **Authorization / access control**
  - User/super-admin checks: `apps/api-server/src/middlewares/requireAuth.ts`.
  - Org role checks: `apps/api-server/src/middlewares/requireOrgAccess.ts`.
  - App access checks: `apps/api-server/src/middlewares/requireAppAccess.ts`, `apps/api-server/src/lib/appAccess.ts`.
- **Tenant / org scoping**
  - Org APIs and membership-scoped routes: `apps/api-server/src/routes/organizations.ts`, `apps/api-server/src/routes/invitations.ts`, `apps/api-server/src/routes/subscriptions.ts`.
  - Active org switching and session rotation: `apps/api-server/src/routes/users.ts`, `apps/api-server/src/lib/session.ts`.
  - Tenant tables: `lib/db/src/schema/organizations.ts`, `memberships.ts`, `users.ts`.
- **Frontend security layer**
  - Auth provider + CSRF bootstrap + route guard: `lib/frontend-security/src/index.tsx`.
  - Turnstile frontend hook: `lib/frontend-security/src/turnstile.tsx`.
  - CSRF-aware shared fetch: `lib/api-client-react/src/custom-fetch.ts`.
- **Observability / error handling / Sentry**
  - Backend Sentry + correlation ID + ingest: `apps/api-server/src/middlewares/observability.ts`.
  - Backend middleware wiring order: `apps/api-server/src/app.ts`.
  - Frontend monitoring boundary/capture: `lib/frontend-observability/src/index.tsx`.
  - Shared API error object and parse behavior: `lib/api-client-react/src/custom-fetch.ts`.
- **API contract generation**
  - Contract source: `lib/api-spec/openapi.yaml`.
  - Codegen config: `lib/api-spec/orval.config.ts`.
  - Generated client export surface: `lib/api-client-react/src/index.ts`.
  - Generated zod/types export surface: `lib/api-zod/src/index.ts`.
- **Database access layer**
  - DB pool + drizzle client: `lib/db/src/index.ts`.
  - DB schema: `lib/db/src/schema/*.ts`.
  - SQL migration(s): `lib/db/migrations/*.sql`.

### CI/CD enforcement and deploy assumptions (actual)
- `.github/workflows/lockfile-sync-check.yml`:
  - Enforces lockfile/install consistency by running `pnpm install --frozen-lockfile`.
  - Trigger assumes monorepo dependencies are represented by root lockfile + workspace manifests.
- `.github/workflows/admin-security-shell-test-and-deploy.yml`:
  - Enforces admin shell contract test (`pnpm --filter @workspace/admin run test:security-shell`) and frontend build (`pnpm --filter @workspace/admin run build`).
  - Workflow path filters target `apps/admin/**`, shared frontend libs, and lock/workspace metadata.
- `.github/workflows/backend-regression-gates.yml`:
  - Enforces backend install integrity, build, typecheck, backend route/middleware regression tests, and API codegen artifact validation for backend-affecting changes.

### Runtime entry points and flow
- **Backend entry point**: `apps/api-server/src/index.ts`.
  - Performs env checks and starts server.
  - Imports app composition from `apps/api-server/src/app.ts`.
- **Backend app composition**: `apps/api-server/src/app.ts`.
  - Middleware order is explicit: correlation ID → Sentry request handler → security headers → CORS → body parsing/raw webhook → session → rate-limit mounts → monitoring endpoints → CSRF → origin/referer checks → `/api` router → Sentry error handlers.
- **Frontend entry point**: `apps/admin/src/main.tsx`.
  - Initializes frontend monitoring, then renders `App`.
- **Frontend app shell**: `apps/admin/src/App.tsx`.
  - Wrap order: QueryClientProvider → MonitoringErrorBoundary → AuthProvider → Router.
- **Request flow (implemented path)**
  - Browser/UI (`apps/admin`) → API calls through generated hooks/custom fetch (`@workspace/api-client-react`) → Express route handlers (`apps/api-server/src/routes/*`) → Drizzle DB layer (`@workspace/db`) → PostgreSQL.

### Build and runtime coupling
- **Runtime-coupled app dependencies**
  - `apps/admin` runtime depends on `lib/api-client-react`, `lib/frontend-security`, `lib/frontend-observability`.
  - `apps/api-server` runtime depends on `lib/db` and route/middleware libs; `lib/api-zod` is currently used for health response parsing.
- **Build-time-only layers**
  - `lib/api-spec` is build-time contract source for Orval code generation.
- **Generated artifact coupling**
  - Admin and frontend-security consume generated outputs re-exported by `lib/api-client-react/src/index.ts`.
  - API-side zod/types are re-exported by `lib/api-zod/src/index.ts`.
- **Fragile coupling points**
  - Admin uses source alias mapping in `apps/admin/vite.config.ts` / `apps/admin/tsconfig.json` directly to `lib/*/src` rather than built package output.
  - `apps/mockup-sandbox` also aliases directly into `lib/frontend-observability/src`.

### Actual enforced boundaries vs implied boundaries
- **Enforced by code/config**
  - API boundary is centralized through `apps/api-server/src/app.ts` and `routes/index.ts` mount structure.
  - Authz boundary is enforced via middleware (`requireAuth`, `requireOrgAccess`, `requireOrgAdmin`, `requireSuperAdmin`, `requireAppAccess`) applied at route registration points.
  - Workspace membership is enforced by pnpm workspace globs in `pnpm-workspace.yaml`.
- **Implied / convention-only boundaries**
  - `lib` vs `packages` separation is not enforced by any lint/build rule; runtime usage concentrates in `lib` while most `packages` remain dormant.
  - Placeholder app directories (`apps/ayni`, `apps/shipibo`, `apps/screening`) imply future decomposition but have no runtime/build enforcement.
  - `lib/integrations/*` is implied by workspace config but absent on disk.

### Directly observable unused or weakly wired areas
- `lib/integrations/*` path is declared in workspace configuration but missing.
- `apps/ayni`, `apps/shipibo`, `apps/screening` contain only `.gitkeep` and are not wired into runtime or CI.
- `packages/auth`, `packages/config`, `packages/security`, `packages/ui`, and `packages/types` are not imported by application/runtime code.
- `apps/mockup-sandbox` is runnable but disconnected from root scripts and workflows.

### Non-negotiable invariants
- API runtime entry remains centralized in `apps/api-server` (`src/index.ts` + `src/app.ts` + `src/routes/index.ts`).
- Authentication and authorization stay middleware-driven in API request handling (`requireAuth`, `requireOrgAccess`, `requireOrgAdmin`, `requireSuperAdmin`, `requireAppAccess`).
- Admin frontend continues to use shared frontend security and observability layers (`@workspace/frontend-security`, `@workspace/frontend-observability`).
- Database access for app/server/script paths continues through `@workspace/db` rather than ad hoc DB clients inside apps.
- Workspace lockfile integrity remains rooted at repository root (`pnpm-lock.yaml`) and validated against workspace manifests.

## Inferred

### Strong inference from code structure

### App architecture reality check
- `apps/admin` functions as a hybrid tenant workspace + platform-admin UI because route table in `apps/admin/src/App.tsx` includes `/dashboard/*`, `/apps/*`, and `/admin`.
- `apps/api-server` functions as the single backend gateway for platform and app modules because all API surfaces are mounted in one router tree (`apps/api-server/src/routes/index.ts`) and one app bootstrap (`apps/api-server/src/app.ts`).
- Placeholder app directories represent planned expansion capacity; this remains inference about roadmap because no implementation files or references define activation criteria.

### Layer boundary interpretation (`lib` vs `packages`)
- `lib/*` is the current operational shared layer; this is confirmed by direct imports from apps/scripts.
- Any intent to migrate or split toward `packages/*` remains inference because repository contains dormant package shells without runtime consumers.

### Architecture Reality vs Intended Direction
- **Implemented and working now**
  - One API backend (`apps/api-server`) and one primary frontend shell (`apps/admin`) with shared runtime libs under `lib/*`.
- **Planned but incomplete**
  - Placeholder app directories and absent `lib/integrations/*` implementation.
  - Dormant `packages/*` modules (except instrumentation-http stub package).
- **Inconsistent/drifting**
  - Shared code location strategy is mixed (`lib` active, `packages` mostly inactive) without enforcement.

## Unclear / requires confirmation
- Whether `apps/mockup-sandbox` is intended to become a supported product surface or remain local prototyping only.
- Whether `apps/ayni`, `apps/shipibo`, and `apps/screening` are planned near-term deliverables or namespace reservations.
- Whether dormant `packages/*` should be activated, consolidated into `lib/*`, or removed.
- Whether `lib/integrations/*` should be implemented now or removed from workspace globs.
- Whether `@workspace/types` should remain independent or be integrated into active runtime/shared layers.

## Critical shared systems locations
- Authentication/session: `apps/api-server/src/lib/auth.ts`, `apps/api-server/src/routes/auth.ts`, `apps/api-server/src/lib/session.ts`, `lib/frontend-security/src/index.tsx`.
- Authorization/access control: `apps/api-server/src/middlewares/requireAuth.ts`, `apps/api-server/src/middlewares/requireOrgAccess.ts`, `apps/api-server/src/middlewares/requireAppAccess.ts`, `apps/api-server/src/lib/appAccess.ts`.
- Tenant/org scoping: `apps/api-server/src/routes/organizations.ts`, `apps/api-server/src/routes/users.ts`, `lib/db/src/schema/organizations.ts`, `lib/db/src/schema/memberships.ts`, `lib/db/src/schema/users.ts`.
- Frontend security layer: `lib/frontend-security/src/index.tsx`, `lib/frontend-security/src/turnstile.tsx`, `lib/api-client-react/src/custom-fetch.ts`.
- Observability/Sentry/error handling: `apps/api-server/src/middlewares/observability.ts`, `apps/api-server/src/app.ts`, `lib/frontend-observability/src/index.tsx`, `lib/api-client-react/src/custom-fetch.ts`.
- API contracts/codegen: `lib/api-spec/openapi.yaml`, `lib/api-spec/orval.config.ts`, `lib/api-client-react/src/index.ts`, `lib/api-zod/src/index.ts`.
- Database access: `lib/db/src/index.ts`, `lib/db/src/schema/*.ts`, `lib/db/migrations/*.sql`.

## Potential architectural risks
- **Immediate risk — source-alias coupling to library internals**
  - Location: `apps/admin/vite.config.ts`, `apps/admin/tsconfig.json`, `apps/mockup-sandbox/vite.config.ts`.
  - Consequence: internal refactors inside `lib/*/src` can break apps even when package export contracts are unchanged.
- **Future risk — dormant workspace surface area**
  - Location: `apps/ayni`, `apps/shipibo`, `apps/screening`, `packages/auth|config|security|types|ui`.
  - Consequence: contributors can assume capabilities or boundaries that are not implemented, increasing planning and onboarding error.
- **Future risk — workspace config drift**
  - Location: `pnpm-workspace.yaml` entry `lib/integrations/*` with missing directory.
  - Consequence: tooling expectations and documentation can diverge from actual repository state.
- **Future risk — instrumentation ambiguity**
  - Location: `packages/opentelemetry-instrumentation-http/index.js` plus dependency declaration in `apps/api-server/package.json`.
  - Consequence: teams may assume full OpenTelemetry HTTP instrumentation while current local package is a no-op stub.

## Open questions requiring user confirmation
- Should `apps/mockup-sandbox` be promoted to CI/deploy, archived, or deleted?
- Are `apps/ayni`, `apps/shipibo`, and `apps/screening` roadmap commitments with expected implementation sequence?
- Should shared runtime code be standardized under `lib/*`, `packages/*`, or a strict split model?
- Should `lib/integrations/*` be created now or removed from workspace configuration until needed?
- Should dormant `packages/*` be kept as reserved boundaries or removed to reduce drift and ambiguity?

## Do not break
- Do not contradict the non-negotiable invariants listed in this document when updating architecture docs.
- Do not promote inferred statements to confirmed statements without direct code evidence.
- Do not resolve open questions by assumption; keep unresolved items explicit.

## DEPLOYMENT MODEL (NEW)

* All deployments happen automatically on push to master
* Cloudflare Pages deploys frontend (apps/admin)
* Render deploys backend (apps/api-server)
* GitHub Actions are used ONLY for:

  * running tests
  * logging results
* CI does NOT block deploys
* No pull-request promotion system exists

## DEVELOPER FLOW

1. Make changes
2. Commit directly to master
3. Push
4. Both frontend and backend deploy automatically

## IMPORTANT NOTES

* No auto-merge system exists
* No required checks exist
* No deployment gating exists
* If tests fail, deployment STILL happens
