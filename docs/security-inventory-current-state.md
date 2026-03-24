# Security Inventory — Current State (Monorepo)

## Scope and method
- This inventory is based on repository evidence across `apps/`, `lib/`, `.github/workflows/`, root config files, and architecture/security docs.
- It is intentionally **evidence-first**: controls are marked implemented only when directly observable in code/config/docs.
- It follows the explicit constraint to recommend **free-only** options (open-source, GitHub-native free features, or free-tier platform features).

---

## 1) Executive summary

### Plain-English posture
The repo has a solid **application-layer security baseline** for a public SaaS MVP: centralized auth/authz middleware, session cookies in Postgres, CSRF + origin/referer checks, CORS allowlist, explicit idle+absolute session policy, and meaningful audit logging coverage for key admin/org actions. Frontend routing is guarded and shares centralized auth/session client behavior.

At the same time, there are still notable **operational and perimeter gaps**: edge/WAF configuration remains out-of-repo and rate limiting is still in-memory (non-distributed). Free CI/security automation now includes Dependabot, dependency audit workflow, gitleaks, CodeQL, and backup/restore + incident response runbooks, while auth-abuse hardening now includes production-default Turnstile on targeted public POST flows.

### Biggest strengths
1. Centralized backend security middleware composition (`app.ts`) with explicit ordering for headers, CORS, session, CSRF, origin checks, and route mounting.
2. Middleware-based authorization model (`requireAuth`, org/admin/super-admin checks, app access checks).
3. Session hardening basics (httpOnly cookie, secure in production, sameSite=lax, session regeneration on sensitive transitions).
4. Audit log subsystem wired into key mutation paths and admin visibility endpoints.
5. CI guardrails for lockfile integrity, backend regression tests, and admin security shell routing contracts.

### Biggest likely gaps
1. Edge/perimeter controls are not codified in-repo (WAF/bot DDoS policy, edge rate limiting, managed firewall rules).
2. Rate limiting remains process-memory based (non-distributed).
3. Backup/restore policy is documented, but restore-drill evidence is still operational (out-of-repo).
4. Session anomaly controls remain limited (no risk-based re-auth/device heuristics).
5. Tenant-check review should continue as future app-module routes are added.

---

## 2) Confirmed implemented controls

### A) Edge/perimeter-adjacent (app-layer perimeter)
- **CORS allowlist + credentialed requests** in backend app bootstrap (`ALLOWED_ORIGINS`, dynamic origin check, credentials true).
  - `apps/api-server/src/app.ts`
- **Origin/Referer verification middleware** for sensitive routes (with explicit OAuth callback exception).
  - `apps/api-server/src/middlewares/csrf.ts`
- **Security headers middleware** sets HSTS, CSP, frame/content/referrer/CORP headers.
  - `apps/api-server/src/middlewares/securityHeaders.ts`

### B) Backend auth
- **Google OAuth implementation with token verification and optional hosted-domain enforcement**.
  - `apps/api-server/src/lib/auth.ts`
- **OAuth state and return-origin/session binding** in auth route flow.
  - `apps/api-server/src/routes/auth.ts`
- **Backend auth enforcement middleware** checks valid session user and account state (`active`, `suspended`, `deletedAt`).
  - `apps/api-server/src/middlewares/requireAuth.ts`

### C) Session management
- **PostgreSQL-backed sessions** (`connect-pg-simple`) with cookie controls and rolling inactivity expiration.
  - `apps/api-server/src/lib/session.ts`
  - `lib/db/src/schema/sessions.ts`
- **Cookie security posture**: `httpOnly=true`, `secure=true` in production, `sameSite=lax` (kept for OAuth callback compatibility), explicit `maxAge` idle timeout.
  - `apps/api-server/src/lib/session.ts`
- **Session policy includes both idle and absolute timeout controls**.
  - `apps/api-server/src/lib/session.ts`
- **Session rotation on org switch** via `req.session.regenerate` while preserving session age controls.
  - `apps/api-server/src/routes/users.ts`
  - `apps/api-server/src/lib/session.ts`
- **Observational session anomaly awareness** tracks last IP/UA and logs audit events on change (no blocking behavior).
  - `apps/api-server/src/lib/session.ts`
- **Logout other sessions** support by deleting other session rows for user.
  - `apps/api-server/src/routes/users.ts`

### D) Authorization / RBAC / access control
- **Layered middleware model**: `requireAuth`, `requireOrgAccess`, `requireOrgAdmin`, `requireSuperAdmin`, `requireAppAccess`.
  - `apps/api-server/src/middlewares/requireAuth.ts`
  - `apps/api-server/src/middlewares/requireOrgAccess.ts`
  - `apps/api-server/src/middlewares/requireAppAccess.ts`
- **Role resolution from membership status** (`active` only) and role precedence list.
  - `apps/api-server/src/lib/rbac.ts`
- **App-level entitlement context** (access mode / tenancy mode / onboarding mode).
  - `apps/api-server/src/lib/appAccess.ts`

### E) Tenant isolation patterns
- **Org-scoped routes protected by membership middleware** for org CRUD/members/invitations/subscriptions/audit logs.
  - `apps/api-server/src/routes/organizations.ts`
  - `apps/api-server/src/routes/invitations.ts`
  - `apps/api-server/src/routes/subscriptions.ts`
  - `apps/api-server/src/routes/audit.ts`
- **Tenant model in schema** (`organizations`, `org_memberships`, app access structures).
  - `lib/db/src/schema/organizations.ts`
  - `lib/db/src/schema/memberships.ts`
  - `lib/db/src/schema/apps.ts`

### F) Frontend security layer
- **Centralized auth provider + route guard** and CSRF bootstrap.
  - `lib/frontend-security/src/index.tsx`
- **Security shell contract tests** for protected routing assumptions in admin.
  - `apps/admin/src/__tests__/security-shell.contract.test.mjs`
  - `.github/workflows/admin-frontend-validation.yml`
- **Turnstile frontend integration hook** for anti-bot challenges.
  - `lib/frontend-security/src/turnstile.tsx`

### G) CSRF / CORS / headers
- **Session-bound CSRF token + `x-csrf-token` validation on unsafe methods**.
  - `apps/api-server/src/middlewares/csrf.ts`
- **CSRF token endpoint** `/api/csrf-token`.
  - `apps/api-server/src/app.ts`
- **Client-side CSRF header injection for unsafe HTTP methods** in shared fetch wrapper.
  - `lib/api-client-react/src/custom-fetch.ts`
- **CORS allowlist and credentialed cookies**.
  - `apps/api-server/src/app.ts`

### H) Abuse prevention / rate limiting / bot checks
- **Backend rate limiter middleware exists and is mounted on auth/org/invite/user/billing surfaces**, with stricter defaults for auth-sensitive route groups.
  - `apps/api-server/src/middlewares/rateLimit.ts`
  - `apps/api-server/src/app.ts`
- **Turnstile server-side verification middleware** defaults to enabled in production and is applied to targeted high-risk public POST flows (org creation, invitation creation, invitation acceptance).
  - `apps/api-server/src/middlewares/turnstile.ts`
  - `apps/api-server/src/routes/invitations.ts`
  - `apps/api-server/src/routes/organizations.ts`
- **Lightweight abuse telemetry** logs repeated auth failures, repeated Turnstile failures, and suspicious invitation acceptance attempts.
  - `apps/api-server/src/routes/auth.ts`
  - `apps/api-server/src/middlewares/turnstile.ts`
  - `apps/api-server/src/routes/invitations.ts`

### I) Signup / onboarding / invitation security
- **Invitation tokens are random high-entropy and stored hashed (SHA-256)**; TTL enforced and status transitions tracked.
  - `apps/api-server/src/routes/invitations.ts`
  - `lib/db/src/schema/invitations.ts`
- **Invitation acceptance requires authenticated user and email match with invitation email**.
  - `apps/api-server/src/routes/invitations.ts`
- **Onboarding and invitation UI integrate Turnstile token flow before submission**.
  - `apps/admin/src/pages/auth/Onboarding.tsx`
  - `apps/admin/src/pages/dashboard/Invitations.tsx`

### J) Observability / auditability / security logging
- **Backend correlation IDs and Sentry request/error instrumentation** (with safe header sanitization).
  - `apps/api-server/src/middlewares/observability.ts`
- **Audit log writes for key security-relevant events** (user creation/login, org/member/invitation/subscription/feature-flag changes).
  - `apps/api-server/src/lib/audit.ts`
  - `apps/api-server/src/routes/auth.ts`
  - `apps/api-server/src/routes/organizations.ts`
  - `apps/api-server/src/routes/invitations.ts`
  - `apps/api-server/src/routes/admin.ts`
  - `apps/api-server/src/routes/billing.ts`
- **Audit log retrieval endpoints (org-scoped and super-admin global)**.
  - `apps/api-server/src/routes/audit.ts`
  - `apps/api-server/src/routes/admin.ts`

### K) Secrets / env handling
- **Required env validation at startup** for core security/billing values.
  - `apps/api-server/src/lib/env.ts`
  - `apps/api-server/src/app.ts`
- **Additional critical assertions for production basics**.
  - `apps/api-server/src/lib/assertions.ts`
- **`.env.example` provided with explicit “never commit .env” guidance**.
  - `.env.example`

### L) Database access patterns
- **DB access centralized through shared package `@workspace/db` from app routes/libs**.
  - `lib/db/src/index.ts`
  - `apps/api-server/src/routes/*.ts`
- **Schema includes dedicated audit/session/invitation/membership/app-access tables** enabling security controls in data model.
  - `lib/db/src/schema/*.ts`

### M) Dependency / supply chain / CI protections
- **Root lockfile integrity check in CI** (`pnpm install --frozen-lockfile`).
  - `.github/workflows/lockfile-sync-check.yml`
- **Backend regression CI includes build/typecheck/tests and generated contract drift checks**.
  - `.github/workflows/backend-validation.yml`
- **Workspace dependency governance knobs in pnpm workspace config** (`minimumReleaseAge`, `onlyBuiltDependencies`, overrides).
  - `pnpm-workspace.yaml`

### N) Deployment safety and governance
- **PR validation gates enforce frontend and backend readiness before merge to `master`**.
  - `.github/workflows/admin-frontend-validation.yml`
  - `.github/workflows/backend-validation.yml`
- **Deployment governance is host-native auto-deploy from `master` after merge**.
  - `docs/ci-cd-and-deploy-rules.md`

---

## 3) Partially implemented / unclear controls

1. **Rate limiting is present with safer production default, but still limited architecturally**
   - Middleware exists and is mounted on sensitive route groups, and now defaults on in production unless explicitly disabled; state remains in-memory map per process (non-distributed, reset on restart, not shared across instances).
   - Evidence: `apps/api-server/src/middlewares/rateLimit.ts`, `apps/api-server/src/app.ts`.

2. **Turnstile is production-default for targeted public POST flows**
   - Verification is mandatory by default in production for selected high-risk flows, while development can remain practical with local toggles. Coverage is intentionally targeted (not applied to every route).
   - Evidence: `apps/api-server/src/middlewares/turnstile.ts`, `apps/api-server/src/routes/invitations.ts`, `apps/api-server/src/routes/organizations.ts`, `lib/frontend-security/src/turnstile.tsx`.

3. **Audit logging coverage improved, but should be reviewed continuously**
   - Several admin/org mutation routes write audit entries. Coverage now includes user suspend/unsuspend, membership role updates, active-org switch, self-delete, logout-other-sessions, invitation revoke, and invitation resend.
   - Evidence: compare `apps/api-server/src/routes/admin.ts`, `apps/api-server/src/routes/organizations.ts`, `apps/api-server/src/routes/users.ts`, `apps/api-server/src/routes/invitations.ts`.

4. **Tenant checks improved in Ayni app-module routes**
   - Ayni org-scoped handlers now enforce explicit active org membership validation for provided `orgId` and ceremony-linked reads. Shipibo currently has no org-scoped identifiers in schema/routes.
   - Evidence: `apps/api-server/src/routes/ayni.ts`, `apps/api-server/src/routes/shipibo.ts`, `apps/api-server/src/middlewares/requireAppAccess.ts`, `apps/api-server/src/lib/appAccess.ts`.

5. **OpenAPI security docs were improved but need ongoing parity checks**
   - The API spec now declares cookie session auth and CSRF header expectations; operations should be kept aligned as endpoints evolve.
   - Evidence: `lib/api-spec/openapi.yaml`.

6. **Frontend access checks are partly UX-level for super-admin**
   - Admin page redirects non-super-admin users in UI, but true enforcement is backend-side (good); still, UI checks should not be interpreted as security boundary by themselves.
   - Evidence: `apps/admin/src/pages/admin/AdminDashboard.tsx`, `apps/api-server/src/routes/admin.ts`.

7. **DB TLS config exists but uses permissive trust setting**
   - DB pool is configured with `ssl.rejectUnauthorized=false`, which may be acceptable for some managed services but is weaker than CA-validated TLS where available.
   - Evidence: `lib/db/src/index.ts`.

---

## 4) Missing or likely missing controls (FREE ONLY)

> Marked missing only where no evidence was found in repository/docs.

1. **Edge/WAF baseline not codified** (Missing)
   - No repo evidence for Cloudflare free-tier WAF/rate-limit/bot mode configuration (beyond Pages deploy wiring), or equivalent perimeter policy artifacts.

2. **Distributed/persistent rate limiting for auth & high-risk endpoints** (Missing)
   - Current limiter is in-process memory; no Redis/Postgres-backed algorithm present.

3. **Automated dependency vulnerability scanning** (Implemented)
   - Dependabot config and CI `pnpm audit --prod --audit-level=high` workflow are now present.

4. **Static security analysis workflow** (Implemented)
   - CodeQL workflow is present in `.github/workflows/codeql.yml` for JavaScript/TypeScript analysis.

5. **Secret scanning policy in CI** (Implemented)
   - Gitleaks workflow is present in `.github/workflows/secret-scan.yml`.

6. **Backup/restore procedure artifacts** (Implemented/Operationally Partial)
   - Backup/restore runbook exists in `docs/security-backup-and-restore.md` and manual drill logging template exists in `docs/security-restore-drill-log.md`; drill execution remains operational/manual by design.

7. **Incident response / security runbook** (Implemented)
   - Lightweight incident runbook is present in `docs/security-incident-response.md`.

8. **Session anomaly controls** (Partial)
   - Last IP and user-agent change events are now audit-logged for visibility, but there is still no device binding, risk-based re-auth, or MFA challenge flow.

9. **Security headers on static frontend hosting layer** (Unclear/Missing)
   - API sets headers, but no explicit Cloudflare Pages/nginx/static host header policy file for frontend routes/assets.

10. **Guaranteed `.env` local secret-file protection in gitignore** (Implemented)
   - Root `.gitignore` now ignores `.env` and `.env.*` while preserving `!.env.example`.

11. **Webhook idempotency/dedup tracking for Stripe events** (Implemented)
   - Persistent `stripe_webhook_events` table tracks processed `event_id`; duplicate webhook deliveries are acknowledged and skipped safely. Handler now also skips/records malformed `checkout.session.completed` events with missing subscription id.

12. **Auth endpoint-specific hardening controls** (Partial)
   - No explicit login attempt telemetry/lockout/cooldown policy besides optional generic limiter + Turnstile toggles.

---


## 4.1 Implemented now in this hardening pass

1. **Tenant isolation hardening (Ayni org-scoped handlers)**
   - Added explicit server-side active-org-membership checks before org-scoped reads/writes and ceremony-linked reads.
   - Evidence: `apps/api-server/src/routes/ayni.ts`, `apps/api-server/src/lib/orgMembership.ts`, `apps/api-server/src/__tests__/tenant-isolation.test.ts`.

2. **Dependency and secret automation (free-only)**
   - Added Dependabot config, CI dependency vulnerability audit, and CI gitleaks secret scanning.
   - Evidence: `.github/dependabot.yml`, `.github/workflows/dependency-vulnerability-scan.yml`, `.github/workflows/secret-scan.yml`.

3. **Static analysis (free-only CodeQL)**
   - Added GitHub CodeQL workflow for JavaScript/TypeScript with pull request, master push, and weekly scheduled analysis.
   - Evidence: `.github/workflows/codeql.yml`.

4. **Incident response runbook**
   - Added lightweight security incident response runbook with triage, containment, secret rotation, and recovery checklists.
   - Evidence: `docs/security-incident-response.md`.

5. **Audit logging coverage**
   - Added audit events for super-admin user suspend/unsuspend, org member role updates, active-org switch, self-delete, logout-other-sessions, invitation revoke, and invitation resend.
   - Evidence: `apps/api-server/src/routes/users.ts`, `apps/api-server/src/routes/organizations.ts`, `apps/api-server/src/routes/invitations.ts`.

6. **Stripe webhook idempotency**
   - Added DB-backed webhook replay deduplication keyed by Stripe `event.id` plus a defensive skip path for malformed checkout completion payloads.
   - Evidence: `apps/api-server/src/routes/billing.ts`, `lib/db/src/schema/stripe_webhook_events.ts`, `lib/db/migrations/20260320_stripe_webhook_events.sql`.

7. **Rate limiter production safety default**
   - Rate limiting defaults enabled in production; disabling it in production now requires explicit `RATE_LIMIT_ALLOW_DISABLE_IN_PRODUCTION=true` override.
   - Evidence: `apps/api-server/src/middlewares/rateLimit.ts`, `apps/api-server/src/lib/assertions.ts`.

8. **Turnstile production-disable guardrail**
   - Turnstile now remains enabled in production by default even if `TURNSTILE_ENABLED=false` is set accidentally; production disable requires explicit `TURNSTILE_ALLOW_DISABLE_IN_PRODUCTION=true`.
   - Evidence: `apps/api-server/src/middlewares/turnstile.ts`, `apps/api-server/src/lib/assertions.ts`.

9. **OpenAPI security docs alignment**
   - API spec now explicitly documents cookie session auth and CSRF header expectations for unsafe methods.
   - Evidence: `lib/api-spec/openapi.yaml`.

10. **Backup/restore runbook + local env ignore protections**
   - Added practical backup/restore doc and `.gitignore` protections for local secret files.
   - Evidence: `docs/security-backup-and-restore.md`, `.gitignore`.

11. **Restore-drill cadence + tracking template**
   - Added explicit cadence guidance and a copy/paste-friendly manual drill log template.
   - Evidence: `docs/security-backup-and-restore.md`, `docs/security-restore-drill-log.md`.

## 5) Security control matrix

| Control area | Status | Evidence | Notes / risk |
|---|---|---|---|
| Security headers (API) | Implemented | `apps/api-server/src/middlewares/securityHeaders.ts` | Good baseline; CSP includes `unsafe-inline` (risk tradeoff). |
| CORS allowlist | Implemented | `apps/api-server/src/app.ts` | Requires `ALLOWED_ORIGINS`; credentialed cookies supported. |
| CSRF token validation | Implemented | `apps/api-server/src/middlewares/csrf.ts`, `lib/api-client-react/src/custom-fetch.ts` | Solid session-bound token pattern. |
| Origin/Referer protection | Implemented | `apps/api-server/src/middlewares/csrf.ts` | Defense-in-depth; allows auth callback exception. |
| Backend auth | Implemented | `apps/api-server/src/lib/auth.ts`, `apps/api-server/src/routes/auth.ts` | OAuth state validated; optional hosted domain check. |
| Session storage/cookies | Implemented | `apps/api-server/src/lib/session.ts`, `lib/db/src/schema/sessions.ts` | Postgres persistence; secure cookie in production. |
| Session rotation | Implemented | `apps/api-server/src/routes/users.ts` | Rotation on org switch reduces fixation risk. |
| RBAC middleware | Implemented | `apps/api-server/src/middlewares/require*.ts` | Clear layered model. |
| Super-admin enforcement | Implemented | `apps/api-server/src/middlewares/requireAuth.ts`, `apps/api-server/src/routes/admin.ts` | Requires both super-admin flag and admin app entitlement. |
| Tenant isolation (org routes) | Implemented | `apps/api-server/src/routes/organizations.ts`, `.../invitations.ts`, `.../audit.ts` | Strong on org-centric routes. |
| Tenant isolation (app module routes) | Partial | `apps/api-server/src/routes/ayni.ts`, `.../shipibo.ts` | App entitlement check exists; per-org ownership validation not consistently explicit. |
| Turnstile anti-bot | Partial | `lib/frontend-security/src/turnstile.tsx`, `apps/api-server/src/middlewares/turnstile.ts` | Production-safe defaults now enforced; still toggle-dependent by explicit override. |
| Rate limiting | Partial | `apps/api-server/src/middlewares/rateLimit.ts`, `apps/api-server/src/app.ts` | In-memory, env-enabled, not distributed. |
| Invitation token security | Implemented | `apps/api-server/src/routes/invitations.ts`, `lib/db/src/schema/invitations.ts` | Random token, hashed at rest, expiry/status checks. |
| Audit logging | Implemented/Partial | `apps/api-server/src/lib/audit.ts`, routes | Good coverage but not exhaustive on all privileged actions. |
| Backend observability & correlation IDs | Implemented | `apps/api-server/src/middlewares/observability.ts` | Includes header sanitization and correlation context. |
| Frontend security shell | Implemented | `lib/frontend-security/src/index.tsx`, admin tests/workflow | Guarded route shell and CI contract checks. |
| Secrets/env validation | Implemented/Partial | `apps/api-server/src/lib/env.ts`, `apps/api-server/src/lib/assertions.ts` | Core vars enforced; secret hygiene policy docs limited. |
| DB TLS posture | Partial | `lib/db/src/index.ts` | TLS on, but `rejectUnauthorized=false` weakens trust verification. |
| Dependency integrity lockfile check | Implemented | `.github/workflows/lockfile-sync-check.yml` | Good baseline integrity check. |
| Dependency vulnerability scanning | Implemented | `.github/dependabot.yml`, `.github/workflows/dependency-vulnerability-scan.yml` | Runs Dependabot and high-severity production audit checks. |
| SAST/CodeQL | Implemented | `.github/workflows/codeql.yml` | JavaScript/TypeScript CodeQL runs on PR, master push, and weekly schedule. |
| Secrets scanning | Implemented | `.github/workflows/secret-scan.yml` | Gitleaks runs on PR/push/schedule. |
| Backup/restore runbook | Implemented/Operationally Partial | `docs/security-backup-and-restore.md` | Runbook exists; retention/drill execution remains operational. |
| Edge/WAF controls | Unclear/Missing | `apps/admin/public/_redirects` provides SPA routing fallback only | No explicit edge security policy in repo. |

---

## 5.1 Session policy snapshot
- **Idle timeout:** rolling cookie/session maxAge (default 1 hour via `SESSION_IDLE_TIMEOUT_MS`).
- **Absolute timeout:** hard cap regardless of activity (default 24 hours via `SESSION_ABSOLUTE_TIMEOUT_MS`).
- **Cookie posture:** `httpOnly`, `secure` in production, `sameSite=lax` (OAuth-compatible), explicit cookie maxAge.
- **Anomaly awareness:** last IP and last user-agent are tracked in session and changes generate `session.anomaly_observed` audit events.
- **Current limitations:** no MFA, no device fingerprinting/binding, no adaptive/risk-based re-auth challenges, and no automated fraud decisioning/blocking beyond targeted middleware + audit telemetry.

## 6) Priority gaps (FREE solutions only)

### Ranked by highest risk
1. **Distributed/persistent rate limiting is still missing** — current limiter is in-memory per process.
2. **Edge/perimeter policy not codified in repo** — keep deployment checklist aligned outside-in.
3. **Restore-drill evidence still operational** — run drills on cadence and keep entries current in `docs/security-restore-drill-log.md`.
4. **Session anomaly controls remain limited** — no risk-based re-auth or device heuristics.
5. **DB TLS trust hardening remains partial** — `rejectUnauthorized=false` remains a tradeoff.

### Ranked by easiest to implement
1. Keep CodeQL tuned for low-noise (query pack/path exclusions only when justified by real false positives).
2. Run the new incident runbook once as a tabletop to validate practicality.
3. Keep `docs/security-restore-drill-log.md` updated on each cadence drill with result and TTR.
4. Evaluate Postgres-backed sliding-window rate limiting for multi-instance safety.
5. Keep OpenAPI security declarations synced with middleware behavior.

### Ranked by biggest impact
1. Server-side tenant-bound query hardening (prevents cross-tenant data leak class).
2. Production-default rate limit policy for auth/onboarding/invitation endpoints.
3. Backup/restore readiness documentation and routine verification.
4. Free dependency + secret scanning automation in CI (now implemented; keep tuned for low-noise).
5. Edge free-tier baseline (e.g., Cloudflare free: bot fight mode, basic WAF managed rules, DNS proxy, TLS mode) documented as deployment checklist.

---

## 7) Questions needing user confirmation

1. Which production edge sits in front of API/admin today (Cloudflare free, Nginx, other)?
2. Is this repository public on GitHub (to confirm free CodeQL + Dependabot availability)?
3. Do you want rate limiting enabled by default in production (`RATE_LIMIT_ENABLED=true`) as a non-negotiable?
4. Is `apps/api-server` deployed as a single instance only, or horizontally scaled?
5. What is the current DB provider backup policy (if any) and desired RPO/RTO targets?
6. Should super-admin/user suspension/member-role changes be fully audit-logged for every write?
7. Should Turnstile be mandatory for all signup/onboarding/invite-related POST endpoints in production?
8. Should we enforce strict org membership checks in all Ayni/Shipibo endpoints where `orgId` is provided?
9. Do you want OpenAPI security schemes explicitly documented (cookie auth + CSRF header contract)?
10. Do you want monthly or quarterly cadence as your default for `docs/security-restore-drill-log.md` entries?

---

## Additional requested outputs

## Short overall assessment
Security posture is **moderately strong at the app layer** for a SaaS baseline, but **operational security maturity is incomplete** until free automated scanning, explicit backup/restore procedures, stronger tenant-check consistency, and edge/perimeter policy documentation are added.

## Top 10 strongest controls
1. Centralized security middleware ordering in API app bootstrap.
2. Middleware-driven authz model with org/admin/super-admin/app-access layers.
3. Session persistence in Postgres with secure/httpOnly cookie behavior.
4. CSRF token issuance + unsafe-method enforcement.
5. Origin/referer checks for sensitive requests.
6. OAuth state handling and hosted-domain optional restriction.
7. Invitation tokens hashed at rest with expiry + status lifecycle.
8. Correlation ID + observability pipeline with header sanitization.
9. Audit log model and key action instrumentation.
10. CI gates for lockfile integrity + backend regression + admin security shell behavior.

## Top 10 missing controls (free solutions)
1. Distributed/persistent rate limiter (or hardened single-instance defaults).
2. Edge free-tier baseline checklist (Cloudflare/Nginx) committed in docs.
3. Restore-drill log entries kept current on the defined cadence.
4. DB TLS CA validation (`rejectUnauthorized=true`) where provider supports it.
5. Session anomaly controls (risk-based re-auth / suspicious-login heuristics).
6. Continued audit-log coverage checks as new privileged endpoints are added.
7. Endpoint-level OpenAPI security annotations for each unsafe operation.
8. Optional SBOM generation and artifact retention in CI.
9. Free tabletop incident drill cadence notes attached to the runbook.
10. Lightweight provider-side access review checklist (GitHub/cloud/DB/Stripe/OAuth).

## Contradictions between docs and code
1. **Role model mismatch**: narrative docs/readme mention roles like `owner/admin/member/viewer`, while backend RBAC constants and org admin checks use `org_owner/org_admin/staff`.
   - Evidence: `README.md`, `replit.md`, `apps/api-server/src/lib/rbac.ts`, `apps/api-server/src/routes/organizations.ts`, `apps/admin/src/pages/dashboard/Invitations.tsx`.
2. **ALLOWED_ORIGINS behavior mismatch**: `.env.example` says “leave empty to allow all,” but runtime throws if `ALLOWED_ORIGINS` is empty.
   - Evidence: `.env.example`, `apps/api-server/src/app.ts`.
3. **Rate-limit guidance drift**: portability doc says “consider adding express-rate-limit,” while code already has a custom rate limiter mounted (though optional).
   - Evidence: `PORTABILITY.md`, `apps/api-server/src/middlewares/rateLimit.ts`, `apps/api-server/src/app.ts`.
4. **Operational claims vs guardrails**: docs state “no secrets in source code”; repo includes seed defaults with privileged demo identity and static emails (not secrets, but operationally sensitive defaults).
   - Evidence: `PORTABILITY.md`, `scripts/src/seed.ts`.
