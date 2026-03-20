# Security Incident Response (Lightweight Runbook)

## Purpose
- Provide a practical, low-friction response playbook for security incidents affecting this monorepo and deployed apps.
- Prioritize fast containment, evidence preservation, safe recovery, and a short learning loop for a solo-builder workflow.

## What counts as a security incident here
Treat any of the following as an incident:
- Confirmed or suspected account compromise (admin/super-admin, GitHub, cloud, database, Stripe, Google OAuth).
- Confirmed or suspected secret exposure (API keys, OAuth secrets, session secret, webhook secrets).
- Unauthorized data access, cross-tenant access, data exfiltration, or privilege escalation.
- Malicious code/config changes merged or deployed.
- Critical security workflow alert with credible exploitability (CodeQL high/critical, secret scan hit, active dependency exploit).
- Service abuse causing security impact (credential stuffing, invitation abuse, webhook replay abuse beyond safeguards).

## First-response checklist (first 15–30 minutes)
- [ ] Confirm incident scope quickly: what happened, when, and which systems are affected.
- [ ] Freeze risky changes: pause non-essential deploys and merges until containment actions are done.
- [ ] Capture evidence before cleanup:
  - failing/suspicious workflow runs,
  - API/server logs and correlation IDs,
  - audit-log records,
  - provider security alerts.
- [ ] Start an incident note (single markdown/log entry): timeline, actions, and decisions with UTC timestamps.
- [ ] Classify severity:
  - High: confirmed unauthorized access or secret compromise.
  - Medium: credible suspicious activity without confirmed impact.
  - Low: false-positive-prone signal with no corroborating evidence.

## Where to look first
- GitHub:
  - Actions runs (`.github/workflows/*`), especially `secret-scan`, dependency scan, and CodeQL.
  - Repository security alerts (Dependabot / code scanning alerts).
  - Organization/repository audit log for suspicious auth/token/repo events.
- Application/backend:
  - API logs (auth failures, unusual 4xx/5xx spikes, suspicious request patterns).
  - Correlation IDs and error telemetry from observability pipeline.
  - Audit log endpoints/data (`apps/api-server/src/routes/audit.ts`, admin global audit views).
- Providers:
  - Hosting/platform logs and access events.
  - Database connection/activity logs and recent schema/data changes.
  - OAuth provider console (Google) for abnormal consent/client events.
  - Billing/webhook provider dashboards (Stripe event anomalies/replays).

## Secret rotation checklist
When exposure is confirmed or reasonably suspected:
- [ ] Rotate `SESSION_SECRET` and force session invalidation strategy as needed.
- [ ] Rotate OAuth and provider credentials (Google client secret, Stripe webhook/API secrets, deployment tokens).
- [ ] Rotate database credentials / connection secrets.
- [ ] Revoke and recreate GitHub personal access tokens, bot tokens, and CI/deploy secrets.
- [ ] Update secrets in runtime environments and CI, then redeploy safely.
- [ ] Verify old secrets no longer work.
- [ ] Record rotation completion timestamps and owners in incident notes.

## Containment checklist
- [ ] Disable or throttle affected entry points (temporarily tighten rate limits / feature flags where possible).
- [ ] Block known malicious principals (accounts, tokens, IP ranges if available at edge/provider).
- [ ] Revoke compromised sessions/accounts and require re-authentication.
- [ ] Temporarily disable risky automations only if needed (keep core CI checks intact when possible).
- [ ] If malicious code was merged, revert to last known-good commit and redeploy.
- [ ] Preserve forensic evidence (logs, workflow artifacts, commit SHAs, alert snapshots).

## Restore and recovery checklist
- [ ] Confirm containment is effective (no continuing malicious activity).
- [ ] Restore service from known-good code/config state.
- [ ] Validate security-critical flows after restoration:
  - auth login/logout,
  - CSRF/session behavior,
  - tenant/org access checks,
  - webhook handling/idempotency,
  - audit log visibility.
- [ ] Re-enable paused workflows/deploy paths once clean state is confirmed.
- [ ] If recovery involved DB/state restoration, record the drill/outcome in `docs/security-restore-drill-log.md`.
- [ ] Monitor closely for 24–72 hours for recurrence indicators.

## Post-incident follow-up checklist
- [ ] Publish short post-incident summary (what happened, impact, timeline, fixes).
- [ ] Add one or two concrete prevention tasks to backlog (avoid broad enterprise process overhead).
- [ ] Update `docs/security-inventory-current-state.md` if control status changed.
- [ ] Update `docs/security-baseline-status.md` if baseline protections/limitations changed.
- [ ] If backup/restore gaps were found, update `docs/security-backup-and-restore.md` cadence guidance and log follow-up in `docs/security-restore-drill-log.md`.
- [ ] Add/update targeted tests or CI checks for the exploited failure mode.
- [ ] Close incident only after verifying controls are active in repo/config.

## Security toggle checks during containment/recovery
- [ ] Confirm production has not unintentionally disabled `RATE_LIMIT_ENABLED` without explicit `RATE_LIMIT_ALLOW_DISABLE_IN_PRODUCTION=true`.
- [ ] Confirm production has not unintentionally disabled `TURNSTILE_ENABLED` without explicit `TURNSTILE_ALLOW_DISABLE_IN_PRODUCTION=true`.

## Manual vs automated today
### Automated today (repo evidence)
- CI dependency vulnerability scan workflow.
- CI secret scanning workflow.
- Backend regression gates and lockfile integrity checks.
- CodeQL SAST workflow (after this pass).

### Manual today
- Incident triage and severity decision.
- Provider-side account/session/token revocation actions.
- Edge/firewall emergency rules (outside this repo unless separately codified).
- Recovery decision-making and post-incident write-up.
- Secret rotation execution and verification across all environments.
- Periodic restore-drill execution cadence (manual by design).

## Notes
- This runbook intentionally stays lightweight for solo-builder velocity.
- It does **not** claim 24/7 SOC, pager rotation, or enterprise IR tooling.
