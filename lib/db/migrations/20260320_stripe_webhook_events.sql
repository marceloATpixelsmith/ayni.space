CREATE TABLE IF NOT EXISTS "platform"."stripe_webhook_events" (
  "event_id" text PRIMARY KEY,
  "event_type" text NOT NULL,
  "processed_at" timestamptz NOT NULL DEFAULT now()
);
