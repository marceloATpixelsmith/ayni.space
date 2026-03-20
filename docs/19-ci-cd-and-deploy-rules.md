# 13 — CI/CD and Deploy Rules

## Scope
- This document defines architecture constraints for its domain using `docs/01-monorepo-overview.md` as baseline and concrete repository paths as evidence.

## Confirmed
- `.github/workflows/lockfile-sync-check.yml` enforces install/lockfile consistency with `pnpm install --frozen-lockfile`.
- `.github/workflows/admin-security-shell-test-and-deploy.yml`:
  - runs admin shell contract test (`pnpm --filter @workspace/admin run test:security-shell`),
  - builds prebuilt assets (`pnpm --filter @workspace/admin run build`) in CI,
  - deploys prebuilt assets to Cloudflare Pages via Wrangler direct upload only on push to `master`,
  - uses workflow path filters focused on admin + shared frontend libs + workspace metadata.
- `.github/workflows/codex-safe-auto-merge.yml` is the approved Codex promotion path:
  - applies only to in-repo `codex/*` PR branches targeting `master`,
  - waits for configured required checks on the PR head SHA to complete with success,
  - merges PRs with normal GitHub merge behavior (no force-reset/force-push).
  - does not depend on GitHub built-in auto-merge or paid/protected-branch features.
- `.github/workflows/backend-regression-gates.yml` enforces backend regression gates for API changes:
  - `pnpm install --frozen-lockfile` (install/lockfile integrity),
  - `pnpm --filter @workspace/api-server run build` (backend build),
  - `pnpm --filter @workspace/api-server run typecheck` (backend typecheck),
  - `pnpm --filter @workspace/api-server run test` (backend auth/authz + tenant/session regression suites),
  - `pnpm --filter @workspace/api-spec run codegen` + `git diff --exit-code -- lib/api-client-react lib/api-zod` (contract/codegen artifact validation),
  - deploys to Render via `RENDER_DEPLOY_HOOK_URL` only after backend checks pass on push to `master`.

## Inferred
- Release governance is intentionally low-friction and workflow-driven for a solo-builder path (Codex PRs auto-merge after checks).
- Safety is enforced by CI workflow checks plus the codex safe auto-merge workflow gating logic.

## Unclear
- Whether additional app surfaces should receive dedicated CI and deploy workflows.
- Exact merge strategy preference (squash/rebase/merge commit) may change over time.

## Do not break
- Do not remove lockfile sync checks; they are current dependency integrity guardrail.
- Do not broaden deploy triggers without explicit review of `master`-only deployment assumption.
- Do not reintroduce force-reset/force-push promotion behavior.
- Do not remove backend regression gates from `.github/workflows/backend-regression-gates.yml` without replacing equivalent auth/authz, tenant-isolation, and session-flow coverage.
- Do not replace the approved safe auto-merge model with manual-review-heavy governance unless explicitly requested by the repository owner.
