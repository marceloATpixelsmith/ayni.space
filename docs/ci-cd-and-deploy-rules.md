# 13 — CI/CD and Deploy Rules

## Scope
- Defines CI/CD guardrails for repository automation, using `docs/monorepo-overview.md` as baseline and `.github/workflows/*.yml` as implementation evidence.

## Confirmed
- PR validation workflows:
  - `.github/workflows/admin-security-shell-test-and-deploy.yml` runs `pnpm --filter @workspace/admin run test:security-shell` for admin frontend PR changes.
  - `.github/workflows/backend-regression-gates.yml` runs backend gates on PRs affecting backend/shared package scope and executes: `pnpm -w typecheck`, `pnpm --filter @workspace/api-server run build`, and `pnpm --filter @workspace/api-server run test:ci`.
  - Backend gates are modeled as separate jobs (`backend-typecheck`, `backend-build-api`, `backend-api-tests`) with consistent checkout/install setup.
  - Each gate job captures failure details to `ci-output/<job>.log` and uploads `<job>-failure-log` artifacts only on failure.
  - `.github/workflows/backend-ci-summary.yml` runs on `pull_request` to `master`, queries checks for both `pull_request.head.sha` and `pull_request.merge_commit_sha` via GitHub API, then summarizes from the SHA with the most observed required checks (`backend-typecheck`, `backend-build-api`, `backend-api-tests`, `api-regression-suite`, and `auth-security-regression-suite`) into one PR-attached `backend-ci-summary` check.
  - Backend gate CI runs with `BACKEND_TRACE_VERBOSE=0` by default to suppress high-volume auth/CORS trace logs; set `BACKEND_TRACE_VERBOSE=1` to restore deep trace output for diagnostics.
  - `.github/workflows/lockfile-sync-check.yml` enforces `pnpm install --frozen-lockfile` for dependency/workflow-affecting PRs.
  - Backend/API/auth regression workflows and the lockfile sync check disable `setup-node` pnpm cache restore and run a deterministic pnpm store reset step (`STORE_PATH="$(pnpm store path --silent)"` then `rm -rf "$STORE_PATH"`) immediately before frozen install so stale/corrupted tarballs cannot survive into `pnpm install --frozen-lockfile`.
  - `.github/workflows/linear-history-enforcement.yml` enforces no-merge-commit (linear/rebase-only) PR history.
- PR governance workflows:
  - `.github/workflows/auto-rebase.yml` rebases `codex/*` PR branches onto latest `master`.
  - `.github/workflows/auto-merge.yml` enables rebase auto-merge for `codex/*` PRs targeting `master`.
- AUTH freeze protected-file guard:
  - `.github/workflows/auth-freeze-guard.yml` runs on PRs to `master` when auth-critical files, auth/security tests, auth docs, or auth workflow files are edited.
  - It fails unless the PR body includes explicit marker `AUTH-CHANGE-APPROVED`, and reports changed protected paths when blocked.
- Auth security regression workflow:
  - `.github/workflows/auth-security-regression-suite.yml` runs the dedicated auth/session/security integration suite on every PR to `master` and every push to `master` (no path filters).
  - Enforced command: `pnpm run test:auth-security-regression` (admin auth runtime routes + backend auth core, session-group/MFA-pending, journey orchestration, and invitation-MFA continuation tests).
- Repository currently contains **no GitHub Actions deploy workflow for the admin frontend**.

## Inferred
- GitHub Actions are used for CI validation and branch-policy automation, not frontend deployment.
- Deploy execution is expected to occur in external platforms connected to Git state.

## Unclear
- Backend runtime deploy implementation details are not described by a dedicated deploy workflow in this repository.
- Whether additional app surfaces will adopt platform-native Git deploys with the same policy boundaries.

## Do not break
- Do not add frontend deploy jobs back into GitHub Actions.
- Do not weaken PR validation gates for admin, backend, lockfile integrity, linear history, or auth-security regression suite.
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


## Required branch protection check
- Mark `auth-security-regression-suite` as a required status check in GitHub branch protection for `master`.

## Backend deploy migration flow (Render)
- Render pre-deploy is the primary migration mechanism and should run `pnpm --filter @workspace/db run migrate` before API startup.
- API startup in `apps/api-server/src/index.ts` intentionally does **not** execute database migrations; it logs that migration execution is handled by Render pre-deploy, then proceeds with startup validation and session-store infrastructure checks.
- Migration execution remains centralized in `@workspace/db` (`lib/db/src/migrate.ts`) and uses Drizzle's migration table tracking (`drizzle-orm/node-postgres/migrator`) against `lib/db/migrations`.
- Because Drizzle tracks applied files in the database, each migration is applied once per database and skipped on subsequent deploys.
- Distributed auth limiter rollout requires `lib/db/migrations/20260407_distributed_rate_limits.sql` to be present before deploying any backend version that expects `platform.rate_limits`.
- The API database role used by `apps/api-server` must retain `SELECT`, `INSERT`, and `UPDATE` on `platform.rate_limits`; missing privileges can force the limiter into emergency local mode and should be treated as a deploy misconfiguration.
