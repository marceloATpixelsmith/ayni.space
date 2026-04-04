DO $$ BEGIN
  CREATE TYPE platform.mfa_factor_type AS ENUM ('totp');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE platform.mfa_factor_status AS ENUM ('pending', 'active', 'disabled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE platform.auth_risk_reason AS ENUM (
    'ipqs_step_up',
    'ipqs_failure_step_up',
    'privileged_role',
    'org_client_registration',
    'new_device',
    'post_password_reset',
    'suspicious_context'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS platform.session_groups (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS session_groups_display_name_unique ON platform.session_groups(display_name);

INSERT INTO platform.session_groups (id, display_name)
VALUES ('default', 'Ayni Workspace'), ('admin', 'Ayni Admin')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS platform.mfa_factors (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
  factor_type platform.mfa_factor_type NOT NULL DEFAULT 'totp',
  status platform.mfa_factor_status NOT NULL DEFAULT 'pending',
  secret_ciphertext text NOT NULL,
  secret_iv text NOT NULL,
  secret_tag text NOT NULL,
  enrolled_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mfa_factors_user_active_totp_unique ON platform.mfa_factors(user_id, factor_type);
CREATE INDEX IF NOT EXISTS mfa_factors_user_idx ON platform.mfa_factors(user_id);

CREATE TABLE IF NOT EXISTS platform.mfa_recovery_codes (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
  factor_id text NOT NULL REFERENCES platform.mfa_factors(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mfa_recovery_codes_hash_unique ON platform.mfa_recovery_codes(code_hash);
CREATE INDEX IF NOT EXISTS mfa_recovery_codes_user_idx ON platform.mfa_recovery_codes(user_id);
CREATE INDEX IF NOT EXISTS mfa_recovery_codes_factor_idx ON platform.mfa_recovery_codes(factor_id);

CREATE TABLE IF NOT EXISTS platform.trusted_devices (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoke_reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS trusted_devices_token_hash_unique ON platform.trusted_devices(token_hash);
CREATE INDEX IF NOT EXISTS trusted_devices_user_idx ON platform.trusted_devices(user_id);
CREATE INDEX IF NOT EXISTS trusted_devices_expires_idx ON platform.trusted_devices(expires_at);

CREATE TABLE IF NOT EXISTS platform.user_auth_security (
  user_id text PRIMARY KEY REFERENCES platform.users(id) ON DELETE CASCADE,
  mfa_required boolean NOT NULL DEFAULT false,
  force_mfa_enrollment boolean NOT NULL DEFAULT false,
  last_password_reset_at timestamptz,
  first_auth_after_reset_pending boolean NOT NULL DEFAULT false,
  high_risk_until_mfa_at timestamptz,
  risk_reason platform.auth_risk_reason,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_auth_security_mfa_required_idx ON platform.user_auth_security(mfa_required);

CREATE TABLE IF NOT EXISTS platform.used_mfa_totp_codes (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
  factor_id text NOT NULL REFERENCES platform.mfa_factors(id) ON DELETE CASCADE,
  time_step integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS used_mfa_totp_codes_factor_step_unique ON platform.used_mfa_totp_codes(factor_id, time_step);
CREATE INDEX IF NOT EXISTS used_mfa_totp_codes_user_idx ON platform.used_mfa_totp_codes(user_id);
