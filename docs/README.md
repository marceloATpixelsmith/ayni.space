# 25 — Architecture Documentation Index

## Scope
- Index and reading order for architecture docs.
- `docs/monorepo-overview.md` is the canonical baseline for consistency checks.

## Confirmed
- Architecture docs currently live under `docs/*.md` and are intended to be read with `monorepo-overview.md` as source of truth.
- Deployment model is host-native auto-deploy from `master` (Cloudflare Pages + Render) with GitHub Actions used for validation only.
- No PR auto-merge/promotion workflow file is part of active deployment automation.

## Required reading order
1. `monorepo-overview.md` (source of truth)
2. Domain docs (`shared-packages.md` through `ci-cd-and-deploy-rules.md`, plus ownership/codex docs)
3. Supporting inventories (`app-catalog.md`, auth/session and other inventory companions)
4. `open-questions-and-conflicts.md` for unresolved items

## Document index (all current docs)
### Canonical doc set
1. `README.md`
2. `monorepo-overview.md`
3. `app-catalog.md`
4. `shared-packages.md`
5. `auth-and-session-inventory.md`
6. `authentication-and-session-architecture.md`
7. `authorization-and-access-model-inventory.md`
8. `authorization-roles-and-access-model.md`
9. `tenant-isolation-and-data-ownership-inventory.md`
10. `tenant-isolation-and-data-ownership.md`
11. `dependency-lockfile-and-build-inventory.md`
12. `dependency-and-lockfile-rules.md`
13. `api-and-backend-architecture.md`
14. `ci-cd-and-deploy-inventory.md`
15. `ci-cd-and-deploy-rules.md`
16. `ci-cd-and-deploy-chart.md`
17. `observability-error-handling-and-sentry-inventory.md`
18. `observability-error-handling-and-sentry.md`
19. `shared-systems-inventory.md`
20. `security-standards-and-non-negotiables.md`
21. `security-backup-and-restore.md`
22. `security-incident-response.md`
23. `security-restore-drill-log.md`
24. `security-baseline-status.md`
25. `security-inventory-current-state.md`
26. `file-and-folder-ownership.md`
27. `codex-working-rules.md`
28. `open-questions-and-conflicts.md`

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
- Do not reference removed PR-promotion docs or workflows.
- Do not remove required consistency sections from architecture docs.
