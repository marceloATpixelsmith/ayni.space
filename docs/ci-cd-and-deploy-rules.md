# 13 — CI/CD and Deploy Rules

## Scope
- Defines CI/CD guardrails for repository automation, using `docs/monorepo-overview.md` as baseline and `.github/workflows/*.yml` as implementation evidence.

## Confirmed
- PR validation workflows:
  - `.github/workflows/admin-security-shell-test-and-deploy.yml` runs `pnpm --filter @workspace/admin run test:security-shell` for admin frontend PR changes.
  - `.github/workflows/backend-regression-gates.yml` runs backend typecheck/build/test gates on PRs affecting backend/shared package scope.
  - `.github/workflows/lockfile-sync-check.yml` enforces `pnpm install --frozen-lockfile` for dependency/workflow-affecting PRs.
  - `.github/workflows/linear-history-enforcement.yml` enforces no-merge-commit (linear/rebase-only) PR history.
- PR governance workflows:
  - `.github/workflows/auto-rebase.yml` rebases `codex/*` PR branches onto latest `master`.
  - `.github/workflows/auto-merge.yml` enables rebase auto-merge for `codex/*` PRs targeting `master`.
- Repository currently contains **no GitHub Actions deploy workflow for the admin frontend**.

## Inferred
- GitHub Actions are used for CI validation and branch-policy automation, not frontend deployment.
- Deploy execution is expected to occur in external platforms connected to Git state.

## Unclear
- Backend runtime deploy implementation details are not described by a dedicated deploy workflow in this repository.
- Whether additional app surfaces will adopt platform-native Git deploys with the same policy boundaries.

## Do not break
- Do not add frontend deploy jobs back into GitHub Actions.
- Do not weaken PR validation gates for admin, backend, lockfile integrity, or linear history.
- Do not change Codex auto-rebase/auto-merge branch constraints (`codex/*` → `master`) without explicit approval.

## Admin frontend deploy target state (Vercel Git integration)
- Root Directory: `apps/admin`
- Production Branch: `master`
- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm --filter @workspace/admin build`
- Output Directory: `dist/public`

## Operational model
1. Open PR to `master`.
2. GitHub Actions run CI/policy checks only.
3. Merge PR to `master` when checks are acceptable.
4. External deployment platform (Vercel for admin frontend) deploys from Git.
