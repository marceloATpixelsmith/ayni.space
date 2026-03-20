# 11 — Open Questions and Conflicts

## Scope
- Track unresolved architecture questions and known drift areas while preserving `01` as source of truth.

## Confirmed conflicts/drift
- Workspace config includes `lib/integrations/*` while directory is absent (`pnpm-workspace.yaml` vs missing `lib/integrations/`).
- `lib/*` is heavily active while many `packages/*` remain dormant (see imports/usage inventory in `docs/01-monorepo-overview.md`).
- Placeholder apps (`apps/ayni`, `apps/shipibo`, `apps/screening`) exist without implementation (`.gitkeep` only).

## Inferred
- Current ambiguity is mostly roadmap/governance ambiguity, not conflicting active runtime ownership.

## Unclear
- Should `apps/mockup-sandbox` be promoted, archived, or removed?
- Should dormant `packages/*` be activated, consolidated, or removed?
- Should `lib/integrations/*` be implemented now or removed from workspace globs?
- Is codex auto-promote force-reset behavior still desired governance?

## Do not break
- Do not “resolve” unknowns by inventing architecture not in code/overview.
- Do not convert inferred statements into confirmed statements without code evidence.
- Do not remove open questions that are still unresolved in implementation.
