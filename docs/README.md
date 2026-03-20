# Architecture Inventory (DRAFT)

This `/docs` folder contains **draft architecture inventory documents** generated from a direct code read of the current monorepo.

## Scope and intent
- This is **not** a target-state redesign.
- This is an inventory of what appears to exist **today**.
- Every section separates:
  - **Confirmed from code**
  - **Strong inference from code structure**
  - **Unclear / requires confirmation**

## Document index
1. `01-monorepo-overview.md`
2. `02-app-catalog.md`
3. `03-shared-packages.md`
4. `04-auth-and-session-inventory.md`
5. `05-authorization-and-access-model-inventory.md`
6. `06-tenant-isolation-and-data-ownership-inventory.md`
7. `07-observability-error-handling-and-sentry-inventory.md`
8. `08-dependency-lockfile-and-build-inventory.md`
9. `09-ci-cd-and-deploy-inventory.md`
10. `10-shared-systems-inventory.md`
11. `11-open-questions-and-conflicts.md`

## Reading notes
- “Confirmed” claims are grounded in current repository files.
- “Strong inference” means architecture intent is strongly suggested but not fully enforced in one place.
- “Unclear” flags uncertainty, drift, or conflict that should be resolved before hardening permanent architecture docs.
