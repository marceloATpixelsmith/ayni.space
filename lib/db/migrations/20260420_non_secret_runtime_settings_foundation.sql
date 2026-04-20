CREATE TABLE IF NOT EXISTS platform.settings (
  id text PRIMARY KEY,
  key text NOT NULL,
  value text NOT NULL,
  value_type text NOT NULL,
  description text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settings_key_unique UNIQUE (key),
  CONSTRAINT settings_value_type_check CHECK (value_type IN ('string', 'number', 'boolean', 'json'))
);

CREATE TABLE IF NOT EXISTS platform.app_settings (
  id text PRIMARY KEY,
  app_id text NOT NULL REFERENCES platform.apps(id) ON DELETE CASCADE,
  key text NOT NULL,
  value text NOT NULL,
  value_type text NOT NULL,
  description text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_settings_app_key_unique UNIQUE (app_id, key),
  CONSTRAINT app_settings_value_type_check CHECK (value_type IN ('string', 'number', 'boolean', 'json'))
);

INSERT INTO platform.settings (id, key, value, value_type, description)
VALUES
  ('setting_sentry_dsn', 'SENTRY_DSN', 'https://6e6f076be630637543a672bb6910ee16@o4511067811282944.ingest.us.sentry.io/4511067983052800', 'string', 'Backend Sentry DSN (non-secret runtime value)'),
  ('setting_sentry_environment', 'SENTRY_ENVIRONMENT', 'production', 'string', 'Backend Sentry environment label'),
  ('setting_google_redirect_uri', 'GOOGLE_REDIRECT_URI', 'https://api.ayni.space/api/auth/google/callback', 'string', 'Google OAuth redirect URI'),
  ('setting_turnstile_enabled', 'TURNSTILE_ENABLED', 'true', 'boolean', 'Enable Turnstile challenge enforcement'),
  ('setting_ipqs_block_threshold', 'IPQS_BLOCK_THRESHOLD', '85', 'number', 'IPQS definitive block threshold'),
  ('setting_ipqs_step_up_threshold', 'IPQS_STEP_UP_THRESHOLD', '60', 'number', 'IPQS advisory step-up threshold'),
  ('setting_ipqs_timeout_ms', 'IPQS_TIMEOUT_MS', '3000', 'number', 'IPQS request timeout in milliseconds'),
  ('setting_openai_max_retries', 'OPENAI_MAX_RETRIES', '2', 'number', 'OpenAI retry count for backend calls'),
  ('setting_openai_model', 'OPENAI_MODEL', 'gpt-5-mini', 'string', 'OpenAI model name'),
  ('setting_openai_temperature', 'OPENAI_TEMPERATURE', '0', 'number', 'OpenAI temperature value'),
  ('setting_openai_timeout_ms', 'OPENAI_TIMEOUT_MS', '2000', 'number', 'OpenAI timeout in milliseconds')
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  value_type = EXCLUDED.value_type,
  description = EXCLUDED.description,
  updated_at = now();

WITH seeded AS (
  SELECT * FROM (VALUES
    ('admin', 'https://admin.ayni.space', 'Ayni Admin'),
    ('ayni', 'https://ayni.ayni.space', 'Ayni'),
    ('shipibo', 'https://shipibo.ayni.space', 'Shipibo'),
    ('screening', 'https://screening.ayni.space', 'Ayni Screening')
  ) AS data(slug, origin, mfa_issuer)
), app_rows AS (
  SELECT a.id, a.slug, s.origin, s.mfa_issuer
  FROM platform.apps a
  JOIN seeded s ON s.slug = a.slug
)
INSERT INTO platform.app_settings (id, app_id, key, value, value_type, description)
SELECT 'app_setting_allowed_origin_' || app_rows.slug, app_rows.id, 'ALLOWED_ORIGIN', app_rows.origin, 'string', 'Allowed browser origin for app'
FROM app_rows
ON CONFLICT (app_id, key) DO UPDATE SET
  value = EXCLUDED.value,
  value_type = EXCLUDED.value_type,
  description = EXCLUDED.description,
  updated_at = now();

WITH seeded AS (
  SELECT * FROM (VALUES
    ('admin', 'https://admin.ayni.space', 'Ayni Admin'),
    ('ayni', 'https://ayni.ayni.space', 'Ayni'),
    ('shipibo', 'https://shipibo.ayni.space', 'Shipibo'),
    ('screening', 'https://screening.ayni.space', 'Ayni Screening')
  ) AS data(slug, origin, mfa_issuer)
), app_rows AS (
  SELECT a.id, a.slug, s.origin, s.mfa_issuer
  FROM platform.apps a
  JOIN seeded s ON s.slug = a.slug
)
INSERT INTO platform.app_settings (id, app_id, key, value, value_type, description)
SELECT 'app_setting_mfa_issuer_' || app_rows.slug, app_rows.id, 'MFA_ISSUER', app_rows.mfa_issuer, 'string', 'MFA issuer display label for app'
FROM app_rows
ON CONFLICT (app_id, key) DO UPDATE SET
  value = EXCLUDED.value,
  value_type = EXCLUDED.value_type,
  description = EXCLUDED.description,
  updated_at = now();
