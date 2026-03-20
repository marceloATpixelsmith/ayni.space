# 13 — CI/CD and Deploy Inventory

## Scope
- Inventory current workflows and deploy assumptions from repository automation files.
- Canonical companion: `docs/19-ci-cd-and-deploy-rules.md`.

## Confirmed
- Workflow: `.github/workflows/lockfile-sync-check.yml` enforces frozen lockfile install.
- Workflow: `.github/workflows/admin-security-shell-test-and-deploy.yml` runs admin shell tests and deploys on `master` push.
- Workflow: `.github/workflows/codex-safe-auto-merge.yml` enables GitHub auto-merge (`--auto --squash --delete-branch`) for in-repo PRs and lets branch protection checks gate final merge.

## Inferred
- CI coverage is intentionally narrow (admin shell + lockfile integrity), with known backend coverage gaps.

## Unclear
- Safe auto-merge depends on branch protection check-gating and no-destructive-merge constraints.

## Do not break
- Do not remove lockfile sync enforcement.
- Do not change deploy trigger/governance semantics without explicit approval.
