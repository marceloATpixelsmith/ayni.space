# 02 — App Catalog (DRAFT)

## Confirmed from code

### `apps/api-server` (`@workspace/api-server`)
- Express 5 API with startup validation and env checks.
- Routes mounted under `/api` include: auth, users, organizations, invitations, apps, subscriptions, billing, audit, admin, shipibo, ayni, health.
- Security middleware stack includes CORS allowlist, session middleware, CSRF, origin/referer checks, rate limiting, security headers, and correlation IDs.

### `apps/admin` (`@workspace/admin`)
- React + Vite SPA using Wouter routing and TanStack Query.
- Uses shared providers from `@workspace/frontend-security` and `@workspace/frontend-observability`.
- Contains tenant dashboard routes, app module routes (`/apps/shipibo`, `/apps/ayni`), and super-admin route (`/admin`).
- Includes contract-style security shell tests in `src/__tests__/security-shell.contract.test.mjs`.

### `apps/mockup-sandbox` (`@workspace/mockup-sandbox`)
- Vite React app with UI dependencies similar to `apps/admin`.
- Appears to be a sandbox/prototyping environment (not integrated into main CI/deploy workflows).

### `frontend` (Next.js app, non-workspace)
- Standalone Next.js app with boilerplate-style pages (login/signup/app placeholders).
- Not listed in `pnpm-workspace.yaml`; dependency lifecycle and build are separate from workspace scripts.

### Placeholder app directories
- `apps/ayni`, `apps/shipibo`, `apps/screening` contain only `.gitkeep`.

## Strong inference from code structure
- Actual production-facing frontend appears to be `apps/admin`; `frontend` seems exploratory or alternate shell.
- App-specific APIs (`/api/shipibo`, `/api/ayni`) suggest modular multi-app backend domain strategy even though separate frontends for those modules are not yet split out.
- `apps/mockup-sandbox` likely supports rapid UI experiments before promotion into `apps/admin`.

## Unclear / requires confirmation
- Deployment status and ownership of `apps/mockup-sandbox`.
- Intended lifecycle for `frontend/` relative to `apps/admin`.
- Whether each future app should become its own frontend package or continue as modules inside admin shell.
