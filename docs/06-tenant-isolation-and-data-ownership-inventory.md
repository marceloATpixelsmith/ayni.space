# 06 — Tenant Isolation and Data Ownership Inventory (DRAFT)

## Confirmed from code

### Data model
- `platform.organizations` is the core tenant container for organization-mode flows.
- `platform.org_memberships` maps user ↔ organization with role + status.
- `users.active_org_id` stores selected working org context.
- Domain data tables for apps:
  - Shipibo schema tables (`shipibo_words`, `shipibo_categories`)
  - Ayni schema tables (`ayni_ceremonies`, `ayni_participants`, `ayni_staff`)
- Billing, invitations, feature flags, and audit logs all have org-linked variants.

### Tenant gating in API
- Many org routes enforce `requireOrgAccess` / `requireOrgAdmin` based on `:orgId`.
- App access middleware checks both active org membership and/or app access grants.
- Org switch endpoint validates membership before changing session/user `activeOrgId`.

### Physical isolation posture
- Isolation is **logical/shared-database** (single DB + scoped rows), not per-tenant DB/schema.
- Distinct Postgres schemas (`platform`, `shipibo`, `ayni`) separate domains but are not tenant-specific.

## Strong inference from code structure
- Organization-mode is current default tenancy; non-org modes are scaffolded for future expansion.
- App registry + access tables suggest future apps can choose tenancy mode and onboarding pattern.

## Unclear / requires confirmation
- Some app endpoints accept `orgId` from query/body and rely primarily on app access checks; verify consistent enforcement that requester belongs to that org for all mutations/reads.
- `organizations.app_id` exists while orgs can have subscriptions across multiple apps; exact ownership semantics need clarification.
- Cross-schema data ownership boundaries (who can read/write `ayni.*` vs `shipibo.*`) are not centrally documented in policy code.
