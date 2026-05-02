# 17 — Codex Working Rules (Architecture Docs)

## Scope
- This document defines architecture constraints for its domain using `docs/monorepo-overview.md` as baseline and concrete repository paths as evidence.

## Confirmed
- `docs/monorepo-overview.md` is the authoritative architecture baseline for this doc set.
- Non-negotiable invariants from `monorepo-overview.md` must be preserved:
  - centralized API runtime entry (`apps/api-server/src/index.ts`, `apps/api-server/src/app.ts`, `apps/api-server/src/routes/index.ts`),
  - middleware-driven auth/authz,
  - shared frontend security/observability use in admin,
  - DB access via `@workspace/db`,
  - root lockfile integrity (`pnpm-lock.yaml`).

## Inferred
- Architecture docs should be maintained as implementation-aligned inventory documents, not speculative redesign docs.
- When ambiguity exists, documenting it as an open question is safer than introducing guessed architecture.

## Unclear
- Ownership process for approving architectural intent changes not yet reflected in code.
- The exact transition plan for dormant or placeholder surfaces.

## Do not break
- Do not edit architecture docs to contradict `monorepo-overview.md`.
- Do not invent components, services, or enforcement boundaries not present in overview/code.
- Do not present inferred behavior as confirmed behavior.
- Do not resolve unclear areas by assumption; carry them forward explicitly as open questions.

## Documentation maintenance policy (mandatory)
- Any change to architecture, auth, routing, runtime settings, env contracts, migrations, platform behavior, security behavior, or operator workflows is incomplete until relevant docs are updated in the same PR.
- Documentation updates must remove or rewrite stale wording when behavior changes; appending new text without resolving contradictions is not acceptable.
- Keep code, migrations, `.env.example`, architecture docs, security docs, and operator-facing docs mutually consistent.
- Material subsystem changes require a dedicated source-of-truth document when one does not already exist.
- Final change summaries must include a `DOCS UPDATED` section listing each updated documentation file and why it changed.


### AUTH freeze guardrail (current phase)
- AUTH is frozen/protected for this phase unless a task explicitly says AUTH work is required.
- During unrelated work, do not modify AUTH-critical files or behavior (redirects, MFA, session groups, CSRF, Turnstile, app-context resolution, login/signup routing, invitation auth flow, post-auth continuation).
- AUTH-critical file groups include:
  - `apps/api-server/src/routes/auth.ts`
  - `apps/api-server/src/middlewares/requireAuth.ts`
  - `apps/api-server/src/middlewares/csrf.ts`
  - `apps/api-server/src/middlewares/turnstile.ts`
  - `apps/api-server/src/lib/auth*.ts`, `apps/api-server/src/lib/session*.ts`, `apps/api-server/src/lib/mfa.ts`, `apps/api-server/src/lib/postAuth*.ts`
  - `lib/frontend-security/**`, `lib/api-client-react/src/custom-fetch.ts`, `lib/auth-ui/**`, `apps/admin/src/pages/auth/**`
  - auth/security regression tests and auth-related workflow/docs
- If AUTH changes are explicitly requested, update docs + tests in the same PR and preserve `pnpm run test:auth-security-regression` (workflow `Auth Security Regression Suite`, check `auth-security-regression-suite`).
- Protected-file automation: `.github/workflows/auth-freeze-guard.yml` blocks PRs that touch AUTH-critical paths unless PR body includes `AUTH-CHANGE-APPROVED`.
