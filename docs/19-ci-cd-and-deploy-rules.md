# 13 — CI/CD and Deploy Rules

## Scope
- This document defines architecture constraints for its domain using `docs/01-monorepo-overview.md` as baseline and concrete repository paths as evidence.

## Confirmed
- `.github/workflows/lockfile-sync-check.yml` enforces install/lockfile consistency with `pnpm install --frozen-lockfile`.
- `.github/workflows/admin-security-shell-test-and-deploy.yml`:
  - runs admin shell contract test (`pnpm --filter @workspace/admin run test:security-shell`),
  - builds prebuilt assets (`pnpm --filter @workspace/admin run build`) in CI,
  - uses internal changed-file scope detection focused on admin + shared frontend libs + workspace metadata.
- Normal deployment path is only `push` to `master`; manual path is only `workflow_dispatch` with optional `force_deploy`.
- `.github/workflows/backend-regression-gates.yml` enforces backend regression gates for API changes:
  - `pnpm install --frozen-lockfile` (install/lockfile integrity),
  - `pnpm --filter @workspace/api-server run build` (backend build),
  - `pnpm --filter @workspace/api-server run typecheck` (backend typecheck),
  - `pnpm --filter @workspace/api-server run test` (backend auth/authz + tenant/session regression suites),
  - `pnpm --filter @workspace/api-spec run codegen` + `git diff --exit-code -- lib/api-client-react lib/api-zod` (contract/codegen artifact validation),
  - deploys to Render via `RENDER_DEPLOY_HOOK_URL` only after backend checks pass on push to `master`.

## Inferred
- Release governance is intentionally low-friction for a solo-builder path: push to `master` triggers CI/CD directly.
- Safety is enforced by per-surface CI validation gates before each deploy job executes.

## Unclear
- Whether additional app surfaces should receive dedicated CI and deploy workflows.
- Branch strategy is strict rebase-only for Codex branches: maintain linear history and avoid merge commits.

## Do not break
- Do not remove lockfile sync checks; they are current dependency integrity guardrail.
- Do not broaden deploy triggers without explicit review of `master`-only deployment assumption.
- Do not remove backend regression gates from `.github/workflows/backend-regression-gates.yml` without replacing equivalent auth/authz, tenant-isolation, and session-flow coverage.

## DEPLOYMENT MODEL (NEW)

* All deployments happen automatically on push to master
* Cloudflare Pages deploys frontend (apps/admin)
* Render deploys backend (apps/api-server)
* GitHub Actions are used ONLY for:

  * running tests
  * logging results
* CI does NOT block deploys
* No pull-request promotion system exists

## DEVELOPER FLOW

1. Make changes
2. Commit directly to master
3. Push
4. Both frontend and backend deploy automatically

## IMPORTANT NOTES

* No auto-merge system exists
* No required checks exist
* No deployment gating exists
* If tests fail, deployment STILL happens

## BRANCH HYGIENE (MANDATORY)

1. Never run `git merge master` or `git pull origin master`.
2. Always sync with `git fetch origin` then `git rebase origin/master`.
3. Keep branch history linear (no merge commits).
4. Before PR creation/update, rebase on latest `origin/master` and ensure fast-forward mergeability.
5. Do not use GitHub "Update branch" or any merge-based branch sync flow.
6. If conflicts occur during rebase, resolve in-branch and continue rebase; do not create a merge commit.
7. Final PR must merge cleanly without GitHub UI conflict resolution.
