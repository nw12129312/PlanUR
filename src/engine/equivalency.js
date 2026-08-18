// Equivalency groups: "A instead of B" alternatives (never "A before B").
// A group is a set of paths; a plan may follow at most one path per group.
// The group's satisfiesPrereqLevel tag is fulfilled once the terminal course
// of any single path is completed — one fulfillment per group, regardless of
// path, never stacked.
// Pure functions; no UI or storage imports.

import { plannedCourseIds } from './model.js';

export const activeGroups = (equivalencyGroups) =>
  (equivalencyGroups || []).filter((g) => g.status === 'ACTIVE' && g.paths.length > 0);

// [{group, paths}] — every active group containing courseId, with the paths
// inside it that contain the course.
export function groupsForCourse(equivalencyGroups, courseId) {
  const out = [];
  for (const g of activeGroups(equivalencyGroups)) {
    const paths = g.paths.filter((p) => p.courses.includes(courseId));
    if (paths.length) out.push({ group: g, paths });
  }
  return out;
}

// Active groups that a given set of course ids actually touches.
//
// The search rail uses this to scope the "choose one path" block to the
// student's own programs. Without it the rail filtered by search RESULTS, so
// the first 400 catalog courses always contained MATH 141 and every plan was
// shown the calculus sequence regardless of what it had selected.
export function groupsForCourseSet(equivalencyGroups, courseIdSet) {
  if (!courseIdSet || courseIdSet.size === 0) return [];
  return activeGroups(equivalencyGroups)
    .filter((g) => g.paths.some((p) => p.courses.some((c) => courseIdSet.has(c))));
}

// Which paths of a group are still consistent with a set of course ids.
// All paths when nothing from the group is present; empty set = conflict.
export function consistentPaths(group, courseIdSet) {
  const present = group.paths
    .flatMap((p) => p.courses)
    .filter((c, i, arr) => arr.indexOf(c) === i)
    .filter((c) => courseIdSet.has(c));
  if (!present.length) return new Set(group.paths.map((p) => p.id));
  return new Set(
    group.paths.filter((p) => present.every((c) => p.courses.includes(c))).map((p) => p.id),
  );
}

// Violations: one per conflicting course so each card surfaces it inline.
export function checkEquivalencyConflicts(plan, equivalencyGroups) {
  const placed = new Set(plannedCourseIds(plan));
  const out = [];
  for (const g of activeGroups(equivalencyGroups)) {
    if (consistentPaths(g, placed).size > 0) continue;
    const involved = g.paths
      .map((p) => ({ path: p, courses: p.courses.filter((c) => placed.has(c)) }))
      .filter((x) => x.courses.length);
    const desc = involved
      .map((x) => `${x.courses.join(', ')} (${x.path.name})`)
      .join(' vs ');
    for (const x of involved) {
      for (const cid of x.courses) {
        out.push({
          ruleId: 'EQUIV_CONFLICT',
          severity: 'error',
          courseId: cid,
          groupId: g.id,
          message: `${desc} both belong to the ${g.name} group — choose one path.`,
        });
      }
    }
  }
  return out;
}

// Blocking pre-check for manual adds: null if fine, otherwise an explanation.
export function conflictForAdd(plan, courseId, equivalencyGroups) {
  const placed = new Set(plannedCourseIds(plan));
  for (const { group, paths } of groupsForCourse(equivalencyGroups, courseId)) {
    const possible = consistentPaths(group, placed);
    if (possible.size === 0) continue; // already conflicted; adding more is the user's call
    if (paths.some((p) => possible.has(p.id))) continue; // stays on a consistent path
    const committed = group.paths.find((p) => possible.has(p.id));
    const existing = committed.courses.filter((c) => placed.has(c));
    return {
      group,
      committedPath: committed,
      existing,
      message:
        `${existing.join(' + ')} already commits your ${group.name} to the ` +
        `${committed.name} path. Adding ${courseId} would conflict — remove ` +
        `${existing.join(' / ')} first if you want to switch paths.`,
    };
  }
  return null;
}

// requires_level resolution: a "level:<tag>" prerequisite entry is satisfied
// when the terminal course of any path of the matching group is in
// placedBeforeSet.
export function levelSatisfied(tag, placedBeforeSet, equivalencyGroups) {
  for (const g of activeGroups(equivalencyGroups)) {
    if (g.satisfiesPrereqLevel !== tag) continue;
    for (const p of g.paths) {
      const terminal = p.courses[p.courses.length - 1];
      if (placedBeforeSet.has(terminal)) return true;
    }
  }
  return false;
}

export const isLevelEntry = (entry) => typeof entry === 'string' && entry.startsWith('level:');
export const levelTag = (entry) => entry.slice('level:'.length);

// Human-readable form of an OR-group for violation messages.
export function describePrereqEntry(entry, equivalencyGroups) {
  if (!isLevelEntry(entry)) return entry;
  const tag = levelTag(entry);
  const g = activeGroups(equivalencyGroups).find((x) => x.satisfiesPrereqLevel === tag);
  return g ? `${g.name} complete (${g.paths.map((p) => p.name).join(' or ')})` : `level ${tag}`;
}
