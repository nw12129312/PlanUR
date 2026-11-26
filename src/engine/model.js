// Plan model helpers. Pure functions; no UI or storage imports.

import { earnsNoCredit } from './grades.js';

export function newPlan(name = 'Untitled plan', startYear = new Date().getFullYear()) {
  const semesters = [];
  for (let i = 0; i < 8; i++) {
    const year = startYear + Math.floor(i / 2);
    const term = i % 2 === 0 ? 'fall' : 'spring';
    semesters.push({
      id: `${term}-${term === 'fall' ? year : year + 0}-${i}`,
      term,
      label: `${term === 'fall' ? 'Fall' : 'Spring'} ${term === 'fall' ? year : year + 1}`,
      courseIds: [],
    });
  }
  return {
    id: `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    majorIds: [],
    minorIds: [],
    clusterIds: [],
    doubleDegree: false,
    semesters,
    transfer: [], // [{courseId, kind: 'ap'|'ib'|'transfer', examId?, examIds?}]
    transferExams: [], // [{examId, score, choice?}] from the CCAS AP handbook
    // per placed course: { source: 'manual'|'auto', locked: boolean, reason?: string,
    //   status?: 'planned'|'in_progress'|'completed', grade?: 'A'…'E'|'P'|'S'|'F'|'W'|'I'|'XE'|'XF' }
    // (status/grade helpers live in grades.js; absent status = planned)
    courseMeta: {},
    // leftover from the retired same-department numbering rule; ignored
    sequencingOverrides: [],
    // declared concentration / track / theme inside a program:
    // { [programId]: { [groupId]: trackName } }
    trackChoices: {},
    preferences: { scheduleStyle: 'balanced' },
    createdAt: Date.now(),
    lastEdited: Date.now(),
  };
}

// A clean slate for an existing plan: same id, name and start year, with
// no programs, clusters, courses, credit or grades. Saving it overwrites the
// stored copy, so the clear carries over to this device and the account.
export function clearedPlan(plan) {
  const firstFall = (plan.semesters || []).find((s) => s.term === 'fall');
  const year = Number(firstFall?.label?.match(/\d{4}/)?.[0]);
  const fresh = newPlan(plan.name, Number.isFinite(year) ? year : undefined);
  return {
    ...fresh,
    id: plan.id,
    createdAt: plan.createdAt ?? fresh.createdAt,
    preferences: { ...fresh.preferences, ...(plan.preferences || {}) },
  };
}

export function isPlanEmpty(plan) {
  return !plan.majorIds.length && !plan.minorIds.length && !plan.clusterIds.length
    && !(plan.transfer || []).length && !(plan.transferExams || []).length
    && plan.semesters.every((s) => !s.courseIds.length);
}

export function getTrackChoice(plan, programId, groupId) {
  return plan?.trackChoices?.[programId]?.[groupId] || '';
}

export function withTrackChoice(plan, programId, groupId, trackName) {
  const byProg = { ...(plan.trackChoices || {}) };
  const byGroup = { ...(byProg[programId] || {}) };
  if (!trackName) delete byGroup[groupId];
  else byGroup[groupId] = trackName;
  if (Object.keys(byGroup).length) byProg[programId] = byGroup;
  else delete byProg[programId];
  return { ...plan, trackChoices: byProg };
}

// Course metadata with a legacy-safe default: plans saved before courseMeta
// existed treat every placed course as manually placed and locked, so a
// regenerate can never silently overwrite them.
export function getCourseMeta(plan, courseId) {
  return (plan.courseMeta && plan.courseMeta[courseId]) || { source: 'manual', locked: true, reason: null };
}

export function withCourseMeta(plan, courseId, meta) {
  const next = { ...(plan.courseMeta || {}) };
  if (meta === null) delete next[courseId];
  else next[courseId] = { ...getCourseMeta(plan, courseId), ...meta };
  return { ...plan, courseMeta: next };
}

export function isLocked(plan, courseId) {
  return getCourseMeta(plan, courseId).locked;
}

export const ACADEMIC_YEAR_NAMES = [
  'First year', 'Sophomore year', 'Junior year', 'Senior year', 'Fifth year', 'Sixth year',
];

const TERM_LABEL = { fall: 'Fall', spring: 'Spring', summer: 'Summer' };
const CHRONO_ORDER = { spring: 0, summer: 1, fall: 2 };
const YEAR_ORDER = { fall: 0, spring: 1, summer: 2 };

export function parseSemesterLabel(label) {
  const m = String(label || '').match(/(Fall|Spring|Summer)\s+(\d{4})/);
  if (!m) return null;
  return { term: m[1].toLowerCase(), year: Number(m[2]) };
}

export function semesterChronoKey(sem) {
  const parsed = parseSemesterLabel(sem?.label) || { term: sem?.term, year: 0 };
  return parsed.year * 10 + (CHRONO_ORDER[parsed.term] ?? 9);
}

function academicYearKey(sem) {
  const parsed = parseSemesterLabel(sem?.label) || { term: sem?.term, year: 0 };
  return parsed.term === 'fall' ? parsed.year : parsed.year - 1;
}

// Academic year = Fall YYYY + Spring YYYY+1 + optional Summer YYYY+1.
export function groupIntoYears(semesters) {
  const buckets = new Map();
  for (const sem of semesters || []) {
    const key = academicYearKey(sem);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(sem);
  }
  return [...buckets.keys()].sort((a, b) => a - b).map((k) => {
    const group = buckets.get(k).slice();
    group.sort((a, b) => (YEAR_ORDER[a.term] ?? 9) - (YEAR_ORDER[b.term] ?? 9));
    return group;
  });
}

function summerYearForAcademicGroup(group) {
  const spring = group.find((s) => s.term === 'spring');
  if (spring) return parseSemesterLabel(spring.label)?.year ?? null;
  const fall = group.find((s) => s.term === 'fall');
  if (fall) {
    const y = parseSemesterLabel(fall.label)?.year;
    return y == null ? null : y + 1;
  }
  return null;
}

export function availableSummerSlots(plan) {
  return groupIntoYears(plan.semesters || []).flatMap((group, i) => {
    if (group.some((s) => s.term === 'summer')) return [];
    const year = summerYearForAcademicGroup(group);
    if (year == null) return [];
    return [{ year, yearLabel: ACADEMIC_YEAR_NAMES[i] || `Year ${i + 1}` }];
  });
}

export function addSemester(plan) {
  const i = plan.semesters.length;
  const last = plan.semesters[i - 1];
  let term = 'fall', year = new Date().getFullYear();
  if (last) {
    const m = last.label.match(/(Fall|Spring|Summer)\s+(\d{4})/);
    if (m) {
      term = m[1] === 'Fall' ? 'spring' : 'fall';
      year = m[1] === 'Fall' ? Number(m[2]) + 1 : Number(m[2]);
    }
  }
  return {
    ...plan,
    semesters: [...plan.semesters, {
      id: `${term}-${year}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      term,
      label: `${TERM_LABEL[term]} ${year}`,
      courseIds: [],
    }],
  };
}

export function addSummerSemester(plan, year) {
  const y = Number(year);
  if (!Number.isFinite(y)) return plan;
  const already = (plan.semesters || []).some((s) => (
    s.term === 'summer' && parseSemesterLabel(s.label)?.year === y
  ));
  if (already) return plan;
  const i = plan.semesters.length;
  const added = {
    id: `summer-${y}-${i}-${Math.random().toString(36).slice(2, 6)}`,
    term: 'summer',
    label: `Summer ${y}`,
    courseIds: [],
  };
  const semesters = [...plan.semesters, added]
    .sort((a, b) => semesterChronoKey(a) - semesterChronoKey(b));
  return { ...plan, semesters };
}

// All course ids in the plan (semesters in order, then transfer bucket).
export function plannedCourseIds(plan) {
  const out = [];
  for (const s of plan.semesters) for (const c of s.courseIds) out.push(c);
  for (const t of plan.transfer) out.push(t.courseId);
  return out;
}

export function semesterIndexOf(plan, courseId) {
  for (let i = 0; i < plan.semesters.length; i++) {
    if (plan.semesters[i].courseIds.includes(courseId)) return i;
  }
  return -1; // transfer bucket or absent
}

export function isTransfer(plan, courseId) {
  return plan.transfer.some((t) => t.courseId === courseId);
}

export function transferKind(plan, courseId) {
  const t = plan.transfer.find((t) => t.courseId === courseId);
  return t ? t.kind : null;
}

// Build the evaluation context shared by progress + constraints.
export function buildContext(plan, data) {
  const { courses, programs, clusters, policy } = data;
  const programById = new Map(programs.map((p) => [p.id, p]));
  const clusterById = new Map(clusters.map((c) => [c.id, c]));
  const majors = plan.majorIds.map((id) => programById.get(id)).filter(Boolean);
  const minors = plan.minorIds.map((id) => programById.get(id)).filter(Boolean);
  const selClusters = plan.clusterIds.map((id) => clusterById.get(id)).filter(Boolean);
  const creditBearing = plannedCourseIds(plan).filter((cid) => !earnsNoCredit(plan, cid));
  return {
    plan, courses, policy,
    programById, clusterById,
    majors, minors, selClusters,
    course: (id) => courses[id],
    // A completed course with a failing / no-credit mark (E, F, W, I…) earns
    // no credit, so it never fills a requirement or counts toward total hours.
    placed: creditBearing,
    placedSet: new Set(creditBearing),
  };
}

export function isWrtgPwr(policy, courseId) {
  return policy.pwr.neverCountsTowardCluster.includes(courseId);
}
