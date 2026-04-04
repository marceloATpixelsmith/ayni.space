# 04 — Auth and Session Inventory

## Scope
- Inventory auth/session architecture at the system level without adding policy details not present in `01`.
- Canonical companion: `docs/authentication-and-session-architecture.md`.

## Confirmed
- Backend auth implementation location: `apps/api-server/src/lib/auth.ts`.
- Backend auth/session route wiring: `apps/api-server/src/routes/auth.ts`.
- Session lifecycle/rotation helpers and canonical session destruction/cookie clearing/logout-others helpers: `apps/api-server/src/lib/session.ts`.
- Session-group resolver/cookie mapping helpers: `apps/api-server/src/lib/sessionGroup.ts`.
- Session middleware issuance is request-scoped by group in `apps/api-server/src/lib/session.ts` (group is resolved per request and routed to a matching per-group `express-session` middleware instance/cookie name).
- Session issuance also namespaces generated session IDs by group (`<group>.<uuid>` in `apps/api-server/src/lib/session.ts`) so one backend/store can persist multiple group sessions for the same browser without SID collisions.
- Request group resolution is trust-aware and fail-closed for ambiguous multi-cookie flows via `resolveSessionGroupForRequest` in `apps/api-server/src/lib/sessionGroup.ts`.
- OAuth denial and logout are group-scoped in `apps/api-server/src/routes/auth.ts` (admin denial destroys/clears admin-group session state only).
- Session persistence table is `platform.sessions` and is owned by DB migrations.
- Session revocation for `/api/users/logout-others` is group-aware (`apps/api-server/src/lib/session.ts`, `apps/api-server/src/routes/users.ts`) and does not wipe unrelated session groups.
- Password-reset completion revokes all other sessions for the recovered user across session groups, then clears the current group cookie/session (`apps/api-server/src/lib/session.ts`, `apps/api-server/src/routes/auth.ts`).
- Frontend auth provider/route gate: `lib/frontend-security/src/index.tsx`.
- CSRF-aware API fetch path: `lib/api-client-react/src/custom-fetch.ts`.
- OAuth start origin derivation in auth route resolves trusted `origin`/`referer` and trusted forwarded host/proto headers before allowlist checks (`apps/api-server/src/routes/auth.ts`).
- Shared frontend fetch layers force credentialed auth/session requests (`/api/auth/*`, `/api/csrf-token`) via `credentials: "include"` (`lib/api-client-react/src/custom-fetch.ts`, `lib/frontend-security/src/index.tsx`).
- Auth/session middleware integration lives in `apps/api-server/src/app.ts`.

## Inferred
- Session/auth is backend-authoritative, with frontend consuming session state via shared provider and API client.

## Unclear
- Full auth provider roadmap and lifecycle policy documentation beyond current implementation files.

## Do not break
- Do not introduce app-local auth/session flows that bypass `lib/frontend-security`.
- Do not decouple auth/session handling from `apps/api-server` middleware pipeline.
