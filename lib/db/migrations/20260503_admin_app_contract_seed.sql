-- Ensure /api/apps contract always has an active canonical admin app row in persisted environments.
insert into platform.apps (
  id,
  name,
  slug,
  domain,
  access_mode,
  staff_invites_enabled,
  customer_registration_enabled,
  is_active,
  metadata
)
select
  'app-admin',
  'Admin',
  'admin',
  'admin.local',
  'organization'::app_access_mode,
  true,
  true,
  true,
  '{}'::jsonb
where not exists (
  select 1 from platform.apps where slug = 'admin'
);
