-- Complete non-secret runtime settings rollout with canonical seed values.

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

WITH app_seed AS (
  SELECT * FROM (VALUES
    ('admin', 'Ayni Admin', 'true', 'production', 'https://63816b2d3a49fb681239bc9a06c6f813@o4511067811282944.ingest.us.sentry.io/4511067970666496', '/', 'https://api.ayni.space', 'admin'),
    ('ayni', 'Ayni', 'true', 'production', 'https://63816b2d3a49fb681239bc9a06c6f813@o4511067811282944.ingest.us.sentry.io/4511067970666496', '/', 'https://api.ayni.space', 'ayni'),
    ('shipibo', 'Shipibo', 'true', 'production', 'https://63816b2d3a49fb681239bc9a06c6f813@o4511067811282944.ingest.us.sentry.io/4511067970666496', '/', 'https://api.ayni.space', 'shipibo'),
    ('screening', 'Ayni Screening', 'true', 'production', 'https://63816b2d3a49fb681239bc9a06c6f813@o4511067811282944.ingest.us.sentry.io/4511067970666496', '/', 'https://api.ayni.space', 'screening')
  ) AS data(slug, mfa_issuer, vite_auth_debug, vite_sentry_environment, vite_sentry_dsn, base_path, vite_api_base_url, vite_app_slug)
), app_rows AS (
  SELECT
    a.id AS app_id,
    a.slug AS app_slug,
    s.mfa_issuer,
    s.vite_auth_debug,
    s.vite_sentry_environment,
    s.vite_sentry_dsn,
    s.base_path,
    s.vite_api_base_url,
    s.vite_app_slug
  FROM platform.apps a
  JOIN app_seed s ON s.slug = a.slug
), app_kv AS (
  SELECT app_rows.app_id, app_rows.app_slug, 'MFA_ISSUER'::text AS key, app_rows.mfa_issuer::text AS value, 'string'::text AS value_type, 'MFA issuer display label for app'::text AS description FROM app_rows
  UNION ALL SELECT app_rows.app_id, app_rows.app_slug, 'VITE_AUTH_DEBUG', app_rows.vite_auth_debug, 'boolean', 'Frontend auth debug panel toggle' FROM app_rows
  UNION ALL SELECT app_rows.app_id, app_rows.app_slug, 'VITE_SENTRY_ENVIRONMENT', app_rows.vite_sentry_environment, 'string', 'Frontend Sentry environment label' FROM app_rows
  UNION ALL SELECT app_rows.app_id, app_rows.app_slug, 'VITE_SENTRY_DSN', app_rows.vite_sentry_dsn, 'string', 'Frontend Sentry DSN (non-secret runtime value)' FROM app_rows
  UNION ALL SELECT app_rows.app_id, app_rows.app_slug, 'BASE_PATH', app_rows.base_path, 'string', 'Frontend app base path' FROM app_rows
  UNION ALL SELECT app_rows.app_id, app_rows.app_slug, 'VITE_API_BASE_URL', app_rows.vite_api_base_url, 'string', 'Frontend API base URL bootstrap/runtime mirror' FROM app_rows
  UNION ALL SELECT app_rows.app_id, app_rows.app_slug, 'VITE_APP_SLUG', app_rows.vite_app_slug, 'string', 'Frontend app slug bootstrap/runtime mirror' FROM app_rows
)
INSERT INTO platform.app_settings (id, app_id, key, value, value_type, description)
SELECT 'app_setting_' || lower(app_kv.app_slug) || '_' || lower(app_kv.key), app_kv.app_id, app_kv.key, app_kv.value, app_kv.value_type, app_kv.description
FROM app_kv
ON CONFLICT (app_id, key) DO UPDATE SET
  value = EXCLUDED.value,
  value_type = EXCLUDED.value_type,
  description = EXCLUDED.description,
  updated_at = now();
