# CI/CD and Deploy Chart

## Scope
- Quick-reference chart for CI workflows, triggers, and deployment gates in this monorepo.
- Companion to `docs/ci-cd-and-deploy-rules.md` and `docs/ci-cd-and-deploy-inventory.md`.

## Confirmed

| Workflow file | Primary purpose | Trigger highlights | Deploy behavior |
|---|---|---|---|
| `.github/workflows/lockfile-sync-check.yml` | Enforce lockfile/workspace dependency consistency | Runs on pull requests that affect workspace metadata and lockfiles | No deploy step |
| `.github/workflows/backend-regression-gates.yml` | Enforce backend build/typecheck/regression and codegen validation, then deploy backend via Render hook | Runs on backend-affecting pull request changes; deploy path on push to `master` | Render deploy hook call gated behind required checks, secret, and branch condition |
| `.github/workflows/admin-security-shell-test-and-deploy.yml` | Validate admin security shell contract, build prebuilt assets, and deploy to Cloudflare Pages | Runs on admin/shared-frontend-affecting pull request changes; deploy path on push to `master` | Wrangler direct upload of prebuilt artifact gated behind required checks, secrets, and branch condition |
| `.github/workflows/codex-safe-auto-merge.yml` | Safe auto-merge for `codex/*` pull requests after checks pass | Pull request events for matching branch names | Merge automation only; no environment deploy |

## Inferred
- Current delivery strategy prioritizes merge safety and regression checks over broad multi-app deployment automation.
- Explicit deployment paths exist for both admin frontend (Cloudflare Pages) and backend API (Render hook).

## Unclear
- Whether future app surfaces (`apps/ayni`, `apps/shipibo`, `apps/screening`) will each receive dedicated deployment pipelines.
- Branch strategy is fixed to `master` as the only default/source-of-truth branch for deploy triggers (future staged environments can be added explicitly later).

## Do not break
- Do not bypass required checks in branch protection by renaming or replacing workflow jobs without updating protection rules.
- Do not add new deploy paths without corresponding regression gates and secret-management review.
