# 09 — CI/CD and Deploy Inventory

## Scope
- Inventory current workflows and deploy assumptions from repository automation files.
- Canonical companion: `docs/ci-cd-and-deploy-rules.md`.

## Confirmed
- Workflow: `.github/workflows/lockfile-sync-check.yml` enforces frozen lockfile install.
- Workflow: `.github/workflows/admin-frontend-validation.yml` runs frontend-scope detection, logs scope context, runs admin security shell tests, and runs admin build when frontend-scope files changed (or manual run).
- Workflow: `.github/workflows/backend-validation.yml` runs backend-scope detection, logs scope context, runs backend build/typecheck/test/codegen validation, and validates generated artifacts when backend-scope files changed (or manual run).
- Validation is required before merge to `master` via `pull_request` checks.
- Deployment is host-native: Cloudflare Pages and Render auto-deploy from `master` after merge.
- No PR promotion/auto-merge workflow is part of normal delivery.

## Inferred
- CI coverage now cleanly separates validation responsibilities from deployment responsibilities.
- Scope-aware validation reduces unnecessary CI runtime while keeping monorepo checks aligned to changed areas.

## Unclear
- Whether additional app surfaces should be added to existing validation scopes.

## Do not break
- Do not remove lockfile sync enforcement.
- Do not reintroduce GitHub Actions as the normal production deploy engine.
