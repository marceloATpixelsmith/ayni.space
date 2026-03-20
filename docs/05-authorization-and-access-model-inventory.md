# 05 — Authorization and Access Model Inventory (DRAFT)

## Confirmed from code

### Backend authorization primitives
- `requireAuth`: authenticated active user required.
- `requireSuperAdmin`: requires `users.isSuperAdmin` + active `user_app_access` for app slug `admin`.
- `requireOrgAccess`: requires active org membership for `:orgId`.
- `requireOrgAdmin`: requires org role at/above `org_admin` by ordered role array.
- `requireAppAccess(appSlug)`: resolves app context and enforces access mode + onboarding requirements.

### Role constructs in current implementation
- Membership roles in code paths include `org_owner`, `org_admin`, `staff`.
- App-level user access represented via `platform.user_app_access` with `role` + `access_status`.
- App registry includes `access_mode`, `tenancy_mode`, `onboarding_mode`, `invites_allowed`.

### Route-level patterns
- Org-scoped admin operations use `requireOrgAdmin` (memberships, invitations, org updates).
- Admin platform endpoints use `requireSuperAdmin`.
- App module routes (`/shipibo`, `/ayni`) use `requireAuth` + `requireAppAccess("slug")`.

## Strong inference from code structure
- Authorization intent appears layered:
  1. identity/session validity,
  2. org membership role checks,
  3. app-specific access checks,
  4. optional onboarding gate before app usage.
- System is designed for **future non-org tenancy modes** (`none`, `solo`) even where current business logic is mostly org-centric.

## Unclear / requires confirmation
- Role taxonomy drift:
  - docs mention `owner/admin/member/viewer`,
  - runtime code largely uses `org_owner/org_admin/staff`,
  - some comments/spec references include `member/viewer` patterns.
- `requireOrgAdmin` uses ordered array comparison; introducing unknown roles may create unintended precedence.
- App access checks combine membership and app access in ways that may need policy clarification for each `tenancy_mode`.
