create type email_provider as enum ('brevo', 'mailchimp_transactional');
create type email_connection_status as enum ('pending', 'validated', 'invalid', 'disabled');
create type email_lane as enum ('lane1', 'lane2');
create type email_attempt_result as enum ('accepted', 'queued', 'rejected', 'failed');
create type email_delivery_state as enum (
  'pending',
  'accepted',
  'scheduled',
  'sent',
  'delivered',
  'opened',
  'clicked',
  'bounced_soft',
  'bounced_hard',
  'deferred',
  'complained',
  'unsubscribed',
  'blocked',
  'rejected',
  'failed',
  'cancelled'
);
create type email_normalized_event_type as enum (
  'pending',
  'accepted',
  'scheduled',
  'sent',
  'delivered',
  'opened',
  'clicked',
  'bounced_soft',
  'bounced_hard',
  'deferred',
  'complained',
  'unsubscribed',
  'blocked',
  'rejected',
  'failed',
  'cancelled'
);

create table platform.tenant_email_provider_connections (
  id text primary key,
  org_id text not null references platform.organizations(id) on delete cascade,
  app_id text not null references platform.apps(id) on delete cascade,
  provider email_provider not null,
  status email_connection_status not null default 'pending',
  display_label text not null,
  default_sender_name text,
  default_sender_email text,
  default_reply_to text,
  encrypted_credentials text not null,
  credential_key_version text not null default 'v1',
  last_validated_at timestamptz,
  last_validation_status text,
  last_validation_error text,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tenant_email_provider_connections_org_idx on platform.tenant_email_provider_connections(org_id);
create index tenant_email_provider_connections_app_idx on platform.tenant_email_provider_connections(app_id);
create index tenant_email_provider_connections_org_app_provider_idx on platform.tenant_email_provider_connections(org_id, app_id, provider);

create table platform.outbound_email_logs (
  id text primary key,
  lane email_lane not null default 'lane2',
  org_id text references platform.organizations(id) on delete set null,
  app_id text not null references platform.apps(id) on delete restrict,
  provider email_provider not null,
  provider_connection_id text references platform.tenant_email_provider_connections(id) on delete set null,
  correlation_id text not null,
  idempotency_key text,
  actor_user_id text,
  requested_payload_snapshot jsonb not null default '{}'::jsonb,
  requested_subject text,
  requested_from text,
  requested_to text[] not null default '{}',
  requested_template_reference text,
  requested_scheduled_at timestamptz,
  attempt_result email_attempt_result not null default 'failed',
  delivery_state email_delivery_state not null default 'pending',
  provider_message_id text,
  provider_request_id text,
  normalized_error_code text,
  normalized_error_message text,
  provider_response_snapshot jsonb not null default '{}'::jsonb,
  accepted_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index outbound_email_logs_org_idx on platform.outbound_email_logs(org_id);
create index outbound_email_logs_provider_msg_idx on platform.outbound_email_logs(provider, provider_message_id);
create index outbound_email_logs_correlation_idx on platform.outbound_email_logs(correlation_id);
create index outbound_email_logs_state_idx on platform.outbound_email_logs(delivery_state);

create table platform.email_webhook_events (
  id text primary key,
  provider email_provider not null,
  raw_provider_event_type text not null,
  normalized_event_type email_normalized_event_type not null,
  provider_message_id text,
  recipient text,
  delivery_state email_delivery_state,
  reason text,
  diagnostic text,
  raw_payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  linked_outbound_email_log_id text references platform.outbound_email_logs(id) on delete set null,
  created_at timestamptz not null default now()
);

create index email_webhook_events_provider_msg_idx on platform.email_webhook_events(provider, provider_message_id);
create index email_webhook_events_linked_log_idx on platform.email_webhook_events(linked_outbound_email_log_id);
create index email_webhook_events_received_idx on platform.email_webhook_events(received_at);
