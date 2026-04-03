alter table if exists platform.apps
  add column if not exists transactional_from_email text,
  add column if not exists transactional_from_name text,
  add column if not exists transactional_reply_to_email text,
  add column if not exists invitation_email_subject text,
  add column if not exists invitation_email_html text;
