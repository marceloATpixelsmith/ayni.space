# 04 — Auth and Session Inventory

## Scope
- Inventory auth/session architecture at the system level without adding policy details not present in `01`.
- Canonical companion: `docs/authentication-and-session-architecture.md`.

## Confirmed
- Backend auth implementation location: `apps/api-server/src/lib/auth.ts`.
- Backend auth/session route wiring: `apps/api-server/src/routes/auth.ts`.
- Session lifecycle/rotation helpers: `apps/api-server/src/lib/session.ts`.
- Session persistence table is `platform.sessions` and is owned by DB migrations.
- Frontend auth provider/route gate: `lib/frontend-security/src/index.tsx`.
- CSRF-aware API fetch path: `lib/api-client-react/src/custom-fetch.ts`.
- Auth/session middleware integration lives in `apps/api-server/src/app.ts`.

## Inferred
- Session/auth is backend-authoritative, with frontend consuming session state via shared provider and API client.

## Unclear
- Full auth provider roadmap and lifecycle policy documentation beyond current implementation files.

## Do not break
- Do not introduce app-local auth/session flows that bypass `lib/frontend-security`.
- Do not decouple auth/session handling from `apps/api-server` middleware pipeline.
