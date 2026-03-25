# CI/CD and Deploy Chart

## Scope
- Quick-reference chart for CI workflows, triggers, and deployment gates in this monorepo.
- Companion to `docs/ci-cd-and-deploy-rules.md` and `docs/ci-cd-and-deploy-inventory.md`.

## Confirmed

| Workflow file | Primary purpose | Trigger highlights | Deploy behavior |
|---|---|---|---|
| `.github/workflows/lockfile-sync-check.yml` | Enforce lockfile/workspace dependency consistency | Runs on pull requests that affect workspace metadata and lockfiles | No deploy step |

## Inferred
- Current delivery strategy prioritizes direct push-to-`master` deployment with Cloudflare Pages and Render handling runtime deployments.
- GitHub Actions provide non-blocking test/log visibility only; deployment execution is external to GitHub Actions.

## Unclear
- Whether future app surfaces (`apps/ayni`, `apps/shipibo`, `apps/screening`) will each receive dedicated deployment pipelines.
- Branch strategy is fixed to `master` as the only default/source-of-truth branch for deploy triggers (future staged environments can be added explicitly later).

## Do not break
- Do not add new deploy paths without corresponding regression gates and secret-management review.

## DEPLOYMENT MODEL (NEW)

* All deployments happen automatically on push to master
* Cloudflare Pages deploys frontend (apps/admin)
* Render deploys backend (apps/api-server)
* GitHub Actions are used ONLY for:

  * running tests
  * logging results
* CI does NOT block deploys
* No pull-request promotion system exists

## DEVELOPER FLOW

1. Make changes
2. Commit directly to master
3. Push
4. Both frontend and backend deploy automatically

## IMPORTANT NOTES

* No auto-merge system exists
* No required checks exist
* No deployment gating exists
* If tests fail, deployment STILL happens
