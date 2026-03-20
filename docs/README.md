# 24 — Architecture Documentation Index

## Scope
- Index and reading order for architecture docs.
- `docs/monorepo-overview.md` is the canonical baseline for consistency checks.

## Confirmed
- Architecture docs currently live under `docs/*.md` and are intended to be read with `monorepo-overview.md` as source of truth.
- Domain-specific enforceable docs exist for shared packages, auth/session, authorization, tenancy, backend architecture, observability, security, dependency/lockfile, CI/CD, ownership, and codex working rules.

## Required reading order
1. `monorepo-overview.md` (source of truth)
2. Domain docs (`shared-packages.md` through `ci-cd-and-deploy-rules.md`, plus ownership/codex/governance docs)
3. Supporting inventories (`app-catalog.md`, auth/session and other inventory companions)
4. `open-questions-and-conflicts.md` for unresolved items

## Document index (all current docs)
1. `monorepo-overview.md`
2. `app-catalog.md`
3. `shared-packages.md`
4. `auth-and-session-inventory.md`
5. `authentication-and-session-architecture.md`
6. `authorization-and-access-model-inventory.md`
7. `authorization-roles-and-access-model.md`
8. `tenant-isolation-and-data-ownership-inventory.md`
9. `observability-error-handling-and-sentry-inventory.md`
10. `tenant-isolation-and-data-ownership.md`
11. `dependency-lockfile-and-build-inventory.md`
12. `api-and-backend-architecture.md`
13. `ci-cd-and-deploy-inventory.md`
14. `observability-error-handling-and-sentry.md`
15. `shared-systems-inventory.md`
16. `open-questions-and-conflicts.md`
17. `security-standards-and-non-negotiables.md`
18. `dependency-and-lockfile-rules.md`
19. `ci-cd-and-deploy-rules.md`
20. `ci-cd-and-deploy-chart.md`
21. `file-and-folder-ownership.md`
22. `codex-working-rules.md`
23. `safe-auto-merge-governance.md`

## Consistency policy
- Every architecture doc must include:
  - a clear `Scope`
  - concrete file/path references
  - `Confirmed`, `Inferred`, `Unclear`, and `Do not break` sections
- When conflicts appear, resolve toward `monorepo-overview.md` and carry remaining ambiguity into `open-questions-and-conflicts.md`.

## Inferred
- The doc set is intentionally split into canonical domain docs and companion inventory docs to preserve traceability while keeping enforceable rules explicit.

## Unclear
- Whether legacy companion inventories should be kept long-term or eventually consolidated into the enforceable domain docs.

## Do not break
- Do not index docs that contradict `monorepo-overview.md`.
- Do not remove required consistency sections from architecture docs.
