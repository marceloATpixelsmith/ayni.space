# 09 — CI/CD and Deploy Inventory (DRAFT)

## Confirmed from code

### GitHub workflows
- `lockfile-sync-check.yml`
  - Runs on PR changes to package manifests/workspace/lockfile.
  - Executes `pnpm install --frozen-lockfile`.
- `admin-security-shell-test-and-deploy.yml`
  - Runs admin security-shell tests on PR and on push to `master` (path-filtered).
  - On successful push to `master`, triggers external deploy webhook via `DEPLOY_WEBHOOK_URL` secret.
- `codex-auto-promote.yml`
  - For `pull_request_target` into `master` from branches prefixed `codex/`.
  - Force-resets `master` to PR head and attempts PR closure.

### In-repo deploy documentation
- `PORTABILITY.md` contains provider-agnostic deployment guidance (Render/Railway/Fly/VPS examples).
- API build artifact expected at `apps/api-server/dist/index.cjs` in docs and build script.

## Strong inference from code structure
- CI is currently focused on dependency integrity and admin shell behavior, not full monorepo test matrix.
- Production deployment appears externally orchestrated through webhook, likely platform-specific.

## Unclear / requires confirmation
- No workflow observed for full backend integration tests, DB migration verification, or end-to-end auth flows.
- No explicit environment promotion strategy (dev/staging/prod) encoded in repo workflows.
- `codex-auto-promote` force-push pattern has strong operational implications; confirm this is still desired governance.
