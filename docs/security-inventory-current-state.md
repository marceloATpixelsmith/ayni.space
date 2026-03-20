# Security Inventory — Current State (Monorepo)

## Scope and method
- This inventory is based on repository evidence across `apps/`, `lib/`, `.github/workflows/`, root config files, and architecture/security docs.
- It is intentionally **evidence-first**: controls are marked implemented only when directly observable in code/config/docs.
- It follows the explicit constraint to recommend **free-only** options (open-source, GitHub-native free features, or free-tier platform features).

---

## 1) Executive summary

### Plain-English posture
The repo has a solid **application-layer security baseline** for a public SaaS MVP: centralized auth/authz middleware, session cookies in Postgres, CSRF + origin/referer checks, CORS allowlist, and meaningful audit logging coverage for key admin/org actions. Frontend routing is guarded and shares centralized auth/session client behavior.

At the same time, there are notable **operational and perimeter gaps**: no repo evidence of edge/WAF configuration, no automated dependency vulnerability scanning workflow, no backup/restore runbook, no explicit secret scanning in CI, and no persistent/distributed rate-limiter (current limiter is in-memory and opt-in via env).

### Biggest strengths
1. Centralized backend security middleware composition (`app.ts`) with explicit ordering for headers, CORS, session, CSRF, origin checks, and route mounting.
2. Middleware-based authorization model (`requireAuth`, org/admin/super-admin checks, app access checks).
3. Session hardening basics (httpOnly cookie, secure in production, sameSite=lax, session regeneration on sensitive transitions).
4. Audit log subsystem wired into key mutation paths and admin visibility endpoints.
5. CI guardrails for lockfile integrity, backend regression tests, and admin security shell routing contracts.

### Biggest likely gaps
1. Edge/perimeter controls are not codified in-repo (WAF/bot DDoS policy, edge rate limiting, managed firewall rules).
2. Rate limiting is process-memory based and disabled unless env flag is set.
3. No repository evidence of Dependabot/GitHub Advisory scanning, CodeQL, or SBOM generation.
4. No backup/restore policy artifacts found.
5. Some tenant-bound routes rely on app-access only and accept org IDs from request parameters without explicit org membership enforcement in the route itself.

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
- **PostgreSQL-backed sessions** (`connect-pg-simple`) with cookie controls and rolling expiration.  
  - `apps/api-server/src/lib/session.ts`
  - `lib/db/src/schema/sessions.ts`
- **Session rotation on org switch** via `req.session.regenerate`.  
  - `apps/api-server/src/routes/users.ts`
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
  - `.github/workflows/admin-security-shell-test-and-deploy.yml`
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
- **Backend rate limiter middleware exists and is mounted on auth/org/invite/user/billing surfaces**.  
  - `apps/api-server/src/middlewares/rateLimit.ts`  
  - `apps/api-server/src/app.ts`
- **Turnstile server-side verification middleware** and integration in sensitive onboarding/invitation/org-create routes.  
  - `apps/api-server/src/middlewares/turnstile.ts`  
  - `apps/api-server/src/routes/invitations.ts`  
  - `apps/api-server/src/routes/organizations.ts`

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
  - `.github/workflows/backend-regression-gates.yml`
- **Workspace dependency governance knobs in pnpm workspace config** (`minimumReleaseAge`, `onlyBuiltDependencies`, overrides).  
  - `pnpm-workspace.yaml`

### N) Deployment safety and governance
- **Deploy flow gated by tests and master branch condition for admin pipeline**.  
  - `.github/workflows/admin-security-shell-test-and-deploy.yml`
- **Safe non-destructive codex auto-merge model with required-check gating logic**.  
  - `.github/workflows/codex-safe-auto-merge.yml`
  - `docs/safe-auto-merge-governance.md`

---

## 3) Partially implemented / unclear controls

1. **Rate limiting is present but weak by default**
   - Middleware exists and is mounted on sensitive route groups, but it is disabled unless `RATE_LIMIT_ENABLED=true`; state is in-memory map per process (non-distributed, reset on restart, not shared across instances).  
   - Evidence: `apps/api-server/src/middlewares/rateLimit.ts`, `apps/api-server/src/app.ts`.

2. **Turnstile is integrated but optional/toggle-based**
   - Verification only occurs when env toggles are enabled and token supplied. This is correct for feature flags, but leaves risk if ops forget to enable in production.  
   - Evidence: `apps/api-server/src/middlewares/turnstile.ts`, `lib/frontend-security/src/turnstile.tsx`.

3. **Audit logging is good but not comprehensive for all privileged actions**
   - Several admin/org mutation routes write audit entries; others (e.g., user suspend/unsuspend, membership role changes) do not consistently log action metadata.  
   - Evidence: compare `apps/api-server/src/routes/admin.ts`, `apps/api-server/src/routes/organizations.ts`, `apps/api-server/src/routes/users.ts`.

4. **Tenant checks are inconsistent across app-module routes**
   - Some app routes (notably Ayni/Shipibo module endpoints) enforce `requireAppAccess` but do not enforce org membership on provided `orgId` query values in each handler, creating potential cross-tenant read/write exposure depending on app-access model.  
   - Evidence: `apps/api-server/src/routes/ayni.ts`, `apps/api-server/src/routes/shipibo.ts`, `apps/api-server/src/middlewares/requireAppAccess.ts`, `apps/api-server/src/lib/appAccess.ts`.

5. **OpenAPI contract lacks explicit security scheme documentation**
   - The API spec defines paths but does not declare cookie auth/CSRF requirements as reusable `components.securitySchemes` + operation `security` declarations.  
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
   - No repo evidence for Cloudflare free-tier WAF/rate-limit/bot mode configuration, Vercel edge firewall config, or equivalent perimeter policy artifacts.

2. **Distributed/persistent rate limiting for auth & high-risk endpoints** (Missing)
   - Current limiter is in-process memory; no Redis/Postgres-backed algorithm present.

3. **Automated dependency vulnerability scanning** (Missing)
   - No `dependabot.yml`, no explicit npm/pnpm audit workflow, no osv/audit-ci/Snyk free alternative workflow in CI.

4. **Static security analysis workflow** (Missing)
   - No CodeQL (free for public repos) or equivalent SAST workflow file present.

5. **Secret scanning policy in CI** (Missing)
   - No gitleaks/trufflehog-style scan workflow in repo.

6. **Backup/restore procedure artifacts** (Missing)
   - No documented DB backup cadence, retention, restore drills, or runbooks in docs.

7. **Incident response / security runbook** (Missing)
   - No dedicated incident/severity handling doc found under `docs/`.

8. **Session anomaly controls** (Partial→Missing)
   - No evidence of IP/device binding heuristics, risk-based re-auth, or brute-force lockouts beyond generic rate-limiter toggle.

9. **Security headers on static frontend hosting layer** (Unclear/Missing)
   - API sets headers, but no explicit vercel/nginx/static host header policy file for frontend routes/assets.

10. **Guaranteed `.env` local secret-file protection in gitignore** (Missing)
   - `.env.example` warns not to commit `.env`, but root `.gitignore` does not currently list `.env`/`.env.*` ignore patterns.

11. **Webhook idempotency/dedup tracking for Stripe events** (Missing)
   - Signature verification exists, but no persistent processed-event ID deduping visible.

12. **Auth endpoint-specific hardening controls** (Partial)
   - No explicit login attempt telemetry/lockout/cooldown policy besides optional generic limiter + Turnstile toggles.

---

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
| Turnstile anti-bot | Partial | `lib/frontend-security/src/turnstile.tsx`, `apps/api-server/src/middlewares/turnstile.ts` | Good integration but toggle-dependent. |
| Rate limiting | Partial | `apps/api-server/src/middlewares/rateLimit.ts`, `apps/api-server/src/app.ts` | In-memory, env-enabled, not distributed. |
| Invitation token security | Implemented | `apps/api-server/src/routes/invitations.ts`, `lib/db/src/schema/invitations.ts` | Random token, hashed at rest, expiry/status checks. |
| Audit logging | Implemented/Partial | `apps/api-server/src/lib/audit.ts`, routes | Good coverage but not exhaustive on all privileged actions. |
| Backend observability & correlation IDs | Implemented | `apps/api-server/src/middlewares/observability.ts` | Includes header sanitization and correlation context. |
| Frontend security shell | Implemented | `lib/frontend-security/src/index.tsx`, admin tests/workflow | Guarded route shell and CI contract checks. |
| Secrets/env validation | Implemented/Partial | `apps/api-server/src/lib/env.ts`, `apps/api-server/src/lib/assertions.ts` | Core vars enforced; secret hygiene policy docs limited. |
| DB TLS posture | Partial | `lib/db/src/index.ts` | TLS on, but `rejectUnauthorized=false` weakens trust verification. |
| Dependency integrity lockfile check | Implemented | `.github/workflows/lockfile-sync-check.yml` | Good baseline integrity check. |
| Dependency vulnerability scanning | Missing | (no workflow/config found) | Add free Dependabot + audit workflow. |
| SAST/CodeQL | Missing | (no workflow found) | GitHub CodeQL free on public repos. |
| Secrets scanning | Missing | (no workflow found) | Add gitleaks/trufflehog free CI step. |
| Backup/restore runbook | Missing | (no docs/workflows found) | High operational risk for SaaS continuity. |
| Edge/WAF controls | Unclear/Missing | `apps/admin/vercel.json` has rewrites only | No explicit edge security policy in repo. |

---

## 6) Priority gaps (FREE solutions only)

### Ranked by highest risk
1. **Inconsistent tenant checks in app module routes** — enforce org ownership/membership checks server-side for every org-scoped query/body param.  
2. **No dependency vuln scanning** — enable Dependabot alerts/PRs + scheduled `pnpm audit --prod` CI.  
3. **No secret scanning in CI** — add gitleaks/trufflehog workflow.  
4. **No backup/restore playbook** — add documented free runbook + periodic restore test checklist.  
5. **Rate limiting not production-robust** — enable by default and move to free persistent backend (Postgres or free Redis tier) if multi-instance.

### Ranked by easiest to implement
1. Add `.env` and `.env.*` ignore patterns in `.gitignore`.
2. Add `/.github/dependabot.yml` for npm/pnpm ecosystem.
3. Add CodeQL workflow (`github/codeql-action`) for JS/TS.
4. Add gitleaks workflow (free OSS action).
5. Add `docs/security-backup-and-restore.md` runbook and recovery objectives.

### Ranked by biggest impact
1. Server-side tenant-bound query hardening (prevents cross-tenant data leak class).
2. Free dependency + secret scanning automation in CI (prevents known-vuln and leaked-secret classes).
3. Production-default rate limit policy for auth/onboarding/invitation endpoints.
4. Backup/restore readiness documentation and routine verification.
5. Edge free-tier baseline (e.g., Cloudflare free: bot fight mode, basic WAF managed rules, DNS proxy, TLS mode) documented as deployment checklist.

---

## 7) Questions needing user confirmation

1. Which production edge sits in front of API/admin today (Cloudflare free, Vercel edge, Nginx, other)?
2. Is this repository public on GitHub (to confirm free CodeQL + Dependabot availability)?
3. Do you want rate limiting enabled by default in production (`RATE_LIMIT_ENABLED=true`) as a non-negotiable?
4. Is `apps/api-server` deployed as a single instance only, or horizontally scaled?
5. What is the current DB provider backup policy (if any) and desired RPO/RTO targets?
6. Should super-admin/user suspension/member-role changes be fully audit-logged for every write?
7. Should Turnstile be mandatory for all signup/onboarding/invite-related POST endpoints in production?
8. Should we enforce strict org membership checks in all Ayni/Shipibo endpoints where `orgId` is provided?
9. Do you want OpenAPI security schemes explicitly documented (cookie auth + CSRF header contract)?
10. Should we add a formal security runbook in `docs/` now (incident response + key rotation + restore drill)?

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
1. Dependabot (or equivalent free dependency vulnerability automation).
2. CodeQL/SAST workflow.
3. Secret scanning workflow.
4. Backup/restore runbook and restore test cadence.
5. Distributed/persistent rate limiter (or hardened single-instance defaults).
6. Edge free-tier baseline checklist (Cloudflare/Vercel/Nginx) committed in docs.
7. Explicit OpenAPI security scheme declarations.
8. Webhook idempotency event-store for Stripe webhook replay protection.
9. Full audit coverage for all privileged writes (suspend/unsuspend/role changes, etc.).
10. `.env` ignore patterns in `.gitignore` to align with secret-handling expectations.

## Contradictions between docs and code
1. **Role model mismatch**: narrative docs/readme mention roles like `owner/admin/member/viewer`, while backend RBAC constants and org admin checks use `org_owner/org_admin/staff`.  
   - Evidence: `README.md`, `replit.md`, `apps/api-server/src/lib/rbac.ts`, `apps/api-server/src/routes/organizations.ts`, `apps/admin/src/pages/dashboard/Invitations.tsx`.
2. **ALLOWED_ORIGINS behavior mismatch**: `.env.example` says “leave empty to allow all,” but runtime throws if `ALLOWED_ORIGINS` is empty.  
   - Evidence: `.env.example`, `apps/api-server/src/app.ts`.
3. **Rate-limit guidance drift**: portability doc says “consider adding express-rate-limit,” while code already has a custom rate limiter mounted (though optional).  
   - Evidence: `PORTABILITY.md`, `apps/api-server/src/middlewares/rateLimit.ts`, `apps/api-server/src/app.ts`.
4. **Operational claims vs guardrails**: docs state “no secrets in source code”; repo includes seed defaults with privileged demo identity and static emails (not secrets, but operationally sensitive defaults).  
   - Evidence: `PORTABILITY.md`, `scripts/src/seed.ts`.

