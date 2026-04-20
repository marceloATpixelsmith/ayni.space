WITH seeded AS (
  SELECT *
  FROM (VALUES
    ('admin', 'true', 'production', 'https://63816b2d3a49fb681239bc9a06c6f813@o4511067811282944.ingest.us.sentry.io/4511067970666496', '/', 'https://api.ayni.space', 'admin', '0x4AAAAAAB9LjVgfMYRntfDt'),
    ('ayni', 'true', 'production', 'https://63816b2d3a49fb681239bc9a06c6f813@o4511067811282944.ingest.us.sentry.io/4511067970666496', '/', 'https://api.ayni.space', 'ayni', '0x4AAAAAAB9LjVgfMYRntfDt'),
    ('shipibo', 'true', 'production', 'https://63816b2d3a49fb681239bc9a06c6f813@o4511067811282944.ingest.us.sentry.io/4511067970666496', '/', 'https://api.ayni.space', 'shipibo', '0x4AAAAAAB9LjVgfMYRntfDt'),
    ('screening', 'true', 'production', 'https://63816b2d3a49fb681239bc9a06c6f813@o4511067811282944.ingest.us.sentry.io/4511067970666496', '/', 'https://api.ayni.space', 'screening', '0x4AAAAAAB9LjVgfMYRntfDt')
  ) AS data(slug, auth_debug, sentry_environment, sentry_dsn, base_path, api_base_url, app_slug, turnstile_site_key)
), app_rows AS (
  SELECT a.id, a.slug, s.auth_debug, s.sentry_environment, s.sentry_dsn, s.base_path, s.api_base_url, s.app_slug, s.turnstile_site_key
  FROM platform.apps a
  JOIN seeded s ON s.slug = a.slug
), kv AS (
  SELECT app_rows.id AS app_id, app_rows.slug, 'VITE_AUTH_DEBUG' AS key, app_rows.auth_debug AS value, 'boolean'::text AS value_type, 'Frontend auth debug panel toggle'::text AS description FROM app_rows
  UNION ALL
  SELECT app_rows.id, app_rows.slug, 'VITE_SENTRY_ENVIRONMENT', app_rows.sentry_environment, 'string', 'Frontend Sentry environment label' FROM app_rows
  UNION ALL
  SELECT app_rows.id, app_rows.slug, 'VITE_SENTRY_DSN', app_rows.sentry_dsn, 'string', 'Frontend Sentry DSN (non-secret runtime value)' FROM app_rows
  UNION ALL
  SELECT app_rows.id, app_rows.slug, 'BASE_PATH', app_rows.base_path, 'string', 'Frontend app base path' FROM app_rows
  UNION ALL
  SELECT app_rows.id, app_rows.slug, 'VITE_API_BASE_URL', app_rows.api_base_url, 'string', 'Frontend API base URL bootstrap/runtime mirror' FROM app_rows
  UNION ALL
  SELECT app_rows.id, app_rows.slug, 'VITE_APP_SLUG', app_rows.app_slug, 'string', 'Frontend app slug bootstrap/runtime mirror' FROM app_rows
  UNION ALL
  SELECT app_rows.id, app_rows.slug, 'VITE_TURNSTILE_SITE_KEY', app_rows.turnstile_site_key, 'string', 'Cloudflare Turnstile site key (non-secret)' FROM app_rows
)
INSERT INTO platform.app_settings (id, app_id, key, value, value_type, description)
SELECT 'app_setting_frontend_' || kv.slug || '_' || lower(kv.key), kv.app_id, kv.key, kv.value, kv.value_type, kv.description
FROM kv
ON CONFLICT (app_id, key) DO UPDATE SET
  value = EXCLUDED.value,
  value_type = EXCLUDED.value_type,
  description = EXCLUDED.description,
  updated_at = now();
