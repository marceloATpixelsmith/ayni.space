# AGENTS.md — Authoritative Codex Operating Manual

This file is the authoritative operating manual for AI coding agents working in this repository.

## 1) Core Repo Operating Rules

1. Treat the repository's **current live files** as the source of truth.
2. Before non-trivial changes, read `docs/README.md` and then read all **relevant** referenced docs.
3. Never infer CI structure from stale summaries when workflow YAML files disagree.
4. Keep changes tightly scoped to the requested task.
5. Keep docs and code in sync when behavior changes.
6. Do not edit workflow files unless explicitly asked.
7. For CI interpretation, analyze each workflow file independently.

## 2) Live-File-Truth Rules (Non-Negotiable)

1. Workflow structure must be derived from the **current live files** under `.github/workflows/`.
2. Multiple workflow files must **not** be treated as one combined workflow.
3. `backend-regression-gates.yml` only summarizes its own jobs.
4. No cross-workflow aggregation is allowed unless explicitly requested.
5. If docs reference workflow files that do not exist, report that mismatch and proceed from live files.

## 3) CI Workflow File Map (Live-File Anchored)

> Required map entries are listed below exactly as requested.

- `.github/workflows/backend-regression-gates.yml`
  - **Status:** Present.
  - **Purpose:** Backend regression gate workflow with per-job execution and an internal summary job.
- `.github/workflows/api-regression-suite.yml`
  - **Status:** Not present in current live workflow directory.
  - **Handling rule:** Do not assume jobs/commands for this file unless it exists.
- `.github/workflows/auth-security-regression-suite.yml`
  - **Status:** Not present in current live workflow directory.
  - **Handling rule:** Do not assume jobs/commands for this file unless it exists.
- `.github/workflows/lockfile-sync-check.yml`
  - **Status:** Present.
  - **Purpose:** Lockfile/workspace install integrity check.

## 4) Allowed Backend Workflow Scope (Exact)

The backend workflow scope is exactly the scope implemented by `.github/workflows/backend-regression-gates.yml`:

- Trigger contexts:
  - `pull_request` targeting `master`
  - `push` to `master`
  - scheduled cron (`0 3 * * *`)
- Path-scoped triggers (for `pull_request` and `push`):
  - `apps/api-server/**`
  - `lib/**`
  - `packages/**`
  - `scripts/**`
  - `pnpm-lock.yaml`
  - `pnpm-workspace.yaml`
  - `package.json`
  - `.github/workflows/**`

No additional backend scope may be assumed from other workflows unless explicitly requested.

## 5) Exact Backend Job Names

From `.github/workflows/backend-regression-gates.yml`, backend jobs are exactly:

1. `backend-typecheck`
2. `backend-build-api`
3. `backend-api-tests`
4. `backend-ci-summary` (summary job for this workflow only)

## 6) Exact Backend CI Commands

From `.github/workflows/backend-regression-gates.yml`, backend gate commands are exactly:

1. `pnpm -w typecheck`
2. `pnpm --filter @workspace/api-server run build`
3. `pnpm --filter @workspace/api-server run test:ci`

Shared install step used by backend jobs:

- `pnpm install --frozen-lockfile`

## 7) Workflow Summary Rules

1. A workflow summary job may summarize only jobs in its own `needs` graph.
2. Do not merge outcomes from separate workflow files into one report unless explicitly asked.
3. Missing workflow files must be reported as missing, not reconstructed from docs.
4. Job names and commands must be copied exactly from live YAML.
5. When in conflict, trust `.github/workflows/*.yml` over narrative docs.

## 8) Final Response Contract (Required)

When delivering work, the final response must be compact and file-anchored:

1. List exact files changed.
2. Include concise bullets of what changed.
3. Confirm whether any workflow files were changed.
4. Anchor claims to concrete file paths (and line references when available).
5. Do not include speculative CI behavior.

## 9) Task Safety Checklist (Quick Pass)

Before finalizing, confirm all are true:

- Only requested files were modified.
- No workflow file changed unless explicitly requested.
- Backend workflow details came from live `.github/workflows/backend-regression-gates.yml`.
- No cross-workflow result aggregation was introduced.
- Any missing expected workflow file was explicitly called out.
