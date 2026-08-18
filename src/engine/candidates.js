// Candidate resolution: which courses could satisfy a requirement group.
// Shared by the course-search UI filter and the auto-generate scheduler so
// there is exactly one interpretation of each rule type.
// Pure functions; no UI or storage imports.

import { isWrtgPwr } from './model.js';

export function matchesFilter(course, filter) {
  if (!course) return false;
  if (filter.depts && !filter.depts.includes(course.dept)) return false;
  if (filter.minNumber != null && course.number < filter.minNumber) return false;
  if (filter.maxNumber != null && course.number > filter.maxNumber) return false;
  if (filter.minCredits != null && course.credits < filter.minCredits) return false;
  if (filter.wOnly && !course.suffix.includes('W')) return false;
  if (filter.exclude && filter.exclude.includes(course.id)) return false;
  return true;
}

// All course ids that could count toward a program requirement group.
// For track_n_of pass {chosenTrack} to restrict to one track; for
// breadth_outside_track it excludes the chosen track's courses.
// Courses a rule NAMES outright, ignoring n_from_filter's broad category
// sweeps. "Any 4-credit BIOL course" is not the program depending on a
// specific course the way an all_of or n_of list is, so callers that need
// genuine dependency (the search rail's equivalency scoping) use this rather
// than groupCandidates, which would hand back half the catalog.
export function namedCandidates(group, data, opts = {}) {
  if (group?.rule?.type === 'n_from_filter') return [];
  return groupCandidates(group, data, opts);
}

export function groupCandidates(group, data, opts = {}) {
  const r = group.rule;
  if (!r) return [];
  if (r.type === 'all_of') return [...r.courses];
  if (r.type === 'n_of') return [...r.options];
  if (r.type === 'sequence_one_of') return r.sequences.flat();
  if (r.type === 'track_n_of') {
    if (opts.chosenTrack && r.tracks[opts.chosenTrack]) return [...r.tracks[opts.chosenTrack]];
    return Object.values(r.tracks).flat();
  }
  if (r.type === 'breadth_outside_track') {
    const core = (opts.program?.requirementGroups || []).find((x) => x.id === r.trackGroupId);
    const tracks = core?.rule?.tracks || {};
    const out = [];
    for (const [name, codes] of Object.entries(tracks)) {
      if (name === opts.chosenTrack) continue;
      out.push(...codes);
    }
    const chosen = new Set(opts.chosenTrack ? tracks[opts.chosenTrack] || [] : []);
    return [...new Set(out)].filter((c) => !chosen.has(c));
  }
  if (r.type === 'n_from_filter') {
    return Object.values(data.courses)
      .filter((c) => matchesFilter(c, r.filter))
      .map((c) => c.id);
  }
  return [];
}

// Course ids that could satisfy ONE cluster group (same single-code rule as
// clusterCandidates). fillCluster() fills each group from its own options, so
// the scheduler must reason per group too — the whole-cluster union would let
// it believe a group has spare capacity that its own option list doesn't have.
export function clusterGroupCandidates(group, policy) {
  const out = [];
  for (const opt of group.options) {
    if (opt.mode === 'all' && opt.codes.length > 1) continue;
    for (const code of opt.codes) if (!isWrtgPwr(policy, code)) out.push(code);
  }
  return [...new Set(out)];
}

// Course ids that could count toward a cluster (single-code options only;
// compound "X and Y" options are excluded here — the scheduler reports them
// as manual-placement suggestions instead of half-placing them).
export function clusterCandidates(cluster, data, policy) {
  const out = [];
  const compound = [];
  for (const g of cluster.groups) {
    for (const opt of g.options) {
      if (opt.mode === 'all' && opt.codes.length > 1) {
        compound.push(opt);
        continue;
      }
      for (const code of opt.codes) {
        if (!isWrtgPwr(policy, code)) out.push(code);
      }
    }
  }
  return { candidates: [...new Set(out)], compoundOptions: compound };
}
