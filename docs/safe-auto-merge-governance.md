# 20 — Safe Auto-Merge Governance

## Scope
- Define the approved governance model for flowing Codex changes to `master` automatically with practical safety gates.
- Establish this repository’s default as solo-builder, low-friction, check-gated automation.

## Confirmed

### Purpose
- This repository intentionally uses safe automatic merge of Codex PRs to `master` after checks pass.
- The model is designed to keep delivery fast without destructive promotion behavior.

### Current approved workflow
- Codex opens a pull request from an in-repo branch matching `codex/*` to `master`.
- CI workflows run for that PR according to workflow path filters.
- `.github/workflows/codex-safe-auto-merge.yml` determines required checks from changed files and waits for successful completion on the PR head SHA.
- If all required checks succeed, the workflow merges the PR with normal merge behavior (`gh pr merge --squash --delete-branch`).
- No manual approval step is required in the default governance model.

### What is explicitly not allowed
- Force-reset promotion of `master`.
- Force-push overwrite of `master` from Codex branches.
- Destructive branch replacement workflows for Codex promotion.

### Required checks before auto-merge
- Safe auto-merge requires success of relevant checks for the PR head SHA, based on changed-file scope:
  - `Verify pnpm lockfile is up to date` (lockfile/install integrity scope).
  - `Backend build/typecheck/test/codegen validation` (backend regression scope).
  - `Run admin security shell tests` (admin shell scope).
- If any required check is missing, in progress, or failed, auto-merge must not occur.

### Why this model is used in this repo
- Repository operation is solo-builder and speed-first.
- CI checks are the safety gate while keeping normal Codex flow automatic.

### Future changes policy
- This governance model remains default unless the repository owner explicitly requests a change.
- Any future change must preserve non-destructive merge behavior and check-gated promotion to `master`.

### Instructions to agents/Codex not to suggest more bureaucratic governance by default
- Treat safe auto-merge after checks as the default approved model.
- Do not suggest manual-review-heavy or branch-protection-heavy governance unless explicitly requested by the user.
- Do not propose reintroducing force-reset/force-push promotion patterns.

## Inferred
- Workflow-driven check gating provides enough operational safety for this repository’s current solo-builder mode without adding manual review overhead.

## Unclear
- Whether long-term merge strategy should stay `squash` or move to another non-destructive strategy.

## Do not break
- Do not reintroduce force-reset or force-push promotion to `master`.
- Do not replace the default safe auto-merge model with manual-review-heavy governance unless explicitly requested by repository owner direction.
