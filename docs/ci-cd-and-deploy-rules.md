# 13 — CI/CD and Deploy Rules

## Scope
- Defines CI/CD guardrails for repository automation, using `docs/monorepo-overview.md` as baseline and `.github/workflows/*.yml` as implementation evidence.

## Confirmed
- PR validation workflows:
  - `.github/workflows/admin-security-shell-test-and-deploy.yml` runs `pnpm --filter @workspace/admin run test:security-shell` for admin frontend PR changes.
  - `.github/workflows/backend-regression-gates.yml` runs backend gates on PRs affecting backend/shared package scope and executes: `pnpm -w typecheck`, `pnpm --filter @workspace/api-server run build`, `pnpm --filter @workspace/api-server run test:ci`, `pnpm run test:api-regression`, and `pnpm run test:auth-security-regression`.
  - Backend gates capture each command's raw output into dedicated `artifacts/backend-gates/*.log` files with `set +e` + `set -o pipefail` + `tee`, persist the real command status to `$GITHUB_OUTPUT` as `exit_code`, and preserve step outcomes by exiting with the same code while using `continue-on-error: true`.
  - `.github/workflows/ci-summary.yml` remains a dedicated backend-only top-level check that triggers on `workflow_run` completion for `Backend Regression Gates`, downloads `backend-gates-logs` from that exact run ID, and emits one combined fenced text block (tailing each log) to both logs and `$GITHUB_STEP_SUMMARY`.
  - `.github/workflows/pr-checks-summary.yml` adds a separate top-level check (`PR Checks Summary Aggregator`) for PR/push events; it deterministically targets only allowlisted top-level checks (`backend-gates`, `auth-security-regression-suite`, admin `test`, lockfile check, linear-history `check`), excludes itself and non-allowlisted checks, scopes to the exact commit SHA, de-duplicates duplicate check-run names by newest run, logs the tracked list before polling, and during polling logs the exact unfinished tracked checks (name + status/conclusion) before printing one consolidated fenced text block in logs + `$GITHUB_STEP_SUMMARY` with deterministic overall state (`OVERALL RESULT: PASS|FAIL|INCOMPLETE`) and separate `FAILED CHECKS`, `UNFINISHED CHECKS`, and `PASSED CHECKS` buckets.
  - The PR summary workflow must check out repository contents before invoking local scripts and must fail early with explicit path diagnostics if `scripts/ci/pr-checks-summary-targeting-cli.mjs` or `scripts/ci/pr-checks-summary-targeting.mjs` is missing.
  - Backend gate CI runs with `BACKEND_TRACE_VERBOSE=0` by default to suppress high-volume auth/CORS trace logs; set `BACKEND_TRACE_VERBOSE=1` to restore deep trace output for diagnostics.
  - Final backend gate job-fail evaluation now keys off each step's captured `exit_code`, treats `skipped` as pass, treats `cancelled` as fail, and explicitly fails early when dependency install fails so downstream skipped gates are not misdiagnosed as gate regressions.
  - `.github/workflows/lockfile-sync-check.yml` enforces `pnpm install --frozen-lockfile` for dependency/workflow-affecting PRs.
  - `.github/workflows/linear-history-enforcement.yml` enforces no-merge-commit (linear/rebase-only) PR history.
- PR governance workflows:
  - `.github/workflows/auto-rebase.yml` rebases `codex/*` PR branches onto latest `master`.
  - `.github/workflows/auto-merge.yml` enables rebase auto-merge for `codex/*` PRs targeting `master`.
- Auth security regression workflow:
  - `.github/workflows/auth-security-regression-suite.yml` runs the dedicated auth/session/security integration suite on every PR to `master` and every push to `master` (no path filters).
  - Enforced command: `pnpm run test:auth-security-regression`.
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
