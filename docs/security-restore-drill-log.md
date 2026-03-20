# Security Restore Drill Log

Use this file as a simple running log for manual restore drills.

## How to use
1. Run a restore drill using `docs/security-backup-and-restore.md`.
2. Copy the template block below.
3. Paste it at the top of `Entries` and fill it in.
4. Keep notes short and practical.

---

## Entry Template

```md
### Drill Date
- Date: YYYY-MM-DD
- Environment: dev | staging | prod-like non-production
- Trigger: scheduled cadence | post-incident | major migration check | other

### What was tested
- [ ] Full DB restore
- [ ] Partial/table-level restore
- [ ] Config/env recovery
- [ ] App boot + health check
- [ ] Auth/session validation
- [ ] Tenant/access validation
- [ ] Webhook flow sanity check
- [ ] Audit log visibility check

### Steps followed
- Runbook reference: `docs/security-backup-and-restore.md`
- Commands / steps executed:
  - step 1
  - step 2
  - step 3

### Result
- Status: success | partial | failed
- Rough time to recover (TTR): __ minutes

### Issues found
- issue 1
- issue 2

### Follow-up actions
- [ ] action 1 (owner: ___, target date: YYYY-MM-DD)
- [ ] action 2 (owner: ___, target date: YYYY-MM-DD)
```

---

## Entries

### Drill Date
- Date: YYYY-MM-DD
- Environment: 
- Trigger: 

### What was tested
- [ ] Full DB restore
- [ ] Partial/table-level restore
- [ ] Config/env recovery
- [ ] App boot + health check
- [ ] Auth/session validation
- [ ] Tenant/access validation
- [ ] Webhook flow sanity check
- [ ] Audit log visibility check

### Steps followed
- Runbook reference: `docs/security-backup-and-restore.md`
- Commands / steps executed:
  - 

### Result
- Status: 
- Rough time to recover (TTR): 

### Issues found
- 

### Follow-up actions
- [ ] 
