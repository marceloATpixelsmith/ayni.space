# AGENT_RULES.md

## Scope
- These rules govern repository work in `/workspace/ayni.space`.
- For architecture and documentation tasks, `docs/01-monorepo-overview.md` is the source of truth.

## Mandatory reading map by task type

### 1) Architecture documentation changes
Required before editing:
- `docs/01-monorepo-overview.md`
- `docs/README.md`
- Domain doc(s) being edited
- `docs/11-open-questions-and-conflicts.md`

### 2) Auth / session / security-related code or docs
Required before editing:
- `docs/01-monorepo-overview.md`
- `docs/05-authentication-and-session-architecture.md`
- `docs/06-authorization-roles-and-access-model.md`
- `docs/11-security-standards-and-non-negotiables.md`

### 3) Backend/API architecture changes
Required before editing:
- `docs/01-monorepo-overview.md`
- `docs/09-api-and-backend-architecture.md`
- `docs/07-tenant-isolation-and-data-ownership.md`
- `docs/10-observability-error-handling-and-sentry.md`

### 4) Dependency/workspace/CI changes
Required before editing:
- `docs/01-monorepo-overview.md`
- `docs/12-dependency-and-lockfile-rules.md`
- `docs/13-ci-cd-and-deploy-rules.md`
- `docs/16-file-and-folder-ownership.md`

### 5) Ownership/process updates
Required before editing:
- `docs/01-monorepo-overview.md`
- `docs/16-file-and-folder-ownership.md`
- `docs/17-codex-working-rules.md`

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

### Enforced in repository files
- CODEOWNERS is defined in `.github/CODEOWNERS` for docs, workflows, governance files, and backend-critical paths.
- Backend regression gates are defined in `.github/workflows/backend-regression-gates.yml` (lockfile/install integrity, api-server build/typecheck/tests, API codegen diff validation).
- Lockfile integrity gate remains in `.github/workflows/lockfile-sync-check.yml`.
- Admin shell gate remains in `.github/workflows/admin-security-shell-test-and-deploy.yml`.

### Requires GitHub admin/repository settings
- Branch protection rule(s) that require status checks to pass before merge.
- Selecting required checks (for example: `Lockfile Sync Check`, `Backend Regression Gates`, and `Admin Security Shell Test & Deploy` job checks as applicable).
- Enabling “Require branches to be up to date before merging.”
- Enabling “Require review from Code Owners.”

### Do not break
- Do not claim branch protection or required checks are enforced unless GitHub settings are configured.
- Do not remove governance workflows/CODEOWNERS without updating this section and corresponding docs.
