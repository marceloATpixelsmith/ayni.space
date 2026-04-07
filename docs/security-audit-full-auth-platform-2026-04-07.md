1. CURRENT MASTER CONFIRMATION
- Audited the latest available repository HEAD in this environment on 2026-04-07 (branch `audit/full-auth-security-2026-04-07`). No code changes were made to runtime behavior; this document records findings.

2. OVERALL SECURITY RATING
- significant risks present

3. CRITICAL VULNERABILITIES (IF ANY)
- None confirmed at critical severity from code review.

4. HIGH PRIORITY RISKS
- title: Rate limiting can be bypassed and does not scale across instances
  - severity (critical/high): high
  - exact file(s):
    - `apps/api-server/src/middlewares/rateLimit.ts`
    - `apps/api-server/src/lib/authAbuse.ts`
  - exact issue:
    - Limiting state is in-memory (`Map`) and therefore per-process only; it resets on restart and does not synchronize across horizontal instances.
    - Client identity trusts `x-forwarded-for` directly, allowing header spoofing in deployments where upstream does not fully sanitize that header.
  - real-world exploit scenario:
    - An attacker rotates spoofed `x-forwarded-for` values and bypasses per-IP limits on login/signup/MFA endpoints, increasing brute-force and credential-stuffing throughput.

- title: Signup endpoint leaks account existence by status-code behavior
  - severity (critical/high): high
  - exact file(s):
    - `apps/api-server/src/routes/auth.ts`
  - exact issue:
    - Signup returns `409` when password credential already exists for the email, while successful fresh signup returns `201`.
  - real-world exploit scenario:
    - Attackers enumerate valid emails by comparing signup responses at scale.

- title: Invitation plaintext token is returned in API responses after creation/resend
  - severity (critical/high): high
  - exact file(s):
    - `apps/api-server/src/routes/invitations.ts`
  - exact issue:
    - The raw invitation token is returned in JSON response fields (`invitationToken`) for create/resend operations.
  - real-world exploit scenario:
    - Any compromised browser context, extension, frontend logging pipeline, or reverse-proxy access log that captures response bodies can leak active invite links before recipients use them.

- title: Database TLS trust validation is disabled
  - severity (critical/high): high
  - exact file(s):
    - `lib/db/src/index.ts`
  - exact issue:
    - PostgreSQL SSL uses `rejectUnauthorized: false`.
  - real-world exploit scenario:
    - In a network-path compromise, certificate validation is weakened, increasing MITM risk for DB traffic.

5. MEDIUM / HARDENING ITEMS
- Password hashing uses scrypt with explicit params and per-password salt; however, no adaptive runtime tuning/benchmarking guard is present to ensure cost remains strong as hardware changes.
- CSRF design is generally strong (session-bound token + origin/referrer checks), but several webhook/path exemptions are path-regex based and should remain tightly controlled and regression-tested.
- CSP contains `'unsafe-inline'` for script/style in API headers; this is a deliberate compatibility tradeoff but weaker than strict nonce/hash CSP.
- Some endpoints rely on ad-hoc validation rather than centralized schema validation middleware.
- `isMfaRequiredForUser` includes a fail-open branch for org-role read outages (`catch` returns no role-derived requirement), reducing security during partial DB read failures.
- Turnstile is intentionally bypassed for certain possession-based flows (verify-email, invitation accept-email, MFA challenge/recovery). This is reasonable but should be monitored against abuse telemetry.

6. WHAT IS DONE WELL
- Session fixation mitigated via `req.session.regenerate()` on password auth establishment, MFA pending-session establishment, and OAuth callback login path.
- Email verification is enforced for password login before full session establishment.
- Password reset invalidates other sessions and clears current session/trusted-device state.
- OAuth state includes structured payload and callback validation to fail closed on mismatch/malformed state.
- MFA implementation includes encrypted TOTP secret storage (AES-256-GCM), replay prevention for TOTP time-steps, hashed recovery codes, and one-time recovery code consumption.
- Session hardening includes absolute timeout enforcement, rolling idle timeout, httpOnly cookies, secure cookies in production, and group-scoped session cookie isolation.
- CSRF + origin/referrer protections are globally mounted before API routes.
- Authorization layering is explicit (`requireAuth`, `requireOrgAccess`, `requireOrgAdmin`, `requireAppAccess`, `requireSuperAdmin`) with org/session-group compatibility checks.

7. TEST COVERAGE GAPS
- Coverage is strong for session-group isolation, CSRF/cookie behaviors, and key auth security regressions; however, there is no evidence of tests validating distributed rate-limit behavior (multi-instance realities).
- No test evidence for account-enumeration resistance on signup response uniformity.
- No explicit tests asserting invitation token is never returned to frontend clients.
- No tests asserting strict DB TLS verification posture.
- No broad negative tests that enforce schema validation on every public auth endpoint input field.

8. DB / SECRET STORAGE ASSESSMENT
- Correct:
  - Passwords are stored as scrypt-derived hashes.
  - Email verification/password reset tokens are stored hashed.
  - Invitation tokens are stored hashed.
  - MFA TOTP secrets are encrypted at rest with AES-256-GCM fields.
  - MFA recovery codes and trusted-device tokens are stored hashed.
- Needs improvement:
  - DB transport configuration weakens certificate verification (`rejectUnauthorized: false`).
  - Legacy nullable `users.passwordHash` column coexists with `user_credentials.password_hash`; this duality should be carefully managed to avoid accidental insecure usage regressions.

9. MINIMUM HARDENING PLAN
- PR 1: Auth abuse controls
  - Replace in-memory limiters with shared store (Redis/Postgres-backed sliding window/leaky bucket), enforce trusted proxy strategy, and key on both IP and normalized account identifier.
  - Add regression tests for spoofed `x-forwarded-for` handling and multi-instance semantics.
- PR 2: Enumeration and invitation-token exposure
  - Normalize signup responses to prevent account discovery.
  - Remove plaintext `invitationToken` from create/resend API responses; keep token only in outbound email channel and privileged internal audit metadata (hashed where practical).
  - Add tests guaranteeing no raw invitation token in API response bodies.
- PR 3: Transport/config hardening
  - Enable CA-validated DB TLS (`rejectUnauthorized: true` with provider CA config).
  - Add deployment/startup assertions for TLS mode and include security test that fails on insecure DB client config.

10. FINAL GO/NO-GO
- NO
- Explanation:
  - Core auth/session/MFA architecture is solid, but current high-severity items (rate-limit bypass/scalability, account enumeration, plaintext invitation-token API exposure, and DB TLS trust posture) make production deployment risky without a short hardening pass.
