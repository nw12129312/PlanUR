// Grid drag-and-drop: swap two placed courses, or append a course onto a
// semester without exchanging it for another. The UI still applies the move
// when it would break a course rule (prereq order, offering term, …) and
// surfaces those as warnings — the student asked to swap, not to snap away.
//
// Pure functions; no UI or storage imports.

import { plannedCourseIds, semesterIndexOf, withCourseMeta } from './model.js';
import { checkAll } from './constraints.js';

const COURSE_RULES = new Set([
  'PREREQ_ORDER',
  'PREREQ_UNVERIFIED',
  'OFFERING_TERM',
  'OFFERING_UNVERIFIED',
  'DEPT_SEQUENCING',
  'EQUIV_CONFLICT',
]);

function cloneSemesters(plan) {
  return {
    ...plan,
    semesters: plan.semesters.map((s) => ({ ...s, courseIds: [...s.courseIds] })),
    courseMeta: { ...(plan.courseMeta || {}) },
  };
}

function lockDragged(plan, cid) {
  return withCourseMeta(plan, cid, { locked: true, source: plan.courseMeta?.[cid]?.source || 'manual' });
}

export function swapPlacedCourses(plan, a, b) {
  if (!a || !b || a === b) return plan;
  const ia = semesterIndexOf(plan, a);
  const ib = semesterIndexOf(plan, b);
  if (ia < 0 || ib < 0) return plan;
  const next = cloneSemesters(plan);
  const aIds = next.semesters[ia].courseIds;
  const bIds = next.semesters[ib].courseIds;
  const pa = aIds.indexOf(a);
  const pb = bIds.indexOf(b);
  if (pa < 0 || pb < 0) return plan;
  aIds[pa] = b;
  bIds[pb] = a;
  return lockDragged(lockDragged(next, a), b);
}

export function moveCourseToSemester(plan, cid, semId) {
  if (!cid || !semId) return plan;
  const already = plannedCourseIds(plan).includes(cid);
  const next = cloneSemesters(plan);
  const target = next.semesters.find((s) => s.id === semId);
  if (!target) return plan;
  if (already) {
    for (const s of next.semesters) {
      s.courseIds = s.courseIds.filter((x) => x !== cid);
    }
  }
  if (!target.courseIds.includes(cid)) target.courseIds.push(cid);
  return lockDragged(next, cid);
}

export function placementWarnings(plan, data, courseIds, semesterIds = []) {
  const watch = new Set(courseIds.filter(Boolean));
  const sems = new Set(semesterIds.filter(Boolean));
  const { violations } = checkAll(plan, data);
  const hits = [];
  const seen = new Set();
  for (const v of violations) {
    const courseHit = v.courseId && watch.has(v.courseId) && COURSE_RULES.has(v.ruleId);
    const loadHit = sems.has(v.semesterId) && v.ruleId === 'LOAD_MAX';
    if (!courseHit && !loadHit) continue;
    if (seen.has(v.message)) continue;
    seen.add(v.message);
    hits.push(v);
  }
  return hits;
}
