-- Canonical app identity/runtime config now lives on platform.apps.
-- This migration adds canonical columns, backfills from existing runtime settings,
-- and removes invalid app_settings keys that caused config drift.

ALTER TABLE IF EXISTS platform.apps
  ADD COLUMN IF NOT EXISTS domain text,
  ADD COLUMN IF NOT EXISTS base_url text,
  ADD COLUMN IF NOT EXISTS turnstile_site_key_override text;

WITH app_setting_values AS (
  SELECT
    s.app_id,
    MAX(CASE WHEN s.key = 'ALLOWED_ORIGIN' AND NULLIF(trim(s.value), '') IS NOT NULL THEN trim(s.value) END) AS allowed_origin,
    MAX(CASE WHEN s.key = 'ALLOWED_ORIGINS' AND NULLIF(trim(s.value), '') IS NOT NULL THEN trim(split_part(s.value, ',', 1)) END) AS legacy_allowed_origins,
    MAX(CASE WHEN s.key = 'VITE_API_BASE_URL' AND NULLIF(trim(s.value), '') IS NOT NULL THEN trim(s.value) END) AS api_base_url,
    MAX(CASE WHEN s.key = 'VITE_TURNSTILE_SITE_KEY' AND NULLIF(trim(s.value), '') IS NOT NULL THEN trim(s.value) END) AS turnstile_override
  FROM platform.app_settings s
  GROUP BY s.app_id
),
canonical_values AS (
  SELECT
    a.id AS app_id,
    COALESCE(NULLIF(trim(a.domain), ''),
      NULLIF(regexp_replace(COALESCE(v.allowed_origin, v.legacy_allowed_origins, v.api_base_url, ''), '^https?://', ''), '')
    ) AS domain_with_path,
    COALESCE(NULLIF(trim(a.base_url), ''), NULLIF(trim(v.allowed_origin), ''), NULLIF(trim(v.api_base_url), '')) AS base_url,
    COALESCE(NULLIF(trim(a.turnstile_site_key_override), ''), NULLIF(trim(v.turnstile_override), '')) AS turnstile_override
  FROM platform.apps a
  LEFT JOIN app_setting_values v ON v.app_id = a.id
),
normalized AS (
  SELECT
    app_id,
    NULLIF(regexp_replace(domain_with_path, '/.*$', ''), '') AS domain,
    base_url,
    turnstile_override
  FROM canonical_values
)
UPDATE platform.apps a
SET
  domain = n.domain,
  base_url = CASE
    WHEN n.base_url IS NOT NULL THEN n.base_url
    WHEN n.domain IS NULL THEN NULL
    WHEN n.domain LIKE 'localhost%' OR n.domain LIKE '127.0.0.1%' THEN 'http://' || n.domain
    ELSE 'https://' || n.domain
  END,
  turnstile_site_key_override = n.turnstile_override
FROM normalized n
WHERE a.id = n.app_id;

DELETE FROM platform.app_settings
WHERE key IN ('ALLOWED_ORIGINS', 'VITE_TURNSTILE_SITE_KEY');

DO $$
DECLARE
  missing_ids text;
BEGIN
  SELECT string_agg(id, ', ' ORDER BY id)
  INTO missing_ids
  FROM platform.apps
  WHERE domain IS NULL OR trim(domain) = '';

  IF missing_ids IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot enforce platform.apps.domain NOT NULL. Missing domain for app ids: %', missing_ids;
  END IF;
END $$;

ALTER TABLE IF EXISTS platform.apps
  ALTER COLUMN domain SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS apps_domain_unique ON platform.apps (domain);
