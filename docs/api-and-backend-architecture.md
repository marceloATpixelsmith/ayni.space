# 09 — API and Backend Architecture

## Scope
- This document defines architecture constraints for its domain using `docs/monorepo-overview.md` as baseline and concrete repository paths as evidence.

## Confirmed
- Backend runtime entrypoint is `apps/api-server/src/index.ts`.
- API app composition and middleware ordering are centralized in `apps/api-server/src/app.ts`.
- API route aggregation is centralized via `apps/api-server/src/routes/index.ts` and route modules in `apps/api-server/src/routes/*`.
- Request path is implemented as: frontend -> API client/fetch layer -> API routes -> `@workspace/db` -> PostgreSQL.
- The API server is the single active backend gateway in current repository state.
- Lane 2 transactional email foundation is implemented as a shared backend integration package at `lib/integrations/transactional-email` with provider-agnostic contracts and adapter scaffolding for Brevo and Mailchimp Transactional.
- Lane 1 notification email delivery (invitation + email verification + password reset) is implemented in `apps/api-server/src/routes/invitations.ts`, `apps/api-server/src/routes/auth.ts`, and `apps/api-server/src/lib/invitationEmail.ts` using template resolution from `platform.email_templates` with app-level override + platform-default fallback and platform-owned provider credentials from environment variables.
- Runtime non-secret backend configuration now uses `platform.settings` for cross-app keys and `platform.apps` for canonical app identity/runtime fields (`domain`, `base_url`, `turnstile_site_key_override`), with app-scoped toggles that remain in `platform.app_settings` (for example `MFA_ISSUER`, frontend auth/sentry flags) routed through `apps/api-server/src/lib/runtimeSettings.ts` + `apps/api-server/src/lib/settings.ts`.
- Platform settings management APIs are available under `/api/platform/settings` and `/api/platform/apps/:id/settings` and protected by `requireSuperAdmin` via `apps/api-server/src/routes/platform.ts` (legacy `/api/admin/settings` remains available in `apps/api-server/src/routes/admin.ts`).
- Frontend non-secret runtime settings are served per app via `GET /api/apps/slug/:appSlug/runtime-settings`; admin boot hydrates runtime settings before rendering auth flow (`apps/admin/src/runtimeBootstrap.ts`). Bootstrap env remains the startup source of truth for app identity/reachability (`VITE_API_BASE_URL`, `VITE_APP_SLUG`, optional build-time `BASE_PATH`) and now also provides a fail-closed Turnstile site-key fallback (`VITE_TURNSTILE_SITE_KEY`) so widget rendering is not silently disabled if runtime hydration is missing/partial, while hydrated DB settings still override runtime behavior when provided (`authDebug`, `sentryEnvironment`, `sentryDsn`, `turnstileSiteKey`, `domain`, `baseUrl`) (`apps/api-server/src/routes/apps.ts`, `apps/api-server/src/lib/runtimeSettings.ts`, `apps/admin/src/runtimeBootstrap.ts`, `lib/frontend-security/src/runtimeSettings.ts`).
- Login/signup metadata gating resolves the current app from bootstrap `VITE_APP_SLUG` and then performs exact trimmed slug matching against `/api/apps` (`platform.apps.slug` rows). If no exact match exists, frontend remains fail-closed and reports `app_metadata_not_found` with safe diagnostics (`requested=<slug>; available=<slugs>`). Verify by checking Vercel `VITE_APP_SLUG`, frontend `VITE_API_BASE_URL` reachability to backend `/api/apps`, and database `platform.apps.slug` value alignment for the deployed app.
- Admin auth-entry metadata contract: deployed admin frontend requests slug `admin` (from `VITE_APP_SLUG` bootstrap default/fallback), so `platform.apps` must expose an active `slug=admin` row and `/api/apps` must return it with an organization profile (`access_mode=organization` → `normalizedAccessProfile=organization`) for signup affordances and `/signup` access to appear.
- Diagnostic `app_metadata_not_found [requested=admin; available=none]` means the frontend reached `/api/apps` but received no usable active rows; after deploy, verify Vercel `VITE_APP_SLUG=admin`, Vercel `VITE_API_BASE_URL` targets the production backend, Render backend serves `/api/apps`, and the production database row `platform.apps.slug=admin` is active.
- Superadmin runtime settings management is now standardized on protected platform endpoints (`GET/PATCH /api/platform/settings`, `GET/PATCH /api/platform/apps/:id/settings`) with explicit non-secret key allowlists and typed value handling (`apps/api-server/src/routes/platform.ts`, `apps/admin/src/pages/admin/AdminDashboard.tsx`, `apps/api-server/src/lib/settings.ts`).
- Runtime settings editability policy is explicit and enforced in code (`apps/api-server/src/lib/settings.ts`, `apps/api-server/src/routes/platform.ts`):
  - **Operator-editable global keys:** `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `TURNSTILE_ENABLED`, `IPQS_BLOCK_THRESHOLD`, `IPQS_STEP_UP_THRESHOLD`, `IPQS_TIMEOUT_MS`, `OPENAI_MAX_RETRIES`, `OPENAI_MODEL`, `OPENAI_TEMPERATURE`, `OPENAI_TIMEOUT_MS`.
  - **Seeded (not operator-editable) global key:** `GOOGLE_REDIRECT_URI` (provider-coupled).
  - **Operator-editable app keys:** `MFA_ISSUER`, `VITE_AUTH_DEBUG`, `VITE_SENTRY_ENVIRONMENT`, `VITE_SENTRY_DSN`.
  - **Bootstrap mirror app keys (seeded, not operator-editable):** `VITE_API_BASE_URL`, `VITE_APP_SLUG`, `BASE_PATH`.
- Allowed origins are derived at runtime from active `platform.apps.domain` values and then merged with optional legacy `ALLOWED_ORIGINS` env entries (`apps/api-server/src/lib/settings.ts`).
- Turnstile site key resolution is now: `platform.apps.turnstile_site_key_override` (if set) -> global env `VITE_TURNSTILE_SITE_KEY` fallback; `platform.app_settings` keys `VITE_TURNSTILE_SITE_KEY`/`ALLOWED_ORIGINS` are removed as invalid runtime config storage (`apps/api-server/src/lib/runtimeSettings.ts`, `lib/db/migrations/20260421_canonical_app_config.sql`).
- Invitation create flow persists invitee `first_name`/`last_name` on `platform.invitations` and passes deterministic `invitee_name` rendering context into lane1 invitation templates.

## Inferred
- The backend is intentionally a single service boundary for auth, org, app-access, and operational middleware concerns.
- Route/middleware centralization is intended to keep cross-cutting controls (security, CSRF, observability) consistent.

## Unclear
- Whether backend decomposition into multiple services is planned.
- Whether placeholder apps will eventually require dedicated backend runtime boundaries.

## Do not break
- Do not bypass `apps/api-server/src/app.ts` as the central middleware composition point.
- Do not split route registration away from `apps/api-server/src/routes/index.ts` without explicit architecture change.
- Do not introduce alternate backend entrypoints that circumvent existing security/observability middleware ordering.
- Do not bypass `@workspace/db` for backend data access.

## Runtime configuration authority (implementation truth)

### Configuration layers (authoritative order)
1. **Global runtime settings (`platform.settings`)**
   - Cross-app non-secret runtime keys read through `getSetting`/`getGlobalSettingSnapshot` and cached in `refreshSettingsCache`.
2. **App runtime settings (`platform.app_settings`)**
   - Per-app runtime keys (`MFA_ISSUER`, frontend auth/sentry keys, bootstrap mirrors) read through `getAppSetting`/`getAppSettingBySlug`.
3. **App registry (`platform.apps`)**
   - Canonical app identity/runtime fields (`domain`, `base_url`, `turnstile_site_key_override`) loaded into cache as app canonical config.
4. **Environment variables**
   - Bootstrap/secret inputs and explicit legacy fallback inputs only; env is not the canonical source for non-secret runtime settings.

### Origin resolution contract
- Runtime origin set is built by `getEffectiveAllowedOrigins()` / `getAllowedOriginsSnapshot()` in `apps/api-server/src/lib/settings.ts`.
- Domain path (`platform.apps.domain`):
  - Reads active apps from cache (`appConfigById`), derives origin per domain via `deriveOriginFromDomain`.
  - Normalization rules are deterministic:
    - If domain already has `http://` or `https://`, use URL origin normalization directly.
    - If domain contains `localhost` or starts with `127.0.0.1`, force `http://`.
    - Otherwise force `https://`.
- Env extension path (`ALLOWED_ORIGINS`):
  - Parsed as CSV, each entry normalized with `new URL(...).origin`, invalid entries dropped.
  - Merged with domain-derived origins and de-duplicated via `Set`.
- CORS and origin/referer protection both consume this resolved runtime origin set (`apps/api-server/src/app.ts`, `apps/api-server/src/middlewares/csrf.ts`).

### Runtime cache behavior
- Cache owner: `apps/api-server/src/lib/settings.ts` (`cache`, `inFlightRefresh`).
- Refresh lifecycle:
  - `refreshSettingsCache()` skips DB read if cache is younger than 15 seconds and no `force` flag is passed.
  - `refreshSettingsCache({ force: true })` always re-reads DB and rebuilds all global/app/app-canonical maps.
  - Concurrent refresh calls share one in-flight promise (`inFlightRefresh`) to avoid duplicate DB fan-out.
- Startup flow:
  - `app.ts` validates env and boots middleware, then calls `refreshRuntimeCache({ force: true })` asynchronously at startup.
  - CORS/origin checks call `getEffectiveAllowedOrigins()` per request, which first ensures cache freshness then resolves domain + legacy env origins.
- Failure behavior:
  - If refresh fails, code keeps prior cache (`catch` fail-safe), preventing partial cache corruption.

### Environment variable classification (runtime config context)
- **Required env (secrets / infrastructure bootstrap):**
  - Examples: `DATABASE_URL`, `SESSION_SECRET`, provider/API secret keys (`GOOGLE_CLIENT_SECRET`, `STRIPE_SECRET_KEY`, `TURNSTILE_SECRET_KEY`, `IPQS_API_KEY`, `OPENAI_API_KEY`, transactional email provider secrets).
- **Optional env (fallback-only or bootstrap-only):**
  - Bootstrap mirrors: `VITE_API_BASE_URL`, `VITE_APP_SLUG`, optional `BASE_PATH`.
  - Legacy optional fallback: `ALLOWED_ORIGINS` extends domain-derived origins only.
  - Global fallback inputs still read by snapshot helpers when DB value is absent (`SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `TURNSTILE_ENABLED`, `GOOGLE_REDIRECT_URI`, IPQS/OpenAI non-secret knobs).
  - Global turnstile site-key fallback for frontend runtime: `VITE_TURNSTILE_SITE_KEY` when app override is absent.
- **Deprecated/non-canonical storage:**
  - `platform.app_settings` keys `ALLOWED_ORIGIN`, `ALLOWED_ORIGINS`, and `VITE_TURNSTILE_SITE_KEY` are removed from canonical runtime storage; canonical sources are `platform.apps.domain` and `platform.apps.turnstile_site_key_override`.


## Operator rollout note (non-secret env cleanup)

After DB-backed runtime settings rollout is complete, remove these non-secret deployment GUI variables from Vercel/Render because runtime now sources them from `platform.settings`/`platform.app_settings`:

- `SENTRY_DSN` (backend non-secret DSN mirror; keep only if needed as emergency fallback during migration window)
- `SENTRY_ENVIRONMENT` (backend non-secret environment label mirror)
- `GOOGLE_REDIRECT_URI` (backend non-secret OAuth callback URI mirror)
- `TURNSTILE_ENABLED` (backend non-secret feature toggle mirror)
- `IPQS_BLOCK_THRESHOLD`
- `IPQS_STEP_UP_THRESHOLD`
- `IPQS_TIMEOUT_MS`
- `OPENAI_MAX_RETRIES`
- `OPENAI_MODEL`
- `OPENAI_TEMPERATURE`
- `OPENAI_TIMEOUT_MS`
- `VITE_AUTH_DEBUG`
- `VITE_SENTRY_ENVIRONMENT`
- `VITE_SENTRY_DSN`
- `VITE_TURNSTILE_SITE_KEY` remains a global fallback only (do not store this in DB).

Runtime settings rollout source-of-truth migrations are:

- `lib/db/migrations/20260420_non_secret_runtime_settings_foundation.sql`
- `lib/db/migrations/20260420_platform_runtime_settings.sql`
- `lib/db/migrations/20260420_frontend_runtime_app_settings.sql`
- `lib/db/migrations/20260420_runtime_settings_completion.sql`
- `lib/db/migrations/20260421_canonical_app_config.sql` (**authoritative canonical app-config pass**)

The runtime-settings migrations are registered in the live Drizzle migration chain at `lib/db/migrations/meta/_journal.json` and must remain registered for new environments.
`lib/db/migrations/20260421_runtime_settings_canonicalization.sql` remains in the chain as a valid-key canonicalization pass only (global `platform.settings` + supported per-app runtime keys) and no longer seeds deprecated app-setting keys (`ALLOWED_ORIGIN`, `ALLOWED_ORIGINS`, `VITE_TURNSTILE_SITE_KEY`).

Canonical app identity/runtime final state is established by `20260421_canonical_app_config.sql`:

- Canonical app origin source is `platform.apps.domain` (legacy `ALLOWED_ORIGINS` app-setting rows are removed).
- Canonical app MFA issuers are seeded as:
  - `admin` → `Ayni Admin`
  - `ayni` → `Ayni`
  - `shipibo` → `Shipibo`
  - `screening` → `Ayni Screening`
- Earlier overlapping 2026-04-20 and 2026-04-21 migrations remain historical and safe to keep for already-applied databases; final effective app identity/runtime values are intentionally normalized and enforced by `20260421_canonical_app_config.sql`, while broader DB-backed runtime settings remain active through `platform.settings` + `platform.app_settings`.

Keep env only for secrets/bootstrap/infra values (for example `VITE_API_BASE_URL`, `VITE_APP_SLUG`, optional `BASE_PATH`, session/database secrets, provider API keys, and other boot-time infra values).

## Final runtime settings contract

### `platform.settings` (cross-app, non-secret backend runtime)
- Holds shared backend runtime knobs and mirrors that apply platform-wide.
- Operator-editable keys are listed above; `GOOGLE_REDIRECT_URI` remains seeded/non-editable by superadmin API to avoid accidental OAuth provider drift.

### `platform.app_settings` (per-app, non-secret runtime + frontend runtime)
- Holds app-specific non-secret backend/frontend runtime values.
- Operator-editable keys are app security/monitoring/runtime controls (`MFA_ISSUER`, auth debug, Sentry labels/DSN).
- Bootstrap mirrors (`VITE_API_BASE_URL`, `VITE_APP_SLUG`, `BASE_PATH`) remain seeded for consistency but are not operator-editable in superadmin runtime settings APIs/UI.

### Bootstrap env (must remain env/bootstrap contract)
- `VITE_API_BASE_URL`
- `VITE_APP_SLUG`
- `BASE_PATH` (optional build-time)

### Secret env (must remain env/secret contract)
- Session/database secrets (`SESSION_SECRET`, DB credentials/URL).
- Provider secret keys (`GOOGLE_CLIENT_SECRET`, `TURNSTILE_SECRET_KEY`, `IPQS_API_KEY`, `OPENAI_API_KEY`, SMTP/provider API secrets).
- Any boot-time infra secrets or transport credentials.
