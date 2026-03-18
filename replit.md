# Workspace

## Overview

Multi-tenant SaaS platform monorepo. Hosts **Shipibo Dictionary** (indigenous language dictionary) and **Ayni Ceremony Management**. Features: Google OAuth auth, Stripe billing, role-based org access (owner/admin/member/viewer), super admin interface, tenant dashboard, invitation system, audit logs, feature flags.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Frontend**: React 19 + Vite 7 + Tailwind + shadcn/ui
- **Auth**: Google OAuth (google-auth-library), express-session + connect-pg-simple
- **Billing**: Stripe (lazy-loaded for CJS compat)
- **API codegen**: Orval (from OpenAPI spec → React Query hooks + Zod schemas)
- **State management**: TanStack Query v5

## Structure

```text
.
├── apps/
│   ├── api-server/          # Express 5 API server (port 8080)
│   └── admin/             # React + Vite frontend (previewPath "/")
├── lib/
│   ├── api-spec/            # OpenAPI 3.1 spec + Orval codegen config
│   ├── api-client-react/    # Generated React Query hooks (used by platform)
│   ├── api-zod/             # Generated Zod schemas (used by api-server)
│   └── db/                  # Drizzle ORM schema + DB connection
├── scripts/
│   └── src/seed.ts          # Seeds demo data (run: pnpm --filter @workspace/scripts run seed)
├── pnpm-workspace.yaml
├── tsconfig.base.json       # composite: true, bundler resolution, es2022
├── tsconfig.json            # Root project references
└── .env.example             # Required env vars documentation
```

## Required Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection URL (auto-provided by Replit) |
| `SESSION_SECRET` | Secret for express-session cookie signing |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL (e.g., `https://your-domain/api/auth/google/callback`) |
| `STRIPE_SECRET_KEY` | Stripe secret key (optional, needed for billing) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (optional) |

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

- **Always typecheck from the root**: `pnpm run typecheck`
- **`emitDeclarationOnly`** — only `.d.ts` files emitted; JS bundled by esbuild/tsx/vite
- **Project references** — each package's `tsconfig.json` must list its workspace deps in `references`

## Root Scripts

- `pnpm run build` — typecheck + recursive build in all packages
- `pnpm run typecheck` — `tsc --build --emitDeclarationOnly` (project references)

## Packages

### `apps/api-server` (`@workspace/api-server`)

Express 5 API server (port 8080). All routes are under `/api`.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App: `src/app.ts` — CORS, JSON/urlencoded, session middleware, raw body for webhook
- Routes: `src/routes/index.ts` mounts sub-routers
  - `/api/healthz` — health check
  - `/api/auth/*` — Google OAuth, me, logout
  - `/api/users/*` — current user
  - `/api/organizations/*` — CRUD, members, invitations, audit logs, subscriptions, apps
  - `/api/apps/*` — app directory
  - `/api/billing/*` — Stripe checkout, portal, webhook
  - `/api/admin/*` — super admin (stats, orgs, users, feature flags, audit logs)
  - `/api/shipibo/*` — Shipibo Dictionary CRUD
  - `/api/ayni/*` — Ayni Ceremony Management CRUD
- Session: PostgreSQL store (`sessions` table), cookie name `saas.sid`
- Auth: Google OAuth via `google-auth-library`; session userId stored in `req.session.userId`
- Middleware: `requireAuth`, `requireSuperAdmin`, `requireOrgAccess`, `requireOrgAdmin`

### `apps/admin` (`@workspace/admin`)

React + Vite frontend. Base path: `/`.

Key pages:
- `/login` — Google OAuth sign-in
- `/onboarding` — create/join organization
- `/dashboard` — home with org apps summary
- `/dashboard/apps` — app directory
- `/dashboard/members` — team management
- `/dashboard/invitations` — invite new members
- `/dashboard/billing` — subscriptions + Stripe portal
- `/dashboard/settings` — org profile settings
- `/apps/shipibo` — Shipibo Dictionary app
- `/apps/ayni` — Ayni Ceremony Management app
- `/admin` — Super admin (overview, orgs, users, audit logs, feature flags)

Layout: `AppLayout` (named export from `src/components/layout/AppLayout.tsx`) — sidebar with org switcher, nav links, user menu.

### `lib/db` (`@workspace/db`)

Drizzle ORM with PostgreSQL. Tables:
- `users` — auth users with Google profile, `isSuperAdmin`, `activeOrgId`
- `organizations` — multi-tenant orgs with slug, Stripe customer ID
- `org_memberships` — user↔org relationships with roles (owner/admin/member/viewer)
- `apps` — app registry (Shipibo Dictionary, Ayni Ceremony Management)
- `app_plans` — pricing plans per app
- `subscriptions` — org→app subscriptions with Stripe data
- `org_app_access` — admin overrides for app access
- `invitations` — pending email invitations
- `audit_logs` — action log per org
- `feature_flags` — global/per-org feature toggles
- `sessions` — express-session PostgreSQL store
- `shipibo_words`, `shipibo_categories` — Shipibo Dictionary content
- `ayni_ceremonies`, `ayni_participants`, `ayni_staff` — Ayni app data

### `lib/api-spec` (`@workspace/api-spec`)

OpenAPI 3.1 spec (`openapi.yaml`) + Orval config. Codegen:
```
pnpm --filter @workspace/api-spec run codegen
```
Outputs to: `lib/api-client-react/src/generated/` and `lib/api-zod/src/generated/`

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks. Import: `from "@workspace/api-client-react"`.
Custom fetch client in `src/lib/client.ts` — prepends `import.meta.env.BASE_URL` to API paths.

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from OpenAPI spec. Used by api-server for validation.

### `scripts` (`@workspace/scripts`)

Utility scripts. Run: `pnpm --filter @workspace/scripts run <script>`.
- `seed` — seeds demo data: super admin (`admin@platform.dev`), Demo Organization, both apps + plans, subscriptions, Shipibo words, Ayni ceremony

## Seeded Demo Data

| Item | Value |
|---|---|
| Super admin email | `admin@platform.dev` |
| Demo org | Demo Organization (slug: `demo-org`) |
| Apps | Shipibo Dictionary (Free + Pro), Ayni Ceremony Management (Starter + Pro) |
| Subscriptions | Shipibo Pro + Ayni Starter (active) |
| Invited user | `invited@example.com` (pending) |

## Deployment Notes

- Google OAuth: set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` pointing to `/api/auth/google/callback`
- Stripe: set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; configure price IDs in `app_plans` table
- See `PORTABILITY.md` for moving to other hosting providers
- See `.env.example` for all required/optional env vars
