-- Safe migration for reusable multi-app auth/access architecture.
create extension if not exists citext;
create extension if not exists pgcrypto;
create schema if not exists platform;

-- Enums for config-driven app behavior.
do $$ begin
  create type app_access_mode as enum ('restricted', 'public_signup');
exception when duplicate_object then null; end $$;
do $$ begin
  create type app_tenancy_mode as enum ('none', 'organization', 'solo');
exception when duplicate_object then null; end $$;
do $$ begin
  create type app_onboarding_mode as enum ('disabled', 'required', 'light');
exception when duplicate_object then null; end $$;
do $$ begin
  create type access_status as enum ('pending', 'active', 'revoked', 'suspended');
exception when duplicate_object then null; end $$;

alter table if exists platform.users add column if not exists password_hash text;
alter table if exists platform.users add column if not exists google_subject text;
alter table if exists platform.users add column if not exists email_verified_at timestamptz;
alter table if exists platform.users add column if not exists active boolean not null default true;
alter table if exists platform.users add column if not exists suspended boolean not null default false;

-- Backfill from legacy google_id if present.
do $$ begin
  if exists (
    select 1 from information_schema.columns where table_schema='platform' and table_name='users' and column_name='google_id'
  ) then
    execute 'update platform.users set google_subject = coalesce(google_subject, google_id)';
  end if;
end $$;

create unique index if not exists users_google_subject_unique on platform.users(google_subject) where google_subject is not null;
create index if not exists users_active_idx on platform.users(active);
create index if not exists users_created_at_idx on platform.users(created_at desc);

alter table if exists platform.apps add column if not exists access_mode app_access_mode not null default 'public_signup';
alter table if exists platform.apps add column if not exists tenancy_mode app_tenancy_mode not null default 'organization';
alter table if exists platform.apps add column if not exists onboarding_mode app_onboarding_mode not null default 'required';
alter table if exists platform.apps add column if not exists invites_allowed boolean not null default false;
alter table if exists platform.apps add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists platform.user_app_access (
  id text primary key,
  user_id text not null references platform.users(id) on delete cascade,
  app_id text not null references platform.apps(id) on delete cascade,
  role text not null,
  access_status access_status not null default 'active',
  granted_by_user_id text references platform.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, app_id)
);
create index if not exists user_app_access_user_id_idx on platform.user_app_access(user_id);
create index if not exists user_app_access_app_id_idx on platform.user_app_access(app_id);

alter table if exists platform.organizations add column if not exists app_id text;
alter table if exists platform.organizations add column if not exists owner_user_id text references platform.users(id) on delete set null;
alter table if exists platform.organizations add column if not exists billing_email citext;
alter table if exists platform.organizations add column if not exists is_active boolean not null default true;

-- Map old app IDs where available (slug match) and default to ayni.
update platform.organizations o
set app_id = coalesce(o.app_id, a.id)
from platform.apps a
where a.slug = 'ayni' and o.app_id is null;

alter table if exists platform.organizations alter column app_id set not null;
create index if not exists organizations_slug_idx on platform.organizations(slug);

alter table if exists platform.org_memberships add column if not exists id text;
update platform.org_memberships set id = gen_random_uuid()::text where id is null;
alter table if exists platform.org_memberships alter column id set not null;
alter table if exists platform.org_memberships add column if not exists membership_status text not null default 'active';
alter table if exists platform.org_memberships add column if not exists invited_by_user_id text references platform.users(id) on delete set null;
alter table if exists platform.org_memberships add column if not exists joined_at timestamptz;
alter table if exists platform.org_memberships add column if not exists metadata jsonb not null default '{}'::jsonb;
create unique index if not exists org_memberships_org_user_unique on platform.org_memberships(org_id, user_id);
create index if not exists org_memberships_org_id_idx on platform.org_memberships(org_id);
create index if not exists org_memberships_user_id_idx on platform.org_memberships(user_id);

alter table if exists platform.invitations add column if not exists app_id text;
alter table if exists platform.invitations add column if not exists invited_role text;
alter table if exists platform.invitations add column if not exists invitation_status text not null default 'pending';
alter table if exists platform.invitations add column if not exists accepted_at timestamptz;
alter table if exists platform.invitations add column if not exists accepted_user_id text references platform.users(id) on delete set null;
alter table if exists platform.invitations add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Backfill from legacy columns.
update platform.invitations set invited_role = coalesce(invited_role, role, 'staff');
update platform.invitations set invitation_status =
  case
    when invitation_status is not null then invitation_status
    when status = 'cancelled' then 'revoked'
    else coalesce(status, 'pending')
  end;

update platform.invitations i
set app_id = coalesce(i.app_id, o.app_id)
from platform.organizations o
where i.org_id = o.id and i.app_id is null;

create index if not exists invitations_email_idx on platform.invitations(email);
create unique index if not exists invitations_token_unique on platform.invitations(token);

-- Seed/normalize current reference apps.
insert into platform.apps (id, slug, name, access_mode, tenancy_mode, onboarding_mode, invites_allowed, is_active)
values
  ('admin', 'admin', 'Admin', 'restricted', 'none', 'disabled', false, true),
  ('ayni', 'ayni', 'Ayni', 'public_signup', 'organization', 'required', true, true),
  ('shipibo', 'shipibo', 'Shipibo', 'public_signup', 'solo', 'light', false, true)
on conflict (id) do update set
  slug = excluded.slug,
  name = excluded.name,
  access_mode = excluded.access_mode,
  tenancy_mode = excluded.tenancy_mode,
  onboarding_mode = excluded.onboarding_mode,
  invites_allowed = excluded.invites_allowed,
  is_active = excluded.is_active,
  updated_at = now();

-- Ensure slug uniqueness for seed compatibility.
insert into platform.apps (id, slug, name, access_mode, tenancy_mode, onboarding_mode, invites_allowed, is_active)
select slug, slug, initcap(slug), 'public_signup', 'organization', 'required', false, true
from (values ('admin'), ('ayni'), ('shipibo')) as s(slug)
where not exists (select 1 from platform.apps a where a.slug = s.slug);
