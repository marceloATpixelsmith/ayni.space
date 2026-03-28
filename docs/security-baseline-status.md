# Security Baseline Status (Current SaaS MVP)

## Current baseline protections implemented
- Centralized API security middleware stack: security headers, CORS allowlist, CSRF token checks, and origin/referer checks.
- Session hardening baseline: Postgres-backed sessions (`platform.sessions`), secure/httpOnly cookie posture, idle + absolute timeout controls, canonical cookie-clearing/session-destruction helpers, and session rotation on org switch.
- Middleware-driven authorization and tenant checks (`requireAuth`, org/app access middleware) across protected routes.
- Turnstile on targeted high-risk public POST flows (org creation, invitation creation, invitation acceptance) with production-safe defaults.
- Rate limiting on auth/org/invitation/user/billing route groups with production-safe defaults.
- Stripe webhook signature verification + persistent replay deduplication (`stripe_webhook_events` keyed by event id).
- Audit logging for key security-relevant writes (auth failures, login/user creation, org/member mutations, invitation flows, subscription webhook mutations, super-admin feature/app access changes).
- Free CI security baseline: lockfile integrity check, backend regression gates, dependency vulnerability scan, secret scan, and CodeQL.

## Important current limitations
- Rate limiting is still in-memory per process (not distributed; resets on process restart).
- Edge/WAF/bot/firewall controls are still provider-side/out-of-repo and must be managed manually.
- Turnstile and rate limiting can still be disabled by explicit production override env flags (intentional break-glass behavior).
- Session anomaly handling is observational (audit signal) and does not enforce risk-based step-up auth.
- Restore drills are manual and currently template-driven in-repo; evidence depends on maintaining real dated entries.

## What is intentionally out of scope
- MFA and adaptive/risk-based authentication.
- Distributed infra additions (e.g., Redis-based shared rate limiting).
- Paid security tooling/SOC/managed enterprise control planes.
- Major auth/session architecture redesign.

## Required manual operational habits
- Keep production env vars secure and verify no accidental insecure toggles before deploy.
- Run and log restore drills on a regular cadence in `docs/security-restore-drill-log.md`.
- Rotate secrets on suspicion/exposure and verify old credentials are invalidated.
- Review CI security alerts (dependency, secrets, CodeQL) and close high-severity findings promptly.
- Keep security docs in sync with real code/config behavior; do not claim controls that are not implemented.

## Next upgrades only if/when scale justifies them
- Move from in-memory rate limiting to shared/persistent limiter store.
- Codify edge baseline controls (WAF/rate-limit/firewall) in provider config artifacts where possible.
- Add targeted risk-based session controls for sensitive account actions.
- Expand automated security regression tests around privileged writes and webhook failure paths.
