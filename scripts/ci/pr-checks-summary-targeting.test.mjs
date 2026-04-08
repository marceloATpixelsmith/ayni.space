import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingTrackedChecks, selectLatestTrackedRuns } from './pr-checks-summary-targeting.mjs';

test('selectLatestTrackedRuns keeps only allowlisted checks and excludes summary check', () => {
  const tracked = selectLatestTrackedRuns({
    checkRuns: [
      { id: 1, name: 'backend-gates', status: 'completed', conclusion: 'success', started_at: '2026-04-08T10:00:00Z' },
      { id: 2, name: 'deploy-preview', status: 'in_progress', conclusion: null, started_at: '2026-04-08T10:00:01Z' },
      { id: 3, name: 'pr-checks-summary', status: 'in_progress', conclusion: null, started_at: '2026-04-08T10:00:02Z' },
    ],
    allowlist: ['backend-gates', 'deploy-preview', 'pr-checks-summary'],
    summaryCheckName: 'pr-checks-summary',
    headSha: '',
  });

  assert.deepEqual(tracked.map((c) => c.name), ['backend-gates', 'deploy-preview']);
});

test('selectLatestTrackedRuns de-duplicates by check name using newest run', () => {
  const tracked = selectLatestTrackedRuns({
    checkRuns: [
      { id: 11, name: 'backend-gates', status: 'in_progress', conclusion: null, started_at: '2026-04-08T10:00:00Z' },
      { id: 12, name: 'backend-gates', status: 'completed', conclusion: 'success', started_at: '2026-04-08T10:10:00Z' },
    ],
    allowlist: ['backend-gates'],
    summaryCheckName: 'pr-checks-summary',
    headSha: '',
  });

  assert.equal(tracked[0].status, 'completed');
  assert.equal(tracked[0].conclusion, 'success');
});

test('trackedNames forces deterministic target set and flags missing checks as unknown', () => {
  const tracked = selectLatestTrackedRuns({
    checkRuns: [{ id: 20, name: 'backend-gates', status: 'completed', conclusion: 'success' }],
    allowlist: ['backend-gates', 'check'],
    summaryCheckName: 'pr-checks-summary',
    headSha: '',
    trackedNames: ['backend-gates', 'check'],
  });

  assert.deepEqual(
    tracked.map((c) => ({ name: c.name, status: c.status })),
    [
      { name: 'backend-gates', status: 'completed' },
      { name: 'check', status: 'unknown' },
    ],
  );
  assert.equal(pendingTrackedChecks(tracked).length, 1);
});
