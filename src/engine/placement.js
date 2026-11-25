// Choosing a semester for a catalog course.
//
// semesterOptionsForCourse() lists every semester in the plan and says
// whether the course can go there, with the reasons when it can't:
//   - a prerequisite is not in an earlier semester (or transfer / exam credit)
//   - the course isn't offered in that term (harvested CDCS schedule data)
// It also flags plan-wide blocks: the course (or a cross-listing) is already
// on the plan, or it would mix paths of an equivalency group.
//
// addCourseToSemester() is the guarded add: it refuses any semester the
// options mark as unavailable, so the UI can't place a course there.
//
// Pure functions; no UI or storage imports.

import { withCourseMeta } from './model.js';
import {
  conflictForAdd, describePrereqEntry, isLevelEntry, levelSatisfied, levelTag,
} from './equivalency.js';
import { coversCourse, expandPlacedSet, listingOnPlan } from './crossList.js';

const MAX_LOAD = 18;

const TERM_NAME = { fall: 'fall', spring: 'spring', summer: 'summer' };

function earlierCourses(plan, semIdx) {
  const s = new Set(plan.transfer.map((t) => t.courseId));
  for (let i = 0; i < semIdx; i++) {
    for (const cid of plan.semesters[i].courseIds) s.add(cid);
  }
  return s;
}

function entryMet(entry, fam, eqGroups, courses) {
  return isLevelEntry(entry)
    ? levelSatisfied(levelTag(entry), fam, eqGroups)
    : coversCourse(fam, entry, courses);
}

function listWithOr(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

// Prerequisite OR-groups of `cid` that nothing before semester `semIdx` meets.
export function unmetPrereqs(plan, data, cid, semIdx) {
  const c = data.courses[cid];
  if (!c?.prereqs?.length) return [];
  const eqGroups = data.equivalencyGroups || [];
  const fam = expandPlacedSet(earlierCourses(plan, semIdx), data.courses);
  return c.prereqs.filter((g) => !g.some((p) => entryMet(p, fam, eqGroups, data.courses)));
}

// Reason the whole plan can't take the course, or null.
export function planWideBlock(plan, data, cid) {
  const c = data.courses[cid];
  if (!c) return `${cid} is not in the catalog.`;
  const existing = listingOnPlan(plan, cid, data.courses);
  if (existing) {
    return existing === cid
      ? `${cid} is already on your plan.`
      : `${cid} is already on your plan as ${existing} (cross-listed).`;
  }
  const conflict = conflictForAdd(plan, cid, data.equivalencyGroups);
  if (conflict) return conflict.message;
  return null;
}

// { blocked: string|null, options: [{ semesterId, label, term, credits, allowed, reasons, notes }] }
// `reasons` explain why a semester is unavailable; `notes` are warnings that
// don't stop the add (e.g. going over the credit load).
export function semesterOptionsForCourse(plan, data, cid) {
  const blocked = planWideBlock(plan, data, cid);
  const c = data.courses[cid];
  const eqGroups = data.equivalencyGroups || [];
  const options = plan.semesters.map((sem, i) => {
    const reasons = [];
    const notes = [];
    const credits = sem.courseIds.reduce((a, id) => a + (data.courses[id]?.credits ?? 4), 0);
    if (c) {
      for (const g of unmetPrereqs(plan, data, cid, i)) {
        const names = g.map((p) => describePrereqEntry(p, eqGroups));
        const sameSem = new Set(sem.courseIds);
        const inSame = g.some((p) => !isLevelEntry(p) && coversCourse(sameSem, p, data.courses));
        reasons.push(inSame
          ? `Prerequisite ${listWithOr(names)} is in this same semester; it has to come earlier.`
          : `Needs ${listWithOr(names)} in an earlier semester first.`);
      }
      if (c.offeredVerified && !c.offered.includes(sem.term)) {
        const ran = c.offered.map((t) => TERM_NAME[t] || t);
        reasons.push(`Not offered in ${TERM_NAME[sem.term] || sem.term}` +
          (ran.length ? ` (runs ${listWithOr(ran)}).` : '.'));
      }
      const load = credits + (c.credits ?? 4);
      if (load > MAX_LOAD) notes.push(`Brings this semester to ${load} credits (overload).`);
    }
    return {
      semesterId: sem.id,
      label: sem.label,
      term: sem.term,
      credits,
      allowed: !blocked && reasons.length === 0,
      reasons,
      notes,
    };
  });
  return { blocked, options };
}

// Guarded add from the catalog: { plan, error }. On error the plan is
// returned unchanged.
export function addCourseToSemester(plan, data, cid, semId) {
  const { blocked, options } = semesterOptionsForCourse(plan, data, cid);
  if (blocked) return { plan, error: blocked };
  const opt = options.find((o) => o.semesterId === semId);
  if (!opt) return { plan, error: 'Semester not found.' };
  if (!opt.allowed) {
    return { plan, error: `${cid} can't go in ${opt.label}: ${opt.reasons.join(' ')}` };
  }
  const next = {
    ...plan,
    semesters: plan.semesters.map((s) => (
      s.id === semId ? { ...s, courseIds: [...s.courseIds, cid] } : s
    )),
  };
  return {
    plan: withCourseMeta(next, cid, { source: 'manual', locked: true }),
    error: null,
  };
}
