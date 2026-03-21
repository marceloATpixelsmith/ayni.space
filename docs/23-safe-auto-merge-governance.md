# 20 — Retired Safe Auto-Merge Governance (Historical)

## Scope
- Preserve historical context for the previously considered safe auto-merge governance topic.
- Clarify that this document is **not** the active deployment governance source.

## Confirmed
- As of this revision, normal deployment behavior is **direct push-to-`master`** and optional manual `workflow_dispatch` in deploy workflows.
- PR auto-merge promotion is **retired** and is not part of current CI/CD execution.
- Active governance lives in:
  - `docs/ci-cd-and-deploy-rules.md`
  - `docs/ci-cd-and-deploy-chart.md`
  - `.github/workflows/admin-security-shell-test-and-deploy.yml`
  - `.github/workflows/backend-regression-gates.yml`

## Historical note
- Earlier planning discussed a “safe auto-merge” governance track for PR promotion.
- That track is retained only as historical context and should not be treated as active behavior.

## Inferred
- Keeping this retired document avoids ambiguity when older references appear in commit history or external notes.

## Unclear
- Whether this historical page should be deleted entirely after downstream references are cleaned up.

## Do not break
- Do not interpret this file as active operational policy.
- Do not reintroduce PR-promotion deployment automation based on this retired document.
