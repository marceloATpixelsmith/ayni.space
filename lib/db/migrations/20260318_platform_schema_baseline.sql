-- Baseline schema for new environments.
-- This keeps existing incremental migrations idempotent while enabling one-step bootstraps on Render.

create extension if not exists citext;
create extension if not exists pgcrypto;

create schema if not exists platform;

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

create table if not exists platform.users (
  id text primary key,
  email text not null unique,
  name text,
  avatar_url text,
  password_hash text,
  google_subject text,
  email_verified_at timestamptz,
  is_super_admin boolean not null default false,
  active_org_id text,
  active boolean not null default true,
  suspended boolean not null default false,
  deleted_at timestamptz,
  last_login_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists platform.apps (
  id text primary key,
  name text not null,
  slug text not null unique,
  description text,
  icon_url text,
  access_mode app_access_mode not null default 'public_signup',
  tenancy_mode app_tenancy_mode not null default 'organization',
  onboarding_mode app_onboarding_mode not null default 'required',
  invites_allowed boolean not null default false,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists platform.organizations (
  id text primary key,
  name text not null,
  slug text not null unique,
  app_id text,
  owner_user_id text references platform.users(id) on delete set null,
  logo_url text,
  website text,
  billing_email citext,
  stripe_customer_id text unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists platform.org_memberships (
  id text primary key,
  user_id text not null references platform.users(id) on delete cascade,
  org_id text not null references platform.organizations(id) on delete cascade,
  role text not null default 'staff',
  membership_status text not null default 'active',
  invited_by_user_id text references platform.users(id) on delete set null,
  joined_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create table if not exists platform.invitations (
  id text primary key,
  app_id text,
  org_id text references platform.organizations(id) on delete cascade,
  email text not null,
  role text,
  invited_role text,
  token text not null unique,
  status text,
  invitation_status text not null default 'pending',
  invited_by_user_id text references platform.users(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_user_id text references platform.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists platform.subscriptions (
  id text primary key,
  org_id text not null references platform.organizations(id) on delete cascade,
  app_id text not null references platform.apps(id) on delete cascade,
  plan_id text not null,
  status text not null default 'active',
  stripe_subscription_id text unique,
  stripe_customer_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  trial_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists platform.feature_flags (
  id text primary key,
  key text not null,
  value boolean not null default false,
  org_id text,
  description text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists platform.audit_logs (
  id text primary key,
  org_id text,
  user_id text,
  user_email text,
  action text not null,
  resource_type text not null,
  resource_id text,
  metadata jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

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

create table if not exists platform.app_plans (
  id text primary key,
  app_id text not null references platform.apps(id) on delete cascade,
  name text not null,
  price_monthly integer not null default 0,
  stripe_price_id text,
  features text[] not null default '{}'::text[],
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists platform.org_app_access (
  id text primary key,
  org_id text not null references platform.organizations(id) on delete cascade,
  app_id text not null references platform.apps(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists platform.sessions (
  sid text primary key,
  sess jsonb not null,
  expire timestamptz not null
);

create table if not exists platform.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

create index if not exists users_active_idx on platform.users(active);
create index if not exists users_created_at_idx on platform.users(created_at desc);
create index if not exists organizations_slug_idx on platform.organizations(slug);
create index if not exists organizations_app_id_idx on platform.organizations(app_id);
create index if not exists org_memberships_org_id_idx on platform.org_memberships(org_id);
create index if not exists org_memberships_user_id_idx on platform.org_memberships(user_id);
create index if not exists invitations_email_idx on platform.invitations(email);
create index if not exists invitations_token_idx on platform.invitations(token);
create index if not exists user_app_access_user_id_idx on platform.user_app_access(user_id);
create index if not exists user_app_access_app_id_idx on platform.user_app_access(app_id);
create index if not exists sessions_expire_idx on platform.sessions(expire);

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
  is_active = excluded.is_active;
