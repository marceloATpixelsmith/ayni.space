alter table if exists platform.invitations
  add column if not exists first_name text,
  add column if not exists last_name text;
