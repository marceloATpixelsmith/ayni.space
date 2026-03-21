# CI/CD and Deploy Chart

## Scope
- Quick-reference chart for CI workflows, triggers, and deployment gates in this monorepo.
- Companion to `docs/ci-cd-and-deploy-rules.md` and `docs/ci-cd-and-deploy-inventory.md`.

## Confirmed

| Workflow file | Primary purpose | Trigger highlights | Deploy behavior |
|---|---|---|---|
| `.github/workflows/lockfile-sync-check.yml` | Enforce lockfile/workspace dependency consistency | Runs on pull requests that affect workspace metadata and lockfiles | No deploy step |
| `.github/workflows/backend-regression-gates.yml` | Enforce backend build/regression and codegen validation, then deploy backend via Render hook | Runs on every push to `master` and manual `workflow_dispatch`; internal scope detection decides whether backend validation/deploy are requested | Render deploy hook call gated behind backend validation success + required secret + push-to-`master` condition |
| `.github/workflows/admin-security-shell-test-and-deploy.yml` | Validate admin security shell/build and deploy to Cloudflare Pages | Runs on every push to `master` and manual `workflow_dispatch`; internal scope detection decides whether frontend validation/deploy are requested | Wrangler direct upload of prebuilt artifact gated behind frontend validation success + required secrets + push-to-`master` condition |

## Inferred
- Current delivery strategy prioritizes direct push-to-`master` deployment with scope-aware validation and deploy gates.
- Explicit deployment paths exist for both admin frontend (Cloudflare Pages) and backend API (Render hook).

## Unclear
- Whether future app surfaces (`apps/ayni`, `apps/shipibo`, `apps/screening`) will each receive dedicated deployment pipelines.
- Branch strategy is fixed to `master` as the only default/source-of-truth branch for deploy triggers (future staged environments can be added explicitly later).

## Do not break
- Do not bypass required checks in branch protection by renaming or replacing workflow jobs without updating protection rules.
- Do not add new deploy paths without corresponding regression gates and secret-management review.
