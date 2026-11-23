// What-if audits and "closest to finishing" suggestions.
//
// Both run the real engine (computeProgress / checkClusterRules) on a
// hypothetical copy of the plan, so the numbers match what the audit would
// show if the student actually picked the program. The student's plan is
// never changed.
//
// Pure functions; no UI or storage imports.

import { computeProgress } from './progress.js';
import { checkClusterRules } from './constraints.js';

// Cluster groups can be counted in credits; turn those into an approximate
// course count so programs and clusters rank on the same scale.
function remainingInGroup(g) {
  const short = Math.max(0, g.need - Math.min(g.have, g.need));
  return g.unit === 'credits' ? Math.ceil(short / 4) : short;
}

function summarize(result) {
  const groups = (result.groups || []).filter((g) => !g.isULW);
  const remaining = groups.reduce((a, g) => a + remainingInGroup(g), 0);
  const counted = new Set(groups.flatMap((g) => g.satisfiedBy || []));
  return {
    percent: result.percent,
    complete: !!result.complete,
    remaining,
    groupsDone: groups.filter((g) => g.complete).length,
    groupsTotal: groups.length,
    countedCourseIds: [...counted],
  };
}

// The plan the student would have with `programId` swapped in.
//   mode 'replace': the program replaces the current majors (for a major) or
//                   minors (for a minor) - "what if I switched?"
//   mode 'add':     the program is added alongside them - "what if I added it?"
// Overlap caps and cluster sharing then apply exactly as in the real audit.
export function whatIfPlan(plan, program, mode = 'replace') {
  const key = program.type === 'minor' ? 'minorIds' : 'majorIds';
  const current = (plan[key] || []).filter((id) => id !== program.id);
  const ids = mode === 'add' ? [...current, program.id] : [program.id];
  return { ...plan, [key]: ids };
}

// Progress in another program, computed against the student's courses.
// Returns null for an unknown id. needsData programs come back flagged.
export function whatIfProgress(plan, data, programId, mode = 'replace') {
  const program = data.programs.find((p) => p.id === programId);
  if (!program) return null;
  const hypo = whatIfPlan(plan, program, mode);
  const progress = computeProgress(hypo, data);
  const result = progress.programs.find((r) => r.programId === programId);
  if (!result || result.needsData) {
    return { program, mode, needsData: true, result: result || null };
  }
  return { program, mode, needsData: false, result, ...summarize(result) };
}

// Minors (or majors) not on the plan, ranked by how few courses remain when
// added to the current plan. Only programs the plan already makes progress in
// are returned.
// Minors in the same department as a declared major are skipped (a CS minor
// next to a CS major isn't a real option).
export function closestPrograms(plan, data, { type = 'minor', limit = 5 } = {}) {
  const taken = new Set([...(plan.majorIds || []), ...(plan.minorIds || [])]);
  const majorDepts = new Set((plan.majorIds || [])
    .flatMap((id) => data.programs.find((p) => p.id === id)?.departments || []));
  const out = [];
  for (const program of data.programs) {
    if (program.type !== type || program.status !== 'ACTIVE' || taken.has(program.id)) continue;
    if (type === 'minor' && (program.departments || []).some((d) => majorDepts.has(d))) continue;
    const r = whatIfProgress(plan, data, program.id, 'add');
    if (!r || r.needsData || r.countedCourseIds.length === 0) continue;
    out.push(r);
  }
  return rank(out).slice(0, limit);
}

// Clusters not on the plan, ranked the same way. A cluster that the current
// majors make ineligible (its division, or the major's own department) is
// left out, using the same rule checks the audit runs.
export function closestClusters(plan, data, { limit = 5 } = {}) {
  const taken = new Set(plan.clusterIds || []);
  const out = [];
  for (const cluster of data.clusters) {
    if (cluster.status !== 'ACTIVE' || taken.has(cluster.id)) continue;
    const hypo = { ...plan, clusterIds: [...(plan.clusterIds || []), cluster.id] };
    const progress = computeProgress(hypo, data);
    const result = progress.clusters.find((r) => r.clusterId === cluster.id);
    if (!result || result.usedCourseIds.size === 0) continue;
    const blocked = checkClusterRules(hypo, data, progress).some((v) => (
      v.severity === 'error'
      && (v.ruleId === 'CLUSTER_DIVISION' || v.ruleId === 'CLUSTER_OWN_DEPT')
      && v.clusterId === cluster.id
    ));
    if (blocked) continue;
    out.push({ cluster, result, ...summarize(result) });
  }
  return rank(out).slice(0, limit);
}

function rank(list) {
  return list.sort((a, b) => (
    a.remaining - b.remaining
    || b.percent - a.percent
    || (a.program?.name || a.cluster?.name || '').localeCompare(b.program?.name || b.cluster?.name || '')
  ));
}
