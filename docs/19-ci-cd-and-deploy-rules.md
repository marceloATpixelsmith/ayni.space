# 13 — CI/CD and Deploy Rules

## Scope
- This document defines architecture constraints for its domain using `docs/01-monorepo-overview.md` as baseline and concrete repository paths as evidence.

## Confirmed
- Vercel is no longer part of the deployment path; admin frontend deploys only via GitHub Actions prebuild + Wrangler direct upload to Cloudflare Pages.
- `.github/workflows/lockfile-sync-check.yml` enforces install/lockfile consistency with `pnpm install --frozen-lockfile`.
- `.github/workflows/admin-security-shell-test-and-deploy.yml`:
  - runs admin shell contract test (`pnpm --filter @workspace/admin run test:security-shell`),
  - builds prebuilt assets (`pnpm --filter @workspace/admin run build`) in CI,
  - deploys prebuilt assets to Cloudflare Pages via Wrangler direct upload only on push to `master`,
  - uses internal changed-file scope detection focused on admin + shared frontend libs + workspace metadata.
- Normal deployment path is only `push` to `master`; manual path is only `workflow_dispatch` with optional `force_deploy`.
- No PR auto-merge, PR hygiene promotion, or branch-promotion workflow is part of active CI/CD.
- `.github/workflows/backend-regression-gates.yml` enforces backend regression gates for API changes:
  - `pnpm install --frozen-lockfile` (install/lockfile integrity),
  - `pnpm --filter @workspace/api-server run build` (backend build),
  - `pnpm --filter @workspace/api-server run typecheck` (backend typecheck),
  - `pnpm --filter @workspace/api-server run test` (backend auth/authz + tenant/session regression suites),
  - `pnpm --filter @workspace/api-spec run codegen` + `git diff --exit-code -- lib/api-client-react lib/api-zod` (contract/codegen artifact validation),
  - deploys to Render via `RENDER_DEPLOY_HOOK_URL` only after backend checks pass on push to `master`.

## Inferred
- Release governance is intentionally low-friction for a solo-builder path: push to `master` triggers CI/CD directly.
- Safety is enforced by per-surface CI validation gates before each deploy job executes.

## Unclear
- Whether additional app surfaces should receive dedicated CI and deploy workflows.
- Exact merge strategy preference (squash/rebase/merge commit) may change over time.

## Do not break
- Do not remove lockfile sync checks; they are current dependency integrity guardrail.
- Do not broaden deploy triggers without explicit review of `master`-only deployment assumption.
- Do not reintroduce force-reset/force-push promotion behavior.
- Do not remove backend regression gates from `.github/workflows/backend-regression-gates.yml` without replacing equivalent auth/authz, tenant-isolation, and session-flow coverage.
- Do not reintroduce PR promotion/auto-merge automation for normal deployments.
