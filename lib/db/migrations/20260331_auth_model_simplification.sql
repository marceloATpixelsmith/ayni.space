-- Simplify platform app auth model: access_mode is app-level auth only.
-- Valid access modes: superadmin, solo, organization.

-- Replace access enum with strict values.
do $$ begin
  create type app_access_mode_v2 as enum ('superadmin', 'solo', 'organization');
exception when duplicate_object then null; end $$;

alter table platform.apps
  alter column access_mode drop default,
  alter column access_mode type app_access_mode_v2
  using (
    case
      when access_mode::text = 'restricted' then 'superadmin'
      when access_mode::text = 'public_signup' and tenancy_mode::text = 'solo' then 'solo'
      when access_mode::text = 'public_signup' then 'organization'
      else access_mode::text
    end
  )::app_access_mode_v2,
  alter column access_mode set default 'organization';

drop type if exists app_access_mode;
alter type app_access_mode_v2 rename to app_access_mode;

-- Remove app-level tenancy and invite controls from auth model.
alter table platform.apps drop column if exists tenancy_mode;
alter table platform.apps drop column if exists invites_allowed;
drop type if exists app_tenancy_mode;

-- Ensure seeded canonical app modes align with the new model.
insert into platform.apps (id, slug, name, access_mode, onboarding_mode, is_active)
values
  ('admin', 'admin', 'Admin', 'superadmin', 'disabled', true),
  ('ayni', 'ayni', 'Ayni', 'organization', 'required', true),
  ('shipibo', 'shipibo', 'Shipibo', 'solo', 'light', true)
on conflict (id) do update set
  slug = excluded.slug,
  name = excluded.name,
  access_mode = excluded.access_mode,
  onboarding_mode = excluded.onboarding_mode,
  is_active = excluded.is_active,
  updated_at = now();
