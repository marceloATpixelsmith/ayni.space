CREATE TABLE IF NOT EXISTS platform.rate_limits (
  bucket_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  count integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rate_limits_window_started_at_idx
  ON platform.rate_limits (window_started_at);
