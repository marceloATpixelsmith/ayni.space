-- Align platform.apps auth model to app-level access_mode source of truth.
-- Valid access_mode values: superadmin | solo | organization

alter table if exists platform.apps add column if not exists onboarding_mode app_onboarding_mode not null default 'required';

-- Replace enum definition to remove deprecated values.
do $$ begin
  create type app_access_mode_new as enum ('superadmin', 'solo', 'organization');
exception when duplicate_object then null; end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'platform' and table_name = 'apps' and column_name = 'tenancy_mode'
  ) then
    execute $q$
      alter table if exists platform.apps
        alter column access_mode drop default,
        alter column access_mode type app_access_mode_new using (
          case
            when access_mode::text = 'superadmin' then 'superadmin'
            when access_mode::text = 'solo' then 'solo'
            when access_mode::text = 'organization' then 'organization'
            when access_mode::text = 'restricted' then 'superadmin'
            when access_mode::text = 'public_signup' and tenancy_mode::text = 'solo' then 'solo'
            else 'organization'
          end
        )::app_access_mode_new,
        alter column access_mode set default 'organization'
    $q$;
  else
    execute $q$
      alter table if exists platform.apps
        alter column access_mode drop default,
        alter column access_mode type app_access_mode_new using (
          case
            when access_mode::text = 'superadmin' then 'superadmin'
            when access_mode::text = 'solo' then 'solo'
            when access_mode::text = 'organization' then 'organization'
            when access_mode::text = 'restricted' then 'superadmin'
            else 'organization'
          end
        )::app_access_mode_new,
        alter column access_mode set default 'organization'
    $q$;
  end if;
end $$;

do $$ begin
  if exists (select 1 from pg_type where typname = 'app_access_mode') then
    drop type app_access_mode;
  end if;
end $$;
alter type app_access_mode_new rename to app_access_mode;

alter table if exists platform.apps drop column if exists tenancy_mode;
alter table if exists platform.apps drop column if exists invites_allowed;

do $$ begin
  if exists (select 1 from pg_type where typname = 'app_tenancy_mode') then
    drop type app_tenancy_mode;
  end if;
end $$;

update platform.apps set access_mode = 'superadmin'::app_access_mode, onboarding_mode = 'disabled' where slug = 'admin';
update platform.apps set access_mode = 'organization'::app_access_mode where slug = 'ayni';
update platform.apps set access_mode = 'solo'::app_access_mode where slug = 'shipibo';
