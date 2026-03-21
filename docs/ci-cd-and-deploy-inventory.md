# 09 — CI/CD and Deploy Inventory

## Scope
- Inventory current workflows and deploy assumptions from repository automation files.
- Canonical companion: `docs/ci-cd-and-deploy-rules.md`.

## Confirmed
- Workflow: `.github/workflows/lockfile-sync-check.yml` enforces frozen lockfile install.
- Workflow: `.github/workflows/admin-security-shell-test-and-deploy.yml` runs admin shell tests, builds prebuilt assets, and deploys to Cloudflare Pages on `master` push.
- Deployment automation is direct push-to-`master`; no Codex PR auto-merge workflow is part of normal delivery.

## Inferred
- CI coverage includes lockfile integrity, admin shell + frontend build/deploy, and backend regression gates + Render deploy hook.

## Unclear
- Whether additional app surfaces should be added to deploy scopes in existing push-to-`master` workflows.

## Do not break
- Do not remove lockfile sync enforcement.
- Do not change deploy trigger/governance semantics without explicit approval.
