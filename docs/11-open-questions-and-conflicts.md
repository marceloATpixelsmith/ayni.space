# 11 — Open Questions, Uncertainty, and Conflicts (DRAFT)

## Confirmed conflicts/drift observed in repository
1. **Role vocabulary drift**
   - Runtime code uses `org_owner/org_admin/staff`.
   - Docs and comments in places mention `owner/admin/member/viewer`.
2. **Package boundary drift**
   - Most working shared code in `lib/*`; many `packages/*` are empty placeholders.
3. **Observability maturity mismatch**
   - Strong Sentry plumbing exists, but logging remains mostly ad hoc `console.*`.
4. **OpenTelemetry ambiguity**
   - Local package named `@opentelemetry/instrumentation-http` is a no-op implementation.
5. **Potential policy/document mismatch**
   - README/portability docs include claims that may not exactly match current code paths or naming.
6. **Schema/type generation hygiene**
   - Some schema files appear to reference `z.infer` without importing `z`, indicating possible typecheck drift in rarely-built paths.

## High-priority clarification questions
1. What is the canonical org role taxonomy and precedence model?
2. What are the exact access rules for each `tenancy_mode` (`none`, `organization`, `solo`) per app?
3. Is app-level access (`user_app_access`) required in addition to org membership for all org apps, or only restricted ones?
4. Should all app data endpoints enforce org membership against supplied `orgId` even when `requireAppAccess` passes?
5. Are empty `packages/*` intentional stubs for future extraction, or technical debt to remove?
6. Is the codex auto-promote force-push workflow still an approved governance mechanism?
7. Are there required staging/test environments and migration gates not represented in current CI?

## Areas to verify before converting these drafts into permanent architecture docs
- End-to-end auth redirect behavior and origin assumptions across environments.
- Security controls coverage map (which routes have CSRF/origin/rate-limit/turnstile and why).
- Intended ownership boundaries for platform vs app-specific data and services.
- Contract/source-of-truth policy among OpenAPI, DB schema, `packages/types`, and runtime middleware.
