# 01 — Monorepo Overview (DRAFT)

## Confirmed from code
- Workspace manager is **pnpm workspaces** at root (`pnpm-workspace.yaml` + root `package.json`).
- Workspace globs include `apps/*`, `lib/*`, `packages/*`, `lib/integrations/*`, and `scripts`.
- Active first-class code locations:
  - `apps/api-server` (Express API)
  - `apps/admin` (React + Vite SPA)
  - `apps/mockup-sandbox` (Vite sandbox app)
  - `lib/*` shared libs (`db`, generated API client/schemas, frontend security/observability)
  - `packages/*` mostly placeholder or type-oriented shared packages
  - `scripts` (seed/util scripts)
- Root TypeScript project references only a subset of libs (`lib/db`, `lib/api-client-react`, `lib/api-zod`, `lib/frontend-observability`).
- CI workflows exist for:
  - lockfile sync check,
  - admin security shell tests + deploy webhook,
  - codex branch auto-promote behavior.

## Strong inference from code structure
- The intended platform architecture appears to be:
  1. shared backend API (`apps/api-server`),
  2. a primary tenant/admin frontend (`apps/admin`),
  3. future/parallel app frontends (`apps/ayni`, `apps/shipibo`, `apps/screening` currently placeholders),
  4. shared contracts via OpenAPI and generated clients/schemas.
- `lib/db` and `lib/api-*` look like central contract/data layers intended to support multiple frontends and possibly additional services.
- The monorepo currently mixes **active**, **placeholder**, and **prototype** surfaces.

## Unclear / requires confirmation
- Whether `apps/ayni`, `apps/shipibo`, `apps/screening` are planned deployable frontends or only reserved folders.
- Whether `packages/*` placeholders are deliberate future boundaries or unfinished migrations from `lib/*`.
- Whether `lib/integrations/*` is intentionally empty or missing from checkout.
