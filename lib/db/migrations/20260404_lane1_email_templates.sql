do $$
begin
  create type email_template_type as enum ('invitation', 'email_verification', 'password_reset');
exception
  when duplicate_object then null;
end
$$;

create table if not exists platform.email_templates (
  id text primary key,
  app_id text,
  template_type email_template_type not null,
  subject_template text not null,
  html_template text not null,
  text_template text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists email_templates_app_type_unique
  on platform.email_templates(app_id, template_type);

create unique index if not exists email_templates_platform_default_type_unique
  on platform.email_templates(template_type)
  where app_id is null;

create index if not exists email_templates_app_idx on platform.email_templates(app_id);
create index if not exists email_templates_template_type_idx on platform.email_templates(template_type);

insert into platform.email_templates (id, app_id, template_type, subject_template, html_template, text_template, is_active)
values
  (
    gen_random_uuid()::text,
    null,
    'invitation',
    'You are invited to {{app_name}}',
    '<p>Hello {{full_name}},</p><p>You were invited to join {{organization_name}} on {{app_name}}.</p><p><a href="{{invitation_url}}">Accept invitation</a></p><p>This link expires at {{expiration_datetime}}.</p>',
    'Hello {{full_name}}, You were invited to join {{organization_name}} on {{app_name}}. Accept invitation: {{invitation_url}}. Expires at {{expiration_datetime}}.',
    true
  ),
  (
    gen_random_uuid()::text,
    null,
    'email_verification',
    'Verify your email for {{app_name}}',
    '<p>Hello {{full_name}},</p><p>Please verify your email for {{app_name}}.</p><p><a href="{{verification_url}}">Verify email</a></p><p>This link expires at {{expiration_datetime}}.</p>',
    'Hello {{full_name}}, verify your email for {{app_name}}: {{verification_url}}. Expires at {{expiration_datetime}}.',
    true
  ),
  (
    gen_random_uuid()::text,
    null,
    'password_reset',
    'Reset your password for {{app_name}}',
    '<p>Hello {{full_name}},</p><p>We received a request to reset your password for {{app_name}}.</p><p><a href="{{password_reset_url}}">Reset password</a></p><p>This link expires at {{expiration_datetime}}.</p>',
    'Hello {{full_name}}, reset your password for {{app_name}}: {{password_reset_url}}. Expires at {{expiration_datetime}}.',
    true
  )
on conflict do nothing;

insert into platform.email_templates (id, app_id, template_type, subject_template, html_template, text_template, is_active)
select
  gen_random_uuid()::text,
  a.id,
  'invitation'::email_template_type,
  a.invitation_email_subject,
  a.invitation_email_html,
  null,
  true
from platform.apps a
where a.invitation_email_subject is not null
  and a.invitation_email_html is not null
on conflict (app_id, template_type) do update
set
  subject_template = excluded.subject_template,
  html_template = excluded.html_template,
  updated_at = now();
