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
8. Never describe intended YAML/code structure as if it already exists in the live file.
9. If the live file does not match prior Codex claims, explicitly say so.
10. Do not expand scope from one workflow file to multiple workflow files unless explicitly requested.
11. Do not rename unrelated jobs or workflows unless explicitly requested.

## 2) Live-File-Truth Rules (Non-Negotiable)

1. Workflow structure must be derived from the **current live files** under `.github/workflows/`.
2. Multiple workflow files must **not** be treated as one combined workflow.
3. `backend-regression-gates.yml` contains only backend gate jobs (`backend-typecheck`, `backend-build-api`, `backend-api-tests`) and does not host the standalone backend summary workflow.
4. `.github/workflows/backend-ci-summary.yml` is the authoritative cross-workflow backend summary workflow and aggregates required backend-related checks for the PR head SHA.
5. If docs reference workflow files that do not exist, report that mismatch and proceed from live files.

## 3) CI Workflow File Map (Live-File Anchored)

- `.github/workflows/backend-regression-gates.yml`
  - **Status:** Present.
  - **Purpose:** Backend regression gate workflow with per-job execution for backend checks.
- `.github/workflows/api-regression-suite.yml`
  - **Status:** Present.
  - **Purpose:** API regression suite workflow.
- `.github/workflows/auth-security-regression-suite.yml`
  - **Status:** Present.
  - **Purpose:** Auth/security regression suite workflow.
- `.github/workflows/backend-ci-summary.yml`
  - **Status:** Present.
  - **Purpose:** Standalone PR summary workflow that runs on `pull_request` to `master`, publishes the `backend-ci-summary` PR check, summarizes `backend-typecheck`, `backend-build-api`, `backend-api-tests`, `api-regression-suite`, and `auth-security-regression-suite` for the PR head SHA, and emits grouped debugging output/check links.
- `.github/workflows/lockfile-sync-check.yml`
  - **Status:** Present.
  - **Purpose:** Lockfile/workspace install integrity check.

## 4) Exact Allowed Backend Workflow Scope

The backend workflow scope is exactly the scope implemented by `.github/workflows/backend-regression-gates.yml`:

- Trigger contexts:
  - `pull_request` targeting `master`
  - `push` to `master`
  - scheduled cron (`0 3 * * *`)
- Path-scoped triggers:
  - No `paths` filters are currently configured in this workflow.
  - Do not assume any backend path filtering for this workflow unless live YAML adds it.

No additional backend scope may be assumed from other workflows unless explicitly requested.

## 5) Exact Backend Job Names

From `.github/workflows/backend-regression-gates.yml`, backend gate jobs are exactly:

1. `backend-typecheck`
2. `backend-build-api`
3. `backend-api-tests`

## 6) Exact Backend CI Commands

From `.github/workflows/backend-regression-gates.yml`, backend gate commands are exactly:

1. `pnpm -w typecheck`
2. `pnpm --filter @workspace/api-server run build`
3. `pnpm --filter @workspace/api-server run test:ci`

Shared install step used by backend jobs:

- `pnpm install --frozen-lockfile`

## 7) Workflow Summary Rules

1. `backend-ci-summary.yml` is the designated cross-workflow backend summary workflow and may aggregate backend-related checks across workflow files for the same PR head SHA.
2. For backend CI status interpretation, treat `backend-regression-gates.yml` as execution of gate jobs and `backend-ci-summary.yml` as the standalone aggregate reporter check.
3. Missing workflow files must be reported as missing, not reconstructed from docs.
4. Job names and commands must be copied exactly from live YAML.
5. When in conflict, trust `.github/workflows/*.yml` over narrative docs.
6. Summary jobs must show concise actionable excerpts only; full raw logs belong in artifacts.
7. For test logs, prefer failing test sections over full output.

## 8) Final Response Contract (Required)

When delivering work, the final response must be compact and file-anchored:

1. List exact files changed.
2. Include concise bullets of what changed.
3. Confirm whether any workflow files were changed.
4. Anchor claims to concrete file paths (and line references when available).
5. Do not include speculative CI behavior.
6. If a workflow file was changed, list the exact top-level jobs now present in that workflow.
7. If job names changed, list the old names and new names explicitly.
8. Do not claim a job/check is visible in GitHub unless that is directly confirmed from a live run.
9. Distinguish clearly between:
   - present in YAML
   - expected in future runs
   - confirmed visible in a live run
10. If a workflow trigger was changed, include the exact final `on:` block.

## 9) Task Safety Checklist (Quick Pass)

Before finalizing, confirm all are true:

- Only requested files were modified.
- No workflow file changed unless explicitly requested.
- Backend gate details came from live `.github/workflows/backend-regression-gates.yml`.
- Backend summary details came from live `.github/workflows/backend-ci-summary.yml`.
- No missing expected workflow file was falsely reported.

## 10) CI Change Verification Checklist

Before finalizing CI-related updates, confirm all are true:

- The exact workflow file requested was opened and read.
- Every top-level job in the edited workflow was re-checked after changes.
- No unrelated workflow file was modified.
- Any backend summary aggregation behavior was validated against live `.github/workflows/backend-ci-summary.yml`.
- Any claim about visible checks is labeled either YAML-confirmed only or live-run confirmed.
- If summary behavior changed, artifact behavior was preserved unless explicitly requested otherwise.
