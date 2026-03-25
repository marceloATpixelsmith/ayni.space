# 02 — App Catalog

## Scope
- Inventory the app surfaces currently present under `apps/*` and their implementation status.
- Source of truth: `docs/monorepo-overview.md` plus referenced app paths.

## Confirmed
- Active app: `apps/api-server` (backend runtime entry + routes).
- Active app: `apps/admin` (primary frontend shell).
- Partially implemented app: `apps/mockup-sandbox` (runnable, not in root scripts/CI).
- Placeholder app directories only: `apps/ayni/.gitkeep`, `apps/shipibo/.gitkeep`, `apps/screening/.gitkeep`.
- Concrete implementation references:
  - backend entry/composition: `apps/api-server/src/index.ts`, `apps/api-server/src/app.ts`
  - frontend entry/shell: `apps/admin/src/main.tsx`, `apps/admin/src/App.tsx`
  - mockup app package/source: `apps/mockup-sandbox/package.json`, `apps/mockup-sandbox/src/*`

## Inferred
- `apps/admin` currently carries both tenant and platform-admin UI responsibilities.
- `apps/api-server` is the single active backend gateway for current app surfaces.

## Unclear
- Whether placeholder app directories are near-term delivery targets or namespace reservations.

## Do not break
- Do not treat placeholder app directories as implemented products.
- Do not bypass `apps/api-server` as the backend entry boundary for active app flows.
- Do not claim CI/deploy coverage for apps not targeted by workflows.

## DEPLOYMENT MODEL (NEW)

* All deployments happen automatically on push to master
* Cloudflare Pages deploys frontend (apps/admin)
* Render deploys backend (apps/api-server)
* GitHub Actions are used ONLY for:

  * running tests
  * logging results
* CI does NOT block deploys
* No pull-request promotion system exists

## DEVELOPER FLOW

1. Make changes
2. Commit directly to master
3. Push
4. Both frontend and backend deploy automatically

## IMPORTANT NOTES

* No auto-merge system exists
* No required checks exist
* No deployment gating exists
* If tests fail, deployment STILL happens
