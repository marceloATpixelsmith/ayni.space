# 13 — CI/CD and Deploy Rules

## Confirmed
- `.github/workflows/lockfile-sync-check.yml` enforces install/lockfile consistency with `pnpm install --frozen-lockfile`.
- `.github/workflows/admin-security-shell-test-and-deploy.yml`:
  - runs admin shell contract test (`pnpm --filter @workspace/admin run test:security-shell`),
  - deploys only on push to `master`,
  - uses workflow path filters focused on admin + workspace metadata.
- `.github/workflows/codex-auto-promote.yml` automates promotion by force-resetting `master` to the codex PR branch state.

## Inferred
- Current CI is intentionally narrow: admin shell and lockfile integrity are enforced, while broad backend test coverage is not.
- Release governance assumes force-push semantics in the codex auto-promote workflow.

## Unclear
- Required backend/API test gates before deployment are not defined in current workflow set.
- Whether additional app surfaces should receive dedicated CI and deploy workflows.

## Do not break
- Do not remove lockfile sync checks; they are current dependency integrity guardrail.
- Do not broaden deploy triggers without explicit review of `master`-only deployment assumption.
- Do not modify codex auto-promote behavior without confirming branch governance expectations.
- Do not assume CI covers backend route-level regression risks today; treat this as a known gap.
