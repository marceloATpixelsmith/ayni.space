# CI/CD and Deploy Chart

## Scope
- Quick-reference chart for CI workflows, triggers, and deployment responsibilities in this monorepo.
- Companion to `docs/ci-cd-and-deploy-rules.md` and `docs/ci-cd-and-deploy-inventory.md`.

## Confirmed

| Workflow file | Primary purpose | Trigger highlights | Deploy behavior |
|---|---|---|---|
| `.github/workflows/lockfile-sync-check.yml` | Enforce lockfile/workspace dependency consistency | Runs on pull requests that affect workspace metadata and lockfiles | No deploy step |
| `.github/workflows/backend-validation.yml` | Enforce backend build/regression and codegen validation | Runs on `pull_request` to `master`; may also run on `push` to `master` for post-merge verification and manual `workflow_dispatch`; internal scope detection decides whether backend validation runs | No deploy step |
| `.github/workflows/admin-frontend-validation.yml` | Validate admin security shell/build readiness | Runs on `pull_request` to `master`; may also run on `push` to `master` for post-merge verification and manual `workflow_dispatch`; internal scope detection decides whether frontend validation runs | No deploy step |

## Inferred
- Current delivery strategy is: validate via GitHub Actions, merge to `master`, let Cloudflare Pages and Render deploy natively from `master`.
- Explicit deployment paths are host-native and no longer implemented by GitHub Actions jobs.

## Unclear
- Whether future app surfaces (`apps/ayni`, `apps/shipibo`, `apps/screening`) will each receive dedicated validation pipelines.
- Whether post-merge `push` validation should remain long-term or be trimmed to PR-only.

## Do not break
- Do not bypass required checks in branch protection by renaming or replacing workflow jobs without updating protection rules.
- Do not add new GitHub-driven production deploy paths without explicit architecture review.
