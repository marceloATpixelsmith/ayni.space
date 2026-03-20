# 11 — Dependency, Lockfile, and Build Inventory

## Scope
- Inventory dependency/lockfile/build controls at monorepo level.
- Canonical companion: `docs/dependency-and-lockfile-rules.md`.

## Confirmed
- Workspace globs are managed via `pnpm-workspace.yaml`.
- Root lockfile is `pnpm-lock.yaml`.
- Lockfile consistency is enforced by `.github/workflows/lockfile-sync-check.yml` with `pnpm install --frozen-lockfile`.
- Build/runtime coupling includes:
  - API build path rooted at `apps/api-server/src/index.ts` + app composition in `apps/api-server/src/app.ts`
  - API contract/codegen source at `lib/api-spec/openapi.yaml` and `lib/api-spec/orval.config.ts`

## Inferred
- Dependency governance is centralized around root lockfile + workspace manifests.

## Unclear
- Whether `lib/integrations/*` should remain in workspace globs while directory is absent.

## Do not break
- Do not split lockfile governance away from root `pnpm-lock.yaml`.
- Do not make workspace-glob changes without reconciling actual repository structure.
