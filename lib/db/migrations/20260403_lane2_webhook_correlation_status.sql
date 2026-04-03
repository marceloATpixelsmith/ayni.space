create type email_webhook_correlation_status as enum ('linked', 'unlinked');

alter table platform.email_webhook_events
  add column correlation_status email_webhook_correlation_status not null default 'linked';

create index email_webhook_events_correlation_status_idx on platform.email_webhook_events(correlation_status);
