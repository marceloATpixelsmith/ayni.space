# CI/CD and Deploy Chart

## Scope
- Quick-reference map of repository workflows and where deploy responsibility lives.
- Companion to `docs/ci-cd-and-deploy-rules.md` and `docs/ci-cd-and-deploy-inventory.md`.

## Confirmed

| Workflow file | Primary purpose | Trigger highlights | Deploy behavior |
|---|---|---|---|
| `.github/workflows/admin-security-shell-test-and-deploy.yml` | Admin frontend security-shell regression check | PRs to `master` with `apps/admin/**` changes | No deploy step |
| `.github/workflows/backend-regression-gates.yml` | Backend regression gates (typecheck/build/test + log artifact upload) | PRs to `master` affecting backend/shared package scope | No deploy step |
| `.github/workflows/ci-summary.yml` | Dedicated CI summary check for backend gates | `workflow_run` when `Backend Regression Gates` completes | No deploy step |
| `.github/workflows/lockfile-sync-check.yml` | Lockfile/workspace dependency integrity check | PRs touching lockfile/package/workflow metadata | No deploy step |
| `.github/workflows/linear-history-enforcement.yml` | Enforce rebase-only linear PR history | PRs to `master` | No deploy step |
| `.github/workflows/auto-rebase.yml` | Keep `codex/*` PR branches rebased on `master` | PR events and pushes to `master` | No deploy step |
| `.github/workflows/auto-merge.yml` | Enable auto-merge (rebase) for eligible Codex PRs | PR open/sync/reopen | No deploy step |

## Inferred
- This repository's GitHub Actions layer is CI/policy-only.
- Deployment is platform-native and Git-driven outside GitHub Actions.

## Unclear
- Backend deploy hook/provider specifics are not codified in a workflow file.

## Do not break
- Do not add GitHub Actions frontend deploy jobs.
- Do not remove validation/policy workflows without replacement controls.

## Admin frontend Git deploy settings (Vercel)
- Root Directory: `apps/admin`
- Production Branch: `master`
- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm --filter @workspace/admin build`
- Output Directory: `dist/public`
