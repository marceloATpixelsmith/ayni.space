# 09 — CI/CD and Deploy Inventory

## Scope
- Inventory current workflows and deploy assumptions from repository automation files.
- Canonical companion: `docs/19-ci-cd-and-deploy-rules.md`.

## Confirmed
- Workflow: `.github/workflows/lockfile-sync-check.yml` enforces frozen lockfile install.
- Workflow: `.github/workflows/admin-security-shell-test-and-deploy.yml` runs admin shell tests, builds prebuilt assets, and deploys to Cloudflare Pages on `master` push.
- Workflow: `.github/workflows/codex-safe-auto-merge.yml` waits for required checks and merges in-repo Codex PRs into `master` with normal merge behavior (no force-reset/push).

## Inferred
- CI coverage includes lockfile integrity, admin shell + frontend build/deploy, and backend regression gates + Render deploy hook.

## Unclear
- Safe Codex auto-merge depends on workflow check-gating and no-destructive-merge constraints.

## Do not break
- Do not remove lockfile sync enforcement.
- Do not change deploy trigger/governance semantics without explicit approval.
