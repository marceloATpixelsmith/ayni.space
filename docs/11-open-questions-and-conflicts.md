# 11 — Open Questions, Uncertainty, and Conflicts (DRAFT)

## Confirmed conflicts/drift observed in repository
1. **Role vocabulary drift**
   - Runtime code uses `org_owner/org_admin/staff`.
   - Docs and comments in places mention `owner/admin/member/viewer`.
2. **Multiple frontend tracks**
   - Active admin SPA (`apps/admin`) vs separate Next.js app (`frontend`) with placeholder auth pages.
3. **Package boundary drift**
   - Most working shared code in `lib/*`; many `packages/*` are empty placeholders.
4. **Observability maturity mismatch**
   - Strong Sentry plumbing exists, but logging remains mostly ad hoc `console.*`.
5. **OpenTelemetry ambiguity**
   - Local package named `@opentelemetry/instrumentation-http` is a no-op implementation.
6. **Potential policy/document mismatch**
   - README/portability docs include claims that may not exactly match current code paths or naming.
7. **Schema/type generation hygiene**
   - Some schema files appear to reference `z.infer` without importing `z`, indicating possible typecheck drift in rarely-built paths.

## High-priority clarification questions
1. Which frontend is canonical for near-term roadmap: `apps/admin`, `frontend`, or both?
2. What is the canonical org role taxonomy and precedence model?
3. What are the exact access rules for each `tenancy_mode` (`none`, `organization`, `solo`) per app?
4. Is app-level access (`user_app_access`) required in addition to org membership for all org apps, or only restricted ones?
5. Should all app data endpoints enforce org membership against supplied `orgId` even when `requireAppAccess` passes?
6. Are empty `packages/*` intentional stubs for future extraction, or technical debt to remove?
7. Is the codex auto-promote force-push workflow still an approved governance mechanism?
8. Are there required staging/test environments and migration gates not represented in current CI?

## Areas to verify before converting these drafts into permanent architecture docs
- End-to-end auth redirect behavior and origin assumptions across environments.
- Security controls coverage map (which routes have CSRF/origin/rate-limit/turnstile and why).
- Intended ownership boundaries for platform vs app-specific data and services.
- Contract/source-of-truth policy among OpenAPI, DB schema, `packages/types`, and runtime middleware.
