# SaaS Platform Monorepo

A production-ready, portable, multi-tenant SaaS platform hosting **Shipibo Dictionary** and **Ayni Ceremony Management**.

## Architecture

```
artifacts-monorepo/
├── apps/
│   ├── api-server/     # Express 5 API (auth, orgs, billing, apps, admin)
│   └── admin/          # React + Vite frontend (tenant dashboard, admin, apps)
├── lib/
│   ├── db/             # Drizzle ORM schema + PostgreSQL connection
│   ├── api-spec/       # OpenAPI 3.1 spec + Orval codegen config
│   ├── api-client-react/ # Generated React Query hooks
│   └── api-zod/        # Generated Zod validation schemas
└── scripts/            # Utility scripts (seed, etc.)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite, Tailwind CSS, shadcn/ui, React Query |
| Backend | Express 5, TypeScript, Node.js 24 |
| Database | PostgreSQL + Drizzle ORM |
| Auth | Google OAuth 2.0 + express-session |
| Billing | Stripe Subscriptions |
| Validation | Zod (generated from OpenAPI spec) |
| Package manager | pnpm workspaces |

## Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL database (Render, Neon, Supabase, or local)
- Google OAuth app credentials
- Stripe account (for billing)

## Quick Start

### 1. Clone and install

```bash
git clone <repo>
cd <repo>
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your values
```

### 3. Push database schema

```bash
pnpm --filter @workspace/db run push
```

### 4. Seed initial data

```bash
pnpm --filter @workspace/scripts run seed
```

### 5. Start development servers

```bash
# Terminal 1 — API server
pnpm --filter @workspace/api-server run dev

# Terminal 2 — Frontend
pnpm --filter @workspace/admin run dev
```

The API runs at `http://localhost:3000/api`  
The frontend runs at `http://localhost:5173`

## Running in Replit

The platform runs with two automatically managed workflows:

- **API Server** — Express backend on `PORT` assigned by Replit
- **Platform Web** — Vite dev server on its assigned port

Both are proxied through Replit's shared proxy at your Replit domain.

Environment variables are managed through Replit Secrets.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `SESSION_SECRET` | ✅ | Random secret for session signing (min 32 chars) |
| `GOOGLE_CLIENT_ID` | ✅ | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | ✅ | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | ✅ | Google OAuth callback URL |
| `STRIPE_SECRET_KEY` | ⚠️ | Stripe secret key (billing features) |
| `STRIPE_WEBHOOK_SECRET` | ⚠️ | Stripe webhook signing secret |
| `FRONTEND_URL` | ✅ | Frontend base URL for OAuth redirects |
| `PORT` | ✅ | API server port |

## Database Schema

The platform uses a **shared multi-tenant schema**:

- `users` — Platform users (Google OAuth linked)
- `organizations` — Tenant organizations
- `org_memberships` — User-to-org relationships with roles
- `apps` — App registry (Shipibo, Ayni, future apps)
- `app_plans` — Pricing plans per app
- `subscriptions` — Per-org per-app subscriptions
- `invitations` — Pending membership invitations
- `audit_logs` — Immutable audit trail
- `feature_flags` — Platform and per-org feature toggles
- `sessions` — PostgreSQL session store
- `shipibo_words` / `shipibo_categories` — Shipibo Dictionary data
- `ayni_ceremonies` / `ayni_participants` / `ayni_staff` — Ayni data

## API Routes -

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/me` | Get current user + active org |
| POST | `/api/auth/logout` | Log out |
| GET | `/api/auth/google/url` | Get Google OAuth URL |
| GET | `/api/auth/google/callback` | OAuth callback |
| GET/PATCH | `/api/users/me` | User profile |
| POST | `/api/users/me/switch-org` | Switch active org |
| GET/POST | `/api/organizations` | List/create orgs |
| GET/PATCH | `/api/organizations/:id` | Get/update org |
| GET | `/api/organizations/:id/members` | List members |
| PATCH/DELETE | `/api/organizations/:id/members/:uid` | Update/remove member |
| GET/POST | `/api/organizations/:id/invitations` | List/create invitations |
| POST | `/api/invitations/:token/accept` | Accept invitation |
| GET | `/api/apps` | App registry |
| GET | `/api/organizations/:id/apps` | Org subscribed apps |
| GET | `/api/organizations/:id/subscriptions` | Org subscriptions |
| POST | `/api/billing/checkout` | Create Stripe Checkout |
| POST | `/api/billing/portal` | Create Stripe Portal |
| POST | `/api/billing/webhook` | Stripe webhook |
| GET | `/api/admin/stats` | Platform stats (super admin) |
| GET | `/api/admin/organizations` | All orgs (super admin) |
| GET | `/api/admin/users` | All users (super admin) |
| GET | `/api/shipibo/words` | Search Shipibo dictionary |
| POST | `/api/shipibo/words` | Add word entry |
| GET | `/api/ayni/ceremonies` | List ceremonies |
| POST | `/api/ayni/ceremonies` | Create ceremony |

## Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project and enable the **Google+ API** / **Google Identity**
3. Create OAuth 2.0 credentials (Web application)
4. Add authorized redirect URI: `{your-domain}/api/auth/google/callback`
5. Copy Client ID and Secret to your `.env`

## Stripe Setup

1. Create a [Stripe account](https://stripe.com)
2. Get your API keys from the Dashboard
3. Create products and prices for each app plan
4. Update `stripePriceId` values in the database for each plan
5. Set up webhooks pointing to `/api/billing/webhook`

## Available Scripts

```bash
# Install all dependencies
pnpm install

# Run full typecheck
pnpm run typecheck

# Build all packages
pnpm run build

# Push DB schema changes
pnpm --filter @workspace/db run push

# Seed database
pnpm --filter @workspace/scripts run seed

# Regenerate API types from OpenAPI spec
pnpm --filter @workspace/api-spec run codegen

# Dev server (API)
pnpm --filter @workspace/api-server run dev

# Dev server (Frontend)
pnpm --filter @workspace/admin run dev
```

## Multi-tenant Design

Users can belong to multiple organizations. Each organization can subscribe to multiple apps. Access is controlled by:

1. **Authentication** — Valid session required
2. **Membership** — User must be a member of the organization
3. **Role** — Member's role (owner/admin/member/viewer) controls permissions
4. **Subscription** — Organization must have an active subscription to the app

## Adding Future Apps

1. Add an entry to `appsTable` in the database
2. Add pricing plans to `appPlansTable`
3. Create a new route file in `apps/api-server/src/routes/`
4. Add frontend pages under `apps/admin/src/pages/apps/`
5. The app will automatically appear in the registry and org dashboard

## License

MIT

<!-- test: fresh branch -->
