# AGENT_RULES.md

## Scope
- These rules govern repository work in `/workspace/ayni.space`.
- For architecture and documentation tasks, `docs/01-monorepo-overview.md` is the source of truth.

## Mandatory reading map by task type

### 1) Architecture documentation changes
Required before editing:
- `docs/01-monorepo-overview.md`
- `docs/24-architecture-documentation-index.md`
- Domain doc(s) being edited
- `docs/16-open-questions-and-conflicts.md`

### 2) Auth / session / security-related code or docs
Required before editing:
- `docs/01-monorepo-overview.md`
- `docs/05-authentication-and-session-architecture.md`
- `docs/07-authorization-roles-and-access-model.md`
- `docs/17-security-standards-and-non-negotiables.md`

### 3) Backend/API architecture changes
Required before editing:
- `docs/01-monorepo-overview.md`
- `docs/12-api-and-backend-architecture.md`
- `docs/10-tenant-isolation-and-data-ownership.md`
- `docs/14-observability-error-handling-and-sentry.md`

### 4) Dependency/workspace/CI changes
Required before editing:
- `docs/01-monorepo-overview.md`
- `docs/18-dependency-and-lockfile-rules.md`
- `docs/19-ci-cd-and-deploy-rules.md`
- `docs/21-file-and-folder-ownership.md`

### 5) Ownership/process updates
Required before editing:
- `docs/01-monorepo-overview.md`
- `docs/21-file-and-folder-ownership.md`
- `docs/22-codex-working-rules.md`

## Documentation consistency requirements
- Do not contradict `docs/01-monorepo-overview.md`.
- Do not invent architecture not grounded in repository files.
- Every architecture doc must include:
  - `Scope`
  - `Confirmed`
  - `Inferred`
  - `Unclear`
  - `Do not break`
- Use concrete file references when making confirmed claims.

## Pre-change reporting (required)
Before making changes, report:
1. Task type (from reading map above)
2. Files/documents read
3. Planned files to modify
4. Assumptions and unknowns carried forward

## Post-change reporting (required)
After making changes, report:
1. Exact files modified
2. Contradictions resolved (or state none)
3. Any remaining unclear items added/updated
4. Checks run and their results
5. Guardrails/non-negotiables impacted (or state none)

## Do not break
- Do not change app/runtime boundaries that violate `01` non-negotiable invariants without explicit architecture approval.
- Do not bypass shared security/observability/data layers in documentation guidance.
- Do not treat placeholder apps or dormant packages as active production surfaces.

## Governance enforcement state

### Approved governance model (default)
- This repository intentionally uses **safe automatic Codex PR merge to `master`** after checks pass.
- Default operating mode is **solo-builder, low-friction automation** (no manual approval gates by default).
- CI checks are the safety gate; do not propose manual-review-heavy governance unless explicitly requested by the user.

### Enforced in repository files
- CODEOWNERS is defined in `.github/CODEOWNERS` for docs, workflows, governance files, and backend-critical paths.
- Backend regression gates are defined in `.github/workflows/backend-regression-gates.yml` (lockfile/install integrity, api-server build/typecheck/tests, API codegen diff validation).
- Lockfile integrity gate remains in `.github/workflows/lockfile-sync-check.yml`.
- Admin shell gate remains in `.github/workflows/admin-security-shell-test-and-deploy.yml`.
- Codex safe auto-merge is defined in `.github/workflows/codex-safe-auto-merge.yml` and only merges in-repo `codex/*` PRs to `master` after required checks succeed.

### Agent instructions (governance)
- Treat safe auto-merge to `master` after passing checks as the approved repo governance model.
- Do not suggest branch protection/manual approvals/heavy PR review by default.
- Do not reintroduce force-reset/force-push promotion behavior.
- Suggest a different governance model only if the user explicitly asks for it.

### Do not break
- Do not claim force-reset or destructive overwrite of `master` is acceptable governance in this repository.
- Do not remove governance workflows/CODEOWNERS without updating this section and matching docs.
