// Course status (planned / in progress / completed), letter grades, and GPA.
//
// Grade points are the College scale from the UR Undergraduate Bulletin
// (https://www.rochester.edu/bulletin/college/grading.html) and the CCAS
// Advising Handbook (https://www.rochester.edu/college/ccas/handbook/grading-system.html):
// A 4.0 · A- 3.7 · B+ 3.3 · B 3.0 · B- 2.7 · C+ 2.3 · C 2.0 · C- 1.7 ·
// D+ 1.3 · D 1.0 · D- 0.7 · E 0.0. "Grades which carry no grade points": I, W,
// P, S, F (S/F option), XF. GPA counts only courses with final letter grades,
// "whether passing or failing", and never transfer or AP credit.
//
// Everything here is student-entered and unofficial; the registrar's record wins.
//
// Pure functions; no UI or storage imports. Reads plan.courseMeta directly so
// model.js can import it without a cycle.

export const COURSE_STATUSES = ['planned', 'in_progress', 'completed'];

export const STATUS_LABEL = {
  planned: 'Planned',
  in_progress: 'In progress',
  completed: 'Completed',
};

export const GRADE_POINTS = {
  'A': 4.0, 'A-': 3.7,
  'B+': 3.3, 'B': 3.0, 'B-': 2.7,
  'C+': 2.3, 'C': 2.0, 'C-': 1.7,
  'D+': 1.3, 'D': 1.0, 'D-': 0.7,
  'E': 0.0, 'XE': 0.0,
};

// Marks with no grade points. `credit` = whether the course still earns credit.
export const NON_GPA_MARKS = {
  P: { label: 'Pass', credit: true },
  S: { label: 'Satisfactory (S/F option)', credit: true },
  F: { label: 'Fail (S/F option)', credit: false },
  XF: { label: 'Fail, academic dishonesty (P/F course)', credit: false },
  W: { label: 'Withdrawn', credit: false },
  I: { label: 'Incomplete', credit: false },
};

// Letter grades that are failures: they count in the GPA but earn no credit.
const FAILING_LETTERS = new Set(['E', 'XE']);

export const GRADE_OPTIONS = [...Object.keys(GRADE_POINTS), ...Object.keys(NON_GPA_MARKS)];

// Overall and in-major minimum from the Bulletin's probation rules.
export const MIN_CUMULATIVE_GPA = 2.0;

function metaOf(plan, courseId) {
  return (plan?.courseMeta && plan.courseMeta[courseId]) || null;
}

export function isTransferCourse(plan, courseId) {
  return (plan?.transfer || []).some((t) => t.courseId === courseId);
}

// Transfer / AP / IB credit is already on the record, so it reads as completed.
export function getCourseStatus(plan, courseId) {
  if (isTransferCourse(plan, courseId)) return 'completed';
  const s = metaOf(plan, courseId)?.status;
  return COURSE_STATUSES.includes(s) ? s : 'planned';
}

export function getCourseGrade(plan, courseId) {
  const g = metaOf(plan, courseId)?.grade;
  return GRADE_OPTIONS.includes(g) ? g : null;
}

// A completed course with a failing or no-credit mark earns no credit, so it
// can't fill requirements or count toward total hours.
export function earnsNoCredit(plan, courseId) {
  if (getCourseStatus(plan, courseId) !== 'completed') return false;
  const g = getCourseGrade(plan, courseId);
  if (!g) return false;
  if (FAILING_LETTERS.has(g)) return true;
  return NON_GPA_MARKS[g] ? !NON_GPA_MARKS[g].credit : false;
}

function withMeta(plan, courseId, patch) {
  const prev = metaOf(plan, courseId) || { source: 'manual', locked: true, reason: null };
  const next = { ...prev, ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  return { ...plan, courseMeta: { ...(plan.courseMeta || {}), [courseId]: next } };
}

// Completed and in-progress courses are locked so auto-generate never moves
// them. Going back to planned drops the grade.
export function withCourseStatus(plan, courseId, status) {
  if (!COURSE_STATUSES.includes(status)) return plan;
  if (status === 'planned') return withMeta(plan, courseId, { status: undefined, grade: undefined });
  const patch = { status, locked: true };
  if (status === 'in_progress') patch.grade = undefined;
  return withMeta(plan, courseId, patch);
}

// Entering a grade marks the course completed. A null grade clears it.
export function withCourseGrade(plan, courseId, grade) {
  if (grade == null || grade === '') return withMeta(plan, courseId, { grade: undefined });
  if (!GRADE_OPTIONS.includes(grade)) return plan;
  return withMeta(plan, courseId, { grade, status: 'completed', locked: true });
}

// GPA over the given course ids: completed, letter-graded, non-transfer only.
// Returns gpa null when nothing is graded yet.
export function gpaFor(plan, data, courseIds) {
  let credits = 0;
  let points = 0;
  const graded = [];
  for (const cid of new Set(courseIds)) {
    if (isTransferCourse(plan, cid)) continue;
    if (getCourseStatus(plan, cid) !== 'completed') continue;
    const g = getCourseGrade(plan, cid);
    if (!(g in GRADE_POINTS)) continue;
    const cr = data.courses?.[cid]?.credits ?? 4;
    credits += cr;
    points += GRADE_POINTS[g] * cr;
    graded.push(cid);
  }
  return {
    gpa: credits > 0 ? Math.round((points / credits) * 1000) / 1000 : null,
    credits,
    qualityPoints: Math.round(points * 100) / 100,
    graded,
  };
}

export function semesterCourseIds(plan) {
  return (plan.semesters || []).flatMap((s) => s.courseIds);
}

export function cumulativeGpa(plan, data) {
  return gpaFor(plan, data, semesterCourseIds(plan));
}

export function termGpa(plan, data, semester) {
  return gpaFor(plan, data, semester?.courseIds || []);
}

// Courses "submitted for the major": everything the audit assigned to this
// program's requirement groups, minus groups flagged ancillary (Biology's
// allied-field courses are excluded from its major GPA).
export function programCourseIds(program, programResult) {
  const ancillary = new Set((program?.requirementGroups || [])
    .filter((g) => g.ancillary).map((g) => g.id));
  const out = new Set();
  for (const g of programResult?.groups || []) {
    if (ancillary.has(g.id)) continue;
    for (const cid of g.satisfiedBy || []) out.add(cid);
  }
  return [...out];
}

export function programGpa(plan, data, program, programResult) {
  const ids = programCourseIds(program, programResult);
  const r = gpaFor(plan, data, ids);
  const ungraded = ids.filter((cid) => !isTransferCourse(plan, cid) && !r.graded.includes(cid));
  return { ...r, courseIds: ids, ungraded };
}

// Credit hours by status, for the header summary.
export function creditsByStatus(plan, data) {
  const out = { completed: 0, in_progress: 0, planned: 0, noCredit: 0 };
  const seen = new Set();
  const all = [...semesterCourseIds(plan), ...(plan.transfer || []).map((t) => t.courseId)];
  for (const cid of all) {
    if (seen.has(cid)) continue;
    seen.add(cid);
    const cr = data.courses?.[cid]?.credits ?? 4;
    if (earnsNoCredit(plan, cid)) { out.noCredit += cr; continue; }
    out[getCourseStatus(plan, cid)] += cr;
  }
  return out;
}

export function formatGpa(gpa) {
  return gpa == null ? '—' : gpa.toFixed(2);
}
