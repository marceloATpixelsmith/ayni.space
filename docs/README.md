# Architecture Documentation Index

This `/docs` folder contains architecture inventory and rules documents aligned to the current codebase.

## Baseline rule
- `01-monorepo-overview.md` is the canonical baseline. Other docs should align with it and must not contradict it.

## Document index (all current docs)
1. `01-monorepo-overview.md` — monorepo-wide architecture baseline.
2. `02-app-catalog.md` — app-level inventory.
3. `03-shared-packages.md` — shared `lib/*` and `packages/*` reality.
4. `04-auth-and-session-inventory.md` — legacy inventory draft.
5. `05-authorization-and-access-model-inventory.md` — legacy inventory draft.
6. `05-authentication-and-session-architecture.md` — authentication/session architecture.
7. `06-tenant-isolation-and-data-ownership-inventory.md` — legacy inventory draft.
8. `06-authorization-roles-and-access-model.md` — authorization roles/access model.
9. `07-observability-error-handling-and-sentry-inventory.md` — legacy inventory draft.
10. `07-tenant-isolation-and-data-ownership.md` — tenancy/data ownership architecture.
11. `08-dependency-lockfile-and-build-inventory.md` — legacy inventory draft.
12. `09-api-and-backend-architecture.md` — backend/API structure and boundaries.
13. `09-ci-cd-and-deploy-inventory.md` — legacy inventory draft.
14. `10-observability-error-handling-and-sentry.md` — observability/error/Sentry architecture.
15. `10-shared-systems-inventory.md` — legacy inventory draft.
16. `11-open-questions-and-conflicts.md` — legacy inventory draft.
17. `11-security-standards-and-non-negotiables.md` — security standards tied to current architecture.
18. `12-dependency-and-lockfile-rules.md` — dependency and lockfile governance rules.
19. `13-ci-cd-and-deploy-rules.md` — CI/CD and deployment governance rules.
20. `16-file-and-folder-ownership.md` — ownership map by directory/workflow.
21. `17-codex-working-rules.md` — working rules for architecture-doc maintenance.

## Reading guidance
- Treat **Confirmed** sections as directly grounded in current code/overview.
- Treat **Inferred** sections as implementation-aligned interpretation.
- Treat **Unclear** sections as unresolved items that need explicit decisions.
- Treat **Do not break** sections as guardrails for refactors and future changes.
