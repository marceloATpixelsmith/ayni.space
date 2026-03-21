# 20 — Direct-to-Master Deployment Governance

## Scope
- Define the approved governance model for solo-developer delivery in this repository.
- Document that `master` is the deployment source of truth and CI/CD trigger branch.

## Confirmed

### Purpose
- This repository now uses **direct push-to-`master` CI/CD** as the normal delivery path.
- Codex/automation is expected to work directly on `master` instead of PR promotion branches.

### Current approved workflow
- Every push to `master` starts both deployment workflows:
  - `.github/workflows/admin-security-shell-test-and-deploy.yml`
  - `.github/workflows/backend-regression-gates.yml`
- Each workflow detects changed files for its scope and logs:
  - event name
  - ref
  - changed files
  - scope flag (`frontend_changed` or `backend_changed`)
  - force input
  - deploy intent and reason
- Validation jobs run only when that surface is requested (by scope change or manual force input).
- Deploy jobs run only after validation passes and only on push to `master`.

### What is explicitly not allowed
- No PR-based auto-merge promotion flow for normal deployment.
- No `update-branch` conflict-resolution automation.
- No polling for PR-head required checks to decide deployment promotion.

### Manual controls
- `workflow_dispatch` remains enabled in both deploy workflows.
- `force_deploy` input allows manual validation+deploy intent even without matching changed files.

### Required deployment secrets
- Frontend deploy requires: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_PAGES_PROJECT_NAME`.
- Backend deploy requires: `RENDER_DEPLOY_HOOK_URL`.

## Inferred
- The simplified model reduces branch/PR conflict management overhead for a solo maintainer while preserving CI safety gates before deploy.

## Unclear
- Whether future additional app surfaces should be added to deploy scope detection.

## Do not break
- Do not reintroduce PR auto-merge governance as the default deploy path.
- Do not bypass validation gates before deploy jobs.
- Do not change the deployment source-of-truth away from pushes to `master` without explicit owner direction.
