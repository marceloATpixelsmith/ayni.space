# 13 — CI/CD and Deploy Rules

## Scope
- This document defines architecture constraints for its domain using `docs/01-monorepo-overview.md` as baseline and concrete repository paths as evidence.

## Confirmed
- `.github/workflows/lockfile-sync-check.yml` enforces install/lockfile consistency with `pnpm install --frozen-lockfile`.
- `.github/workflows/admin-security-shell-test-and-deploy.yml`:
  - runs admin shell contract test (`pnpm --filter @workspace/admin run test:security-shell`),
  - deploys only on push to `master`,
  - uses workflow path filters focused on admin + workspace metadata.
- `.github/workflows/codex-auto-promote.yml` automates promotion by force-resetting `master` to the codex PR branch state.
- `.github/workflows/backend-regression-gates.yml` enforces backend regression gates for API changes:
  - `pnpm install --frozen-lockfile` (install/lockfile integrity),
  - `pnpm --filter @workspace/api-server run build` (backend build),
  - `pnpm --filter @workspace/api-server run typecheck` (backend typecheck),
  - `pnpm --filter @workspace/api-server run test` (backend auth/authz + tenant/session regression suites),
  - `pnpm --filter @workspace/api-spec run codegen` + `git diff --exit-code -- lib/api-client-react lib/api-zod` (contract/codegen artifact validation).

## Inferred
- Release governance assumes force-push semantics in the codex auto-promote workflow.
- Workflow-level gates are now sufficient to be wired as required status checks in branch protection, but enforcement still depends on GitHub admin settings.

## Unclear
- Whether additional app surfaces should receive dedicated CI and deploy workflows.
- Whether codex auto-promote should remain force-reset based under stricter branch protection governance.

## Do not break
- Do not remove lockfile sync checks; they are current dependency integrity guardrail.
- Do not broaden deploy triggers without explicit review of `master`-only deployment assumption.
- Do not modify codex auto-promote behavior without confirming branch governance expectations.
- Do not remove backend regression gates from `.github/workflows/backend-regression-gates.yml` without replacing equivalent auth/authz, tenant-isolation, and session-flow coverage.
- Do not treat workflow presence alone as branch protection; required checks and code-owner requirements must still be configured in GitHub repository settings.
