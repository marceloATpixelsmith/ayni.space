# 12 — Dependency and Lockfile Rules

## Scope
- This document defines architecture constraints for its domain using `docs/01-monorepo-overview.md` as baseline and concrete repository paths as evidence.

## Confirmed
- Workspace membership is defined by `pnpm-workspace.yaml` globs:
  - `apps/*`, `lib/*`, `packages/*`, `lib/integrations/*`, `scripts`.
- Root lockfile is `pnpm-lock.yaml` and is validated in CI by `.github/workflows/lockfile-sync-check.yml` using `pnpm install --frozen-lockfile`.
- Shared dependency flow today is concentrated in `lib/*`; several `packages/*` are currently dormant.
- `lib/integrations/*` is declared in workspace globs but directory is currently absent.

## Inferred
- Dependency governance assumes root lockfile as source of truth for the monorepo.
- Workspace scope drift (declared vs existing directories) is an acknowledged risk and should be managed intentionally.

## Unclear
- Whether `lib/integrations/*` should be implemented now or removed until needed.
- Whether dormant workspace packages should remain reserved boundaries or be cleaned up.

## Do not break
- Do not commit workspace dependency changes without updating and validating root `pnpm-lock.yaml`.
- Do not add package-level lockfiles that conflict with root lockfile governance.
- Do not introduce workspace glob changes without verifying actual directory ownership and intent.
- Do not assume dormant package dependencies are active runtime contracts.
