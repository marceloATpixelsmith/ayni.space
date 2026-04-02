-- Final access/onboarding architecture alignment.
-- access_mode drives top-level behavior: superadmin | solo | organization.
-- onboarding_mode is removed in favor of organization-only capability flags.

alter table if exists platform.apps
  add column if not exists staff_invites_enabled boolean not null default false,
  add column if not exists customer_registration_enabled boolean not null default false;

-- Preserve existing organization invitation behavior as a compatibility default.
update platform.apps
set staff_invites_enabled = true
where access_mode = 'organization'::app_access_mode;

alter table if exists platform.apps
  drop column if exists onboarding_mode;
