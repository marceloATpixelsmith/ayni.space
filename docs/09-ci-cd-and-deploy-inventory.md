# 09 — CI/CD and Deploy Inventory

## Scope
- Inventory current workflows and deploy assumptions from repository automation files.
- Canonical companion: `docs/13-ci-cd-and-deploy-rules.md`.

## Confirmed
- Workflow: `.github/workflows/lockfile-sync-check.yml` enforces frozen lockfile install.
- Workflow: `.github/workflows/admin-security-shell-test-and-deploy.yml` runs admin shell tests and deploys on `master` push.
- Workflow: `.github/workflows/codex-auto-promote.yml` force-resets `master` to codex PR branch state.

## Inferred
- CI coverage is intentionally narrow (admin shell + lockfile integrity), with known backend coverage gaps.

## Unclear
- Required backend regression gates before deployment are not codified.

## Do not break
- Do not remove lockfile sync enforcement.
- Do not change deploy trigger/governance semantics without explicit approval.
