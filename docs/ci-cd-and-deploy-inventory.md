# 09 — CI/CD and Deploy Inventory

## Scope
- Inventory current GitHub workflow automation and document where deployment actually happens.
- Canonical companion: `docs/ci-cd-and-deploy-rules.md`.

## Confirmed
- `.github/workflows/admin-security-shell-test-and-deploy.yml` runs **admin frontend PR tests only** for `apps/admin/**` changes and does not deploy.
- `.github/workflows/backend-regression-gates.yml` runs **backend PR regression gates only** for API/package/workspace changes and does not deploy.
- `.github/workflows/backend-ci-summary.yml` runs a dedicated PR-attached backend summary check on `pull_request` to `master`.
- Backend regression gates execute these commands across separate jobs: `pnpm -w typecheck`, `pnpm --filter @workspace/api-server run build`, `pnpm --filter @workspace/api-server run test:ci`, `pnpm --filter @workspace/api-server run test:regression:ci`, and `pnpm run test:auth-security-regression`.
- Each backend gate job captures failure output in `ci-output/<job>.log`, including the failing command and command output.
- Each backend gate job uploads an artifact named `<job>-failure-log` **only** when that job fails.
- `.github/workflows/backend-ci-summary.yml` uses the PR head SHA (`pull_request.head.sha`) and GitHub API check/status queries to summarize only `backend-typecheck`, `backend-build-api`, `backend-api-tests`, `api-regression-suite`, `auth-security-regression-suite`, and `admin-security-shell-test`.
- The backend summary output block is emitted to both workflow logs and `$GITHUB_STEP_SUMMARY` with `OVERALL RESULT`, `FAILED CHECKS`, and `PASSED CHECKS`.
- Backend regression gates default `BACKEND_TRACE_VERBOSE=0` so CI logs stay concise; verbose auth/CORS traces can be re-enabled by setting `BACKEND_TRACE_VERBOSE=1`.
- `.github/workflows/lockfile-sync-check.yml` enforces frozen lockfile install checks on PRs touching dependency/workflow metadata.
- `.github/workflows/linear-history-enforcement.yml` blocks PRs with merge commits (rebase-only history).
- `.github/workflows/auto-rebase.yml` and `.github/workflows/auto-merge.yml` automate Codex PR maintenance/merge behavior for `master`-targeting codex branches.
- There is currently **no GitHub Actions deployment workflow** for the admin frontend.

## Inferred
- Deployments are intentionally externalized from GitHub Actions:
  - Admin frontend is expected to deploy through Vercel Git integration.
  - Backend deploys are expected to be managed by platform-native hooks/services outside this repo's current GitHub workflow set.

## Unclear
- Exact backend production deploy trigger details are not represented by a repository workflow file.
- Whether other frontend apps will adopt the same Git-based deployment model as `apps/admin`.

## Do not break
- Do not reintroduce GitHub-initiated frontend deployment workflows.
- Do not remove PR regression checks (`admin`, `backend`, `lockfile`, `linear-history`).
- Do not alter Codex auto-rebase/auto-merge policies without explicit process approval.

## Current flow (code → GitHub → deploy)
1. Code changes are proposed via PRs against `master`.
2. GitHub Actions run validation and policy checks (no deploy jobs).
3. After merge to `master`, deployment is handled by external platforms.
4. For admin frontend, Vercel should be configured with:
   - Root Directory: `apps/admin`
   - Production Branch: `master`
   - Install Command: `pnpm install --frozen-lockfile`
   - Build Command: `pnpm --filter @workspace/admin build`
   - Output Directory: `dist/public`
