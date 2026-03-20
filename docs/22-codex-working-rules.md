# 22 — Codex Working Rules (Architecture Docs)

## Scope
- This document defines architecture constraints for its domain using `docs/01-monorepo-overview.md` as baseline and concrete repository paths as evidence.

## Confirmed
- `docs/01-monorepo-overview.md` is the authoritative architecture baseline for this doc set.
- Non-negotiable invariants from `01-monorepo-overview.md` must be preserved:
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
- Do not edit architecture docs to contradict `01-monorepo-overview.md`.
- Do not invent components, services, or enforcement boundaries not present in overview/code.
- Do not present inferred behavior as confirmed behavior.
- Do not resolve unclear areas by assumption; carry them forward explicitly as open questions.
