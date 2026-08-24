// Plan model helpers. Pure functions; no UI or storage imports.

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
    transfer: [], // [{courseId, kind: 'ap'|'ib'|'transfer'}]
    // per placed course: { source: 'manual'|'auto', locked: boolean, reason?: string }
    courseMeta: {},
    // per-pair exceptions to the same-department ascending-number rule:
    // [{ lower: 'BIOL 111L', higher: 'BIOL 250' }]
    sequencingOverrides: [],
    // declared concentration / track / theme inside a program:
    // { [programId]: { [groupId]: trackName } }
    trackChoices: {},
    preferences: { scheduleStyle: 'balanced' },
    createdAt: Date.now(),
    lastEdited: Date.now(),
  };
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

export function addSemester(plan) {
  const i = plan.semesters.length;
  const last = plan.semesters[i - 1];
  let term = 'fall', year = new Date().getFullYear();
  if (last) {
    const m = last.label.match(/(Fall|Spring)\s+(\d{4})/);
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
      label: `${term === 'fall' ? 'Fall' : 'Spring'} ${year}`,
      courseIds: [],
    }],
  };
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
  return {
    plan, courses, policy,
    programById, clusterById,
    majors, minors, selClusters,
    course: (id) => courses[id],
    placed: plannedCourseIds(plan),
    placedSet: new Set(plannedCourseIds(plan)),
  };
}

export function isWrtgPwr(policy, courseId) {
  return policy.pwr.neverCountsTowardCluster.includes(courseId);
}
