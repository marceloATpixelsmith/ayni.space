# Architecture Documentation Index

## Scope
- Index and reading order for architecture docs.
- `docs/01-monorepo-overview.md` is the canonical baseline for consistency checks.

## Confirmed
- Architecture docs currently live under `docs/*.md` and are intended to be read with `01-monorepo-overview.md` as source of truth.
- Domain-specific enforceable docs exist for shared packages, auth/session, authorization, tenancy, backend architecture, observability, security, dependency/lockfile, CI/CD, ownership, and codex working rules.

## Required reading order
1. `01-monorepo-overview.md` (source of truth)
2. Domain docs (`03-shared-packages.md` through `19-ci-cd-and-deploy-rules.md`, plus ownership/codex/governance docs)
3. Supporting inventories (`02-app-catalog.md`, auth/session and other inventory companions)
4. `16-open-questions-and-conflicts.md` for unresolved items

## Document index (all current docs)
1. `01-monorepo-overview.md`
2. `02-app-catalog.md`
3. `03-shared-packages.md`
4. `04-auth-and-session-inventory.md`
5. `05-authentication-and-session-architecture.md`
6. `06-authorization-and-access-model-inventory.md`
7. `07-authorization-roles-and-access-model.md`
8. `08-tenant-isolation-and-data-ownership-inventory.md`
9. `09-observability-error-handling-and-sentry-inventory.md`
10. `10-tenant-isolation-and-data-ownership.md`
11. `11-dependency-lockfile-and-build-inventory.md`
12. `12-api-and-backend-architecture.md`
13. `13-ci-cd-and-deploy-inventory.md`
14. `14-observability-error-handling-and-sentry.md`
15. `15-shared-systems-inventory.md`
16. `16-open-questions-and-conflicts.md`
17. `17-security-standards-and-non-negotiables.md`
18. `18-dependency-and-lockfile-rules.md`
19. `19-ci-cd-and-deploy-rules.md`
20. `20-ci-cd-and-deploy-chart.md`
21. `21-file-and-folder-ownership.md`
22. `22-codex-working-rules.md`
23. `23-safe-auto-merge-governance.md`

## Consistency policy
- Every architecture doc must include:
  - a clear `Scope`
  - concrete file/path references
  - `Confirmed`, `Inferred`, `Unclear`, and `Do not break` sections
- When conflicts appear, resolve toward `01-monorepo-overview.md` and carry remaining ambiguity into `16-open-questions-and-conflicts.md`.

## Inferred
- The doc set is intentionally split into canonical domain docs and companion inventory docs to preserve traceability while keeping enforceable rules explicit.

## Unclear
- Whether legacy companion inventories should be kept long-term or eventually consolidated into the enforceable domain docs.

## Do not break
- Do not index docs that contradict `01-monorepo-overview.md`.
- Do not remove required consistency sections from architecture docs.
