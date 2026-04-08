export function selectLatestTrackedRuns({ checkRuns, allowlist, summaryCheckName, headSha, trackedNames = null }) {
  const allow = new Set((allowlist || []).filter(Boolean));
  const scoped = (checkRuns || []).filter((run) => {
    if (!run || !run.name) return false;
    if (run.name === summaryCheckName) return false;
    if (!allow.has(run.name)) return false;
    if (headSha && run.head_sha && run.head_sha !== headSha) return false;
    return true;
  });

  const latestByName = new Map();
  for (const run of scoped) {
    const prev = latestByName.get(run.name);
    if (!prev || isRunNewer(run, prev)) {
      latestByName.set(run.name, run);
    }
  }

  const orderedNames = trackedNames && trackedNames.length
    ? trackedNames
    : allowlist.filter((name) => latestByName.has(name));

  return orderedNames.map((name) => {
    const run = latestByName.get(name);
    if (!run) {
      return {
        name,
        status: 'unknown',
        conclusion: 'null',
        html_url: '',
        details_url: '',
      };
    }

    return {
      name,
      status: run.status || 'unknown',
      conclusion: run.conclusion ?? 'null',
      html_url: run.html_url || '',
      details_url: run.details_url || '',
    };
  });
}

function isRunNewer(a, b) {
  const aTs = Date.parse(a.started_at || a.completed_at || a.created_at || 0) || 0;
  const bTs = Date.parse(b.started_at || b.completed_at || b.created_at || 0) || 0;
  if (aTs !== bTs) return aTs > bTs;
  return (a.id || 0) > (b.id || 0);
}

export function pendingTrackedChecks(tracked) {
  return tracked.filter((check) => check.status !== 'completed');
}
