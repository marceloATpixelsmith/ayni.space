do $$ begin
  create type credential_type as enum ('password');
exception when duplicate_object then null; end $$;

do $$ begin
  create type auth_token_type as enum ('email_verification', 'password_reset');
exception when duplicate_object then null; end $$;

create table if not exists platform.user_credentials (
  id text primary key,
  user_id text not null references platform.users(id) on delete cascade,
  credential_type credential_type not null default 'password',
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_credentials_user_type_unique unique (user_id, credential_type)
);

create index if not exists user_credentials_user_idx on platform.user_credentials(user_id);

create table if not exists platform.auth_tokens (
  id text primary key,
  user_id text not null references platform.users(id) on delete cascade,
  token_type auth_token_type not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists auth_tokens_user_type_idx on platform.auth_tokens(user_id, token_type);
create index if not exists auth_tokens_expires_idx on platform.auth_tokens(expires_at);
