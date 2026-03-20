# CI/CD and Deploy Chart

## Scope
- Quick-reference chart for CI workflows, triggers, and deployment gates in this monorepo.
- Companion to `docs/ci-cd-and-deploy-rules.md` and `docs/ci-cd-and-deploy-inventory.md`.

## Confirmed

| Workflow file | Primary purpose | Trigger highlights | Deploy behavior |
|---|---|---|---|
| `.github/workflows/lockfile-sync-check.yml` | Enforce lockfile/workspace dependency consistency | Runs on pull requests that affect workspace metadata and lockfiles | No deploy step |
| `.github/workflows/backend-regression-gates.yml` | Enforce backend build/typecheck/regression and codegen validation | Runs on backend-affecting pull request changes | No deploy step |
| `.github/workflows/admin-security-shell-test-and-deploy.yml` | Validate admin security shell contract and allow deployment path | Runs on admin-affecting pull request changes; deploy path on push to `master` | Deploy webhook call gated behind secret and branch condition |
| `.github/workflows/codex-safe-auto-merge.yml` | Safe auto-merge for `codex/*` pull requests after checks pass | Pull request events for matching branch names | Merge automation only; no environment deploy |

## Inferred
- Current delivery strategy prioritizes merge safety and regression checks over broad multi-app deployment automation.
- Admin deploy remains the only explicit deployment path in workflows today.

## Unclear
- Whether future app surfaces (`apps/ayni`, `apps/shipibo`, `apps/screening`) will each receive dedicated deployment pipelines.
- Whether branch strategy will remain `master`-centric for deploy triggers long-term.

## Do not break
- Do not bypass required checks in branch protection by renaming or replacing workflow jobs without updating protection rules.
- Do not add new deploy paths without corresponding regression gates and secret-management review.
