# 25 — Architecture Documentation Index

## Scope
- Index and reading order for architecture docs.
- `docs/monorepo-overview.md` is the canonical baseline for consistency checks.

## Confirmed
- Auth route composition helpers for thin admin auth pages now live in `lib/frontend-security/src/auth-page-orchestration.ts` and are consumed by `apps/admin/src/pages/auth/Login.tsx` and `Signup.tsx`.
- Architecture docs currently live under `docs/*.md` and are intended to be read with `monorepo-overview.md` as source of truth.
- Current GitHub Actions workflows are CI/policy automation (validation, lockfile integrity, history policy, and Codex PR automation) rather than frontend deploy execution.
- Admin frontend deploys are intended to be handled by Vercel Git integration from `master` (configured in Vercel, not as a repository workflow).

## Required reading order
1. `monorepo-overview.md` (source of truth)
2. Domain docs (`shared-packages.md` through `ci-cd-and-deploy-rules.md`, plus ownership/codex docs)
3. Supporting inventories (`app-catalog.md`, auth/session and other inventory companions, including `system-baseline-audit.md`)
4. `open-questions-and-conflicts.md` for unresolved items

## Document index (all current docs)
### Canonical doc set
1. `README.md`
2. `ARCHITECTURE_RULES.md`
3. `monorepo-overview.md`
4. `app-catalog.md`
5. `shared-packages.md`
6. `auth-and-session-inventory.md`
7. `authentication-and-session-architecture.md`
8. `authorization-and-access-model-inventory.md`
9. `authorization-roles-and-access-model.md`
10. `session-group-authorization-boundary.md`
11. `tenant-isolation-and-data-ownership-inventory.md`
12. `tenant-isolation-and-data-ownership.md`
13. `dependency-lockfile-and-build-inventory.md`
14. `dependency-and-lockfile-rules.md`
15. `api-and-backend-architecture.md`
16. `ci-cd-and-deploy-inventory.md`
17. `ci-cd-and-deploy-rules.md`
18. `ci-cd-and-deploy-chart.md`
19. `observability-error-handling-and-sentry-inventory.md`
20. `observability-error-handling-and-sentry.md`
21. `shared-systems-inventory.md`
22. `security-standards-and-non-negotiables.md`
23. `security-backup-and-restore.md`
24. `security-incident-response.md`
25. `security-restore-drill-log.md`
26. `security-baseline-status.md`
27. `security-inventory-current-state.md`
28. `file-and-folder-ownership.md`
29. `codex-working-rules.md`
30. `open-questions-and-conflicts.md`
31. `auth-security-regression-suite.md`
32. `transactional-email-lane2-architecture.md`
33. `system-baseline-audit.md`

### Numbered compatibility copies
- `06-authorization-and-access-model-inventory.md`
- `07-authorization-roles-and-access-model.md`
- `08-tenant-isolation-and-data-ownership-inventory.md`
- `09-observability-error-handling-and-sentry-inventory.md`
- `10-tenant-isolation-and-data-ownership.md`
- `11-dependency-lockfile-and-build-inventory.md`
- `12-api-and-backend-architecture.md`
- `13-ci-cd-and-deploy-inventory.md`
- `14-observability-error-handling-and-sentry.md`
- `15-shared-systems-inventory.md`
- `16-open-questions-and-conflicts.md`
- `17-security-standards-and-non-negotiables.md`
- `18-dependency-and-lockfile-rules.md`
- `19-ci-cd-and-deploy-rules.md`
- `20-ci-cd-and-deploy-chart.md`
- `21-file-and-folder-ownership.md`
- `22-codex-working-rules.md`

## Consistency policy
- Every architecture doc must include:
  - a clear `Scope`
  - concrete file/path references
  - `Confirmed`, `Inferred`, `Unclear`, and `Do not break` sections
- When conflicts appear, resolve toward `monorepo-overview.md` and carry remaining ambiguity into `open-questions-and-conflicts.md`.

## Inferred
- The doc set is intentionally split into canonical domain docs and companion inventory docs to preserve traceability while keeping enforceable rules explicit.
- Numbered files are compatibility aliases and should not diverge from canonical documents.

## Unclear
- Whether legacy numbered compatibility copies should be removed once all tooling references canonical names.

## Do not break
- Do not index docs that contradict `monorepo-overview.md`.
- Do not remove required consistency sections from architecture docs.
