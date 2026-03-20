# 10 — Shared Systems Inventory (DRAFT)

## Confirmed from code

### Shared frontend systems
- **Auth/session provider**: `AuthProvider`, `useAuth`, `RequireAuth` in `lib/frontend-security`.
- **CSRF bootstrap and secure fetch helper** integrated into auth provider and shared API fetch.
- **Turnstile integration hook** reusable across forms requiring anti-bot tokens.
- **Monitoring wrapper**: global init + `MonitoringErrorBoundary` + handled error helpers in `lib/frontend-observability`.
- **Generated API contract client**: `@workspace/api-client-react` for hooks and typed request/response models.

### Shared backend systems
- **Authn/Authz middleware set** (`requireAuth`, `requireSuperAdmin`, `requireOrgAccess`, `requireOrgAdmin`, `requireAppAccess`).
- **Security middleware set** (`securityHeaders`, `csrfProtection`, `originRefererProtection`, `rateLimiter`, `turnstileVerifyMiddleware`).
- **Audit logging service** (`writeAuditLog`) used in critical state-changing routes.
- **DB schema as shared contract** in `lib/db` with app registry + access constructs.

### Shared contracts and cross-layer coupling
- OpenAPI spec in `lib/api-spec` with generated outputs consumed by frontend and backend libs.
- `packages/types` models app-context/tenancy vocabulary for multi-app access model.

### Systems suggesting future-app intent
- App registry fields (`tenancy_mode`, `onboarding_mode`, `invites_allowed`).
- `user_app_access` and `org_app_access` abstractions not tied to one app.
- Placeholder app directories under `apps/` and empty foundational packages (`auth`, `security`, `config`, `ui`).
- App context endpoints (`/api/apps/slug/:appSlug/context`) and generic app access middleware.

## Strong inference from code structure
- There is an intentional attempt to evolve from “single admin shell” toward a platform with multiple app modules and shared platform primitives.

## Unclear / requires confirmation
- Which shared systems are considered stable platform APIs vs internal implementation details.
- Whether planned future apps should integrate via current admin shell or separate frontends that reuse these shared libs.
- Whether empty `packages/*` are planned replacement targets for current `lib/*` implementations.
