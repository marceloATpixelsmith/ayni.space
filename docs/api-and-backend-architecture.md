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
- Runtime non-secret backend configuration is now split into cross-app `platform.settings` and app-scoped `platform.app_settings`, with API/runtime reads routed through `apps/api-server/src/lib/runtimeSettings.ts` + `apps/api-server/src/lib/settings.ts` and schema/migration definitions under `lib/db/src/schema/settings.ts`.
- Platform settings management APIs are available under `/api/platform/settings` and `/api/platform/apps/:id/settings` and protected by `requireSuperAdmin` via `apps/api-server/src/routes/platform.ts` (legacy `/api/admin/settings` remains available in `apps/api-server/src/routes/admin.ts`).
- Frontend non-secret runtime settings are now served per app from `platform.app_settings` via `GET /api/apps/slug/:appSlug/runtime-settings`; admin boot hydrates runtime settings before rendering auth flow (`apps/admin/src/runtimeBootstrap.ts`). Bootstrap env remains the startup source of truth for app identity/reachability (`VITE_API_BASE_URL`, `VITE_APP_SLUG`, optional build-time `BASE_PATH`), while hydrated DB settings drive runtime behavior (`authDebug`, `sentryEnvironment`, `sentryDsn`, `turnstileSiteKey`) (`apps/api-server/src/routes/apps.ts`, `apps/api-server/src/lib/runtimeSettings.ts`, `apps/admin/src/runtimeBootstrap.ts`, `lib/frontend-security/src/runtimeSettings.ts`).
- Superadmin runtime settings management is now standardized on protected platform endpoints (`GET/PATCH /api/platform/settings`, `GET/PATCH /api/platform/apps/:id/settings`) with explicit non-secret key allowlists and typed value handling (`apps/api-server/src/routes/platform.ts`, `apps/admin/src/pages/admin/AdminDashboard.tsx`, `apps/api-server/src/lib/settings.ts`).
- Runtime settings editability policy is now explicit and enforced in code:
  - **Operator-editable global keys:** `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `TURNSTILE_ENABLED`, `IPQS_BLOCK_THRESHOLD`, `IPQS_STEP_UP_THRESHOLD`, `IPQS_TIMEOUT_MS`, `OPENAI_MAX_RETRIES`, `OPENAI_MODEL`, `OPENAI_TEMPERATURE`, `OPENAI_TIMEOUT_MS`.
  - **Seeded (not operator-editable) global key:** `GOOGLE_REDIRECT_URI` (provider-coupled).
  - **Operator-editable app keys:** `ALLOWED_ORIGIN`, `MFA_ISSUER`, `VITE_AUTH_DEBUG`, `VITE_SENTRY_ENVIRONMENT`, `VITE_SENTRY_DSN`, `VITE_TURNSTILE_SITE_KEY`.
  - **Bootstrap mirror app keys (seeded, not operator-editable):** `VITE_API_BASE_URL`, `VITE_APP_SLUG`, `BASE_PATH`.
  - Enforcement source of truth is `apps/api-server/src/lib/settings.ts` definitions consumed by `/api/platform/*settings` routes in `apps/api-server/src/routes/platform.ts`.
- Legacy app key `ALLOWED_ORIGINS` is no longer used by runtime resolution; effective allowed origins now read canonical `ALLOWED_ORIGIN` app rows first, then env fallback only when app rows are absent (`apps/api-server/src/lib/settings.ts`).
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
- `VITE_TURNSTILE_SITE_KEY`

Runtime settings rollout source-of-truth migrations are:

- `lib/db/migrations/20260420_non_secret_runtime_settings_foundation.sql`
- `lib/db/migrations/20260420_platform_runtime_settings.sql`
- `lib/db/migrations/20260420_frontend_runtime_app_settings.sql`
- `lib/db/migrations/20260420_runtime_settings_completion.sql`
- `lib/db/migrations/20260421_runtime_settings_canonicalization.sql` (**authoritative final canonicalization pass**)

The canonicalization migration is registered in the live Drizzle migration chain at `lib/db/migrations/meta/_journal.json` and must remain registered for new environments.

Canonical runtime-settings final state is established by `20260421_runtime_settings_canonicalization.sql`:

- Canonical app origin key is `ALLOWED_ORIGIN` (legacy `ALLOWED_ORIGINS` rows are removed in final migration).
- Canonical app MFA issuers are seeded as:
  - `admin` → `Ayni Admin`
  - `ayni` → `Ayni`
  - `shipibo` → `Shipibo`
  - `screening` → `Ayni Screening`
- Earlier overlapping 2026-04-20 migrations remain historical and safe to keep for already-applied databases; final effective values are intentionally normalized by the 2026-04-21 migration.

Keep env only for secrets/bootstrap/infra values (for example `VITE_API_BASE_URL`, `VITE_APP_SLUG`, optional `BASE_PATH`, session/database secrets, provider API keys, and other boot-time infra values).

## Final runtime settings contract

### `platform.settings` (cross-app, non-secret backend runtime)
- Holds shared backend runtime knobs and mirrors that apply platform-wide.
- Operator-editable keys are listed above; `GOOGLE_REDIRECT_URI` remains seeded/non-editable by superadmin API to avoid accidental OAuth provider drift.

### `platform.app_settings` (per-app, non-secret runtime + frontend runtime)
- Holds app-specific non-secret backend/frontend runtime values.
- Operator-editable keys are app security/monitoring/runtime controls (`ALLOWED_ORIGIN`, `MFA_ISSUER`, auth debug, Sentry labels/DSN, Turnstile site key).
- Bootstrap mirrors (`VITE_API_BASE_URL`, `VITE_APP_SLUG`, `BASE_PATH`) remain seeded for consistency but are not operator-editable in superadmin runtime settings APIs/UI.

### Bootstrap env (must remain env/bootstrap contract)
- `VITE_API_BASE_URL`
- `VITE_APP_SLUG`
- `BASE_PATH` (optional build-time)

### Secret env (must remain env/secret contract)
- Session/database secrets (`SESSION_SECRET`, DB credentials/URL).
- Provider secret keys (`GOOGLE_CLIENT_SECRET`, `TURNSTILE_SECRET_KEY`, `IPQS_API_KEY`, `OPENAI_API_KEY`, SMTP/provider API secrets).
- Any boot-time infra secrets or transport credentials.
