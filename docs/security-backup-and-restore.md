# Security Backup and Restore Runbook

## Scope
- Practical backup/restore guidance for the current monorepo architecture.
- Covers repository-managed assets and database-backed runtime state that affect security, tenant access, and recoverability.
- Uses free/low-cost operational practices only.

## Confirmed
- Primary runtime state is in PostgreSQL via `@workspace/db` (`users`, `organizations`, `org_memberships`, `sessions`, `subscriptions`, `invitations`, `audit_logs`, app-module tables).  
  - Evidence: `lib/db/src/schema/*.ts`.
- Sessions are persisted in Postgres (`sessions` table), so DB loss impacts authentication continuity.  
  - Evidence: `apps/api-server/src/lib/session.ts`, `lib/db/src/schema/sessions.ts`.
- Security/audit history is persisted in Postgres (`audit_logs`).  
  - Evidence: `apps/api-server/src/lib/audit.ts`, `lib/db/src/schema/audit_logs.ts`.
- Stripe state is partially mirrored in Postgres subscriptions and webhook event processing.  
  - Evidence: `apps/api-server/src/routes/billing.ts`, `lib/db/src/schema/subscriptions.ts`, `lib/db/src/schema/stripe_webhook_events.ts`.
- Schema evolution is tracked by SQL migrations under `lib/db/migrations/`.  
  - Evidence: `lib/db/migrations/*.sql`.

## What must be backed up
1. **PostgreSQL data (highest priority)**  
   - All `platform`, `ayni`, and `shipibo` schema tables.
2. **Database migration SQL history**  
   - `lib/db/migrations/*.sql` (already in git; ensure remote origin remains healthy).
3. **Critical environment configuration values (securely, out of git)**  
   - `DATABASE_URL`, `SESSION_SECRET`, OAuth secrets, Stripe secrets, Sentry DSN, allowed origins.
4. **Operational CI/CD/security config in git**  
   - `.github/workflows/*`, `.github/CODEOWNERS`, docs runbooks.

## Likely current backup dependencies
- Managed Postgres provider snapshot/backup capability (outside repo).
- Git remote as source of truth for code/migrations/docs/workflows.
- Secret manager or deployment platform env-var storage for runtime secrets.

## Restore priorities (ordered)
1. **Restore database instance** from latest clean snapshot.
2. **Re-apply code + migrations** from repository (`master`).
3. **Restore runtime secrets/env** in deployment environment.
4. **Bring up API service** and verify auth/session and org access.
5. **Verify Stripe webhook processing** and subscription state sync.
6. **Validate audit visibility** for admin/org logs.

## Minimum recovery checklist
- [ ] Database restored and reachable using `DATABASE_URL`.
- [ ] `pnpm install --frozen-lockfile` succeeds on restored code state.
- [ ] Migrations are present and current (`lib/db/migrations`).
- [ ] API boots with required env vars (`validateEnv` passes).
- [ ] `/api/healthz` returns healthy.
- [ ] Auth login/logout works; protected endpoints reject unauthenticated requests.
- [ ] Org membership checks block cross-tenant org access.
- [ ] Stripe webhook endpoint accepts signed events and deduplicates replayed `event.id`.
- [ ] Audit logs endpoint returns recent entries.

## Recommended free / low-cost operating practice
- Keep **daily DB logical backup** (`pg_dump`) or managed snapshot with at least 7-day retention.
- Keep **weekly restore drill** on a non-production database using the latest backup.
- Record a simple restore log (date, backup point, restore success/failure, issues).
- Keep runtime secrets outside git and rotate on incident or suspected exposure.
- Keep this runbook and `docs/security-inventory-current-state.md` updated with real implementation state.

## Inferred
- Given Postgres-backed sessions and audit logs, DB recoverability is the primary security continuity dependency.
- Backup validation (restore drills) is more important than backup existence alone.

## Unclear
- Exact managed database provider backup retention and point-in-time restore settings are not defined in-repo.
- Whether automated restore-drill cadence is currently executed.

## Do not break
- Do not store secrets in git-backed files.
- Do not claim backup guarantees without a successful restore drill record.
- Do not bypass migrations when restoring to a new database instance.
