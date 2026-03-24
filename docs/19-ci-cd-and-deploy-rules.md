# 13 — CI/CD and Deploy Rules

## Scope
- This document defines architecture constraints for its domain using `docs/monorepo-overview.md` as baseline and concrete repository paths as evidence.

## Confirmed
- GitHub Actions is validation-only for normal delivery.
- Host-native deployment is the production path:
  - Cloudflare Pages auto-deploys from `master`.
  - Render auto-deploys from `master`.
- `.github/workflows/lockfile-sync-check.yml` enforces install/lockfile consistency with `pnpm install --frozen-lockfile`.
- `.github/workflows/admin-frontend-validation.yml`:
  - runs on `pull_request` to `master`, optional `push` to `master` (post-merge validation), and `workflow_dispatch`,
  - detects frontend scope from changed files,
  - runs admin shell contract tests (`pnpm --filter @workspace/admin run test:security-shell`) and admin build (`pnpm --filter @workspace/admin run build`) when frontend scope is matched,
  - does not deploy and does not require Cloudflare deployment secrets.
- `.github/workflows/backend-validation.yml`:
  - runs on `pull_request` to `master`, optional `push` to `master` (post-merge validation), and `workflow_dispatch`,
  - detects backend scope from changed files,
  - runs backend install/build/typecheck/test/codegen validation,
  - validates generated contract artifacts are up to date,
  - does not deploy and does not require Render deploy-hook secrets.
- PR checks must pass before merge to `master`; merge to `master` is what triggers host-native deploys.
- No PR auto-merge, PR hygiene promotion, or branch-promotion workflow is part of active CI/CD.

## Inferred
- Release governance is branch/PR based: validate in PR, merge manually, let providers deploy from `master`.
- Scope-based validation keeps CI targeted while preserving required checks for changed surfaces.

## Unclear
- Whether additional app surfaces should receive dedicated validation workflows.
- Exact merge strategy preference (squash/rebase/merge commit) may change over time.

## Do not break
- Do not remove lockfile sync checks; they are current dependency integrity guardrail.
- Do not reintroduce deploy-hook-trigger or Wrangler deploy steps into normal validation workflows.
- Do not reintroduce force-reset/force-push promotion behavior.
- Do not remove backend regression gates from `.github/workflows/backend-validation.yml` without replacing equivalent auth/authz, tenant-isolation, and session-flow coverage.
- Do not reintroduce PR promotion/auto-merge automation for normal deployments.
