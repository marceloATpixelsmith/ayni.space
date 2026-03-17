# Portability Guide

This platform is developed on Replit but is **not dependent on any Replit-specific services**. It can be deployed to any standard hosting platform with minimal changes.

## What Makes This Portable

- ✅ Standard PostgreSQL (no Replit DB)
- ✅ Standard Express.js server
- ✅ Standard Google OAuth 2.0
- ✅ Standard Stripe API
- ✅ All configuration via environment variables
- ✅ No secrets in source code
- ✅ PostgreSQL-backed session store (not in-memory)
- ✅ Static React frontend (Vite build)
- ✅ Standard `npm`/`pnpm` scripts

## Deploying on Render

### Backend (API Server)

1. Create a **Web Service** on Render
2. Connect your GitHub repository
3. Configure:
   - **Build Command**: `pnpm install && pnpm run build`
   - **Start Command**: `node artifacts/api-server/dist/index.cjs`
   - **Environment**: Node 20+

4. Set environment variables:
   ```
   DATABASE_URL=postgresql://...   (from Render PostgreSQL or external)
   SESSION_SECRET=<random 32+ chars>
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REDIRECT_URI=https://your-api.onrender.com/api/auth/google/callback
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   FRONTEND_URL=https://your-frontend.onrender.com
   NODE_ENV=production
   PORT=10000
   ```

### Frontend (Static Site)

1. Create a **Static Site** on Render
2. Configure:
   - **Build Command**: `pnpm install && pnpm --filter @workspace/platform run build`
   - **Publish Directory**: `artifacts/platform/dist`

3. Set environment variable:
   ```
   VITE_API_URL=https://your-api.onrender.com
   ```

4. Add a redirect rule: `/* → /index.html` (for SPA routing)

## Deploying on Railway

### Using railway.toml

Create `railway.toml` in the project root:

```toml
[build]
builder = "nixpacks"
buildCommand = "pnpm install && pnpm run build"

[deploy]
startCommand = "node artifacts/api-server/dist/index.cjs"
healthcheckPath = "/api/healthz"
```

Add all required environment variables in the Railway dashboard.

For the frontend, create a second Railway service:
```toml
[build]
buildCommand = "pnpm install && pnpm --filter @workspace/platform run build"

[deploy]
staticDir = "artifacts/platform/dist"
```

## Deploying on Fly.io

### Create Dockerfile

```dockerfile
FROM node:20-alpine AS base
WORKDIR /app
RUN npm install -g pnpm

# Install dependencies
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY lib/ lib/
COPY artifacts/api-server/ artifacts/api-server/
COPY tsconfig*.json ./
RUN pnpm install --frozen-lockfile

# Build
RUN pnpm run build

# Production image
FROM node:20-alpine
WORKDIR /app
RUN npm install -g pnpm
COPY --from=base /app/artifacts/api-server/dist ./dist
COPY --from=base /app/node_modules ./node_modules
EXPOSE 8080
CMD ["node", "dist/index.cjs"]
```

### fly.toml

```toml
app = "your-saas-platform"
primary_region = "iad"

[build]
dockerfile = "Dockerfile"

[http_service]
internal_port = 8080
force_https = true
auto_stop_machines = true
auto_start_machines = true

[[vm]]
cpu_kind = "shared"
cpus = 1
memory_mb = 512
```

Deploy:
```bash
fly launch
fly secrets set DATABASE_URL="postgresql://..."
fly secrets set SESSION_SECRET="$(openssl rand -hex 32)"
fly secrets set GOOGLE_CLIENT_ID="..."
fly secrets set GOOGLE_CLIENT_SECRET="..."
fly secrets set STRIPE_SECRET_KEY="..."
fly deploy
```

## Deploying on VPS (Docker Compose)

### docker-compose.yml

```yaml
version: '3.8'

services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: ${DATABASE_URL}
      SESSION_SECRET: ${SESSION_SECRET}
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET}
      GOOGLE_REDIRECT_URI: ${GOOGLE_REDIRECT_URI}
      STRIPE_SECRET_KEY: ${STRIPE_SECRET_KEY}
      STRIPE_WEBHOOK_SECRET: ${STRIPE_WEBHOOK_SECRET}
      FRONTEND_URL: ${FRONTEND_URL}
      NODE_ENV: production
      PORT: 3000
    restart: unless-stopped

  frontend:
    image: nginx:alpine
    volumes:
      - ./artifacts/platform/dist:/usr/share/nginx/html
      - ./nginx.conf:/etc/nginx/conf.d/default.conf
    ports:
      - "80:80"
    restart: unless-stopped
```

### nginx.conf

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # API proxy
    location /api/ {
        proxy_pass http://api:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

## Database

This platform requires **PostgreSQL 14+**.

Recommended managed PostgreSQL providers:
- **Render PostgreSQL** (free tier available)
- **Neon** (serverless PostgreSQL, generous free tier)
- **Supabase** (PostgreSQL with extras)
- **PlanetScale** (MySQL-compatible, not PostgreSQL — not compatible)
- **Railway PostgreSQL**
- **AWS RDS**
- **Google Cloud SQL**

### Running Migrations

After deploying, run:
```bash
pnpm --filter @workspace/db run push
pnpm --filter @workspace/scripts run seed
```

Or use the Drizzle migration system for production:
```bash
pnpm --filter @workspace/db run generate  # Generate migration files
pnpm --filter @workspace/db run migrate   # Apply migrations
```

## Environment Variables Checklist

Before deploying to production, ensure you have set:

- [ ] `DATABASE_URL` — PostgreSQL connection string
- [ ] `SESSION_SECRET` — Random string (min 32 chars), generate: `openssl rand -hex 32`
- [ ] `GOOGLE_CLIENT_ID` — From Google Cloud Console
- [ ] `GOOGLE_CLIENT_SECRET` — From Google Cloud Console
- [ ] `GOOGLE_REDIRECT_URI` — Must match exactly what's in Google Console
- [ ] `STRIPE_SECRET_KEY` — Use `sk_live_` prefix for production
- [ ] `STRIPE_WEBHOOK_SECRET` — From Stripe webhook configuration
- [ ] `FRONTEND_URL` — Full URL of your frontend for OAuth redirects
- [ ] `ALLOWED_ORIGINS` — Comma-separated list of allowed CORS origins
- [ ] `NODE_ENV=production`

## Security Notes for Production

1. **SESSION_SECRET**: Must be a cryptographically random string. Never reuse development values.
2. **HTTPS**: Always use HTTPS in production. The session cookie is set with `secure: true` when `NODE_ENV=production`.
3. **CORS**: Set `ALLOWED_ORIGINS` to your exact frontend domain(s).
4. **Stripe Webhooks**: Verify your `STRIPE_WEBHOOK_SECRET` matches the one in your Stripe dashboard.
5. **Rate Limiting**: Consider adding express-rate-limit to the API server for production.
6. **Database SSL**: Add `?sslmode=require` to your `DATABASE_URL` for managed PostgreSQL providers.

> Note: This guide is intentionally provider-agnostic and may be adapted to equivalent services.
