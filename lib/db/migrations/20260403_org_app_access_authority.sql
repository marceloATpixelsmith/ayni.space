-- Make org_app_access the authoritative org-to-app entitlement source.
-- Backfill legacy organizations.app_id into org_app_access and enforce lookup constraints.

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'org_app_access_org_fk') then
    alter table if exists platform.org_app_access
      add constraint org_app_access_org_fk
      foreign key (org_id) references platform.organizations(id) on delete cascade;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'org_app_access_app_fk') then
    alter table if exists platform.org_app_access
      add constraint org_app_access_app_fk
      foreign key (app_id) references platform.apps(id) on delete cascade;
  end if;
end $$;

create unique index if not exists org_app_access_org_app_unique
  on platform.org_app_access(org_id, app_id);

create index if not exists org_app_access_org_id_idx
  on platform.org_app_access(org_id);

create index if not exists org_app_access_app_id_idx
  on platform.org_app_access(app_id);

insert into platform.org_app_access (id, org_id, app_id, enabled, created_at, updated_at)
select
  gen_random_uuid()::text,
  o.id,
  o.app_id,
  true,
  now(),
  now()
from platform.organizations o
where o.app_id is not null
on conflict (org_id, app_id) do nothing;
