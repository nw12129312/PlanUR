// How a student wants auto-generate to pack a semester.
// These are preferences, not constraints: prereqs, offerings, and credit
// caps still win. Lower styleScore is preferred (same convention as autogen).
//
// Pure functions; no UI or storage imports.

export const SCHEDULE_STYLES = [
  {
    id: 'balanced',
    label: 'Mixed subjects',
    blurb: 'Pair natural sciences with humanities or arts in the same term so no semester is all one subject.',
  },
  {
    id: 'focused',
    label: 'Subject blocks',
    blurb: 'Let one or two departments dominate a semester — a CSC-heavy term, then an English-heavy term.',
  },
  {
    id: 'frontload-major',
    label: 'Major first',
    blurb: 'Fill core major courses earlier and leave clusters and extras for later semesters.',
  },
];

const STYLE_IDS = new Set(SCHEDULE_STYLES.map((s) => s.id));

export function normalizeScheduleStyle(id) {
  return STYLE_IDS.has(id) ? id : 'balanced';
}

export function styleOf(plan) {
  return normalizeScheduleStyle(plan?.preferences?.scheduleStyle);
}

export function withScheduleStyle(plan, scheduleStyle) {
  return {
    ...plan,
    preferences: {
      ...(plan.preferences || {}),
      scheduleStyle: normalizeScheduleStyle(scheduleStyle),
    },
  };
}

export function deptDivisionIndex(data) {
  const m = new Map();
  const set = (dept, division) => {
    if (dept && division && !m.has(dept)) m.set(dept, division);
  };
  for (const p of data.programs || []) {
    for (const d of p.departments || []) set(d, p.division);
  }
  for (const c of data.clusters || []) {
    set(c.homeDept, c.division);
    for (const d of c.homeDeptCourseDepts || []) set(d, c.division);
  }
  return m;
}

export function majorDepartments(plan, data) {
  const depts = new Set();
  for (const id of plan.majorIds || []) {
    const p = (data.programs || []).find((x) => x.id === id);
    for (const d of p?.departments || []) depts.add(d);
  }
  return depts;
}

function courseDept(cid, data) {
  return data.courses[cid]?.dept || parseDept(cid);
}

function parseDept(cid) {
  if (typeof cid !== 'string') return null;
  const i = cid.indexOf(' ');
  return i > 0 ? cid.slice(0, i) : null;
}

function present(cids, data, divIndex) {
  const depts = new Set();
  const divisions = new Set();
  for (const cid of cids) {
    const dept = courseDept(cid, data);
    if (dept) depts.add(dept);
    const div = divIndex.get(dept);
    if (div) divisions.add(div);
  }
  return { depts, divisions };
}

// 0 = best fit for the chosen style, larger = worse. Used as a sort key.
export function styleScore(cid, { style, semesterIds, majorDepts, divIndex, data }) {
  const kind = normalizeScheduleStyle(style);
  const dept = courseDept(cid, data);
  const div = divIndex.get(dept);
  const { depts, divisions } = present(semesterIds, data, divIndex);

  if (kind === 'focused') {
    if (!semesterIds.length) return 0;
    if (dept && depts.has(dept)) return 0;
    if (div && divisions.has(div)) return 1;
    return 2;
  }
  if (kind === 'balanced') {
    if (!semesterIds.length) return 0;
    if (div && !divisions.has(div)) return 0;
    if (dept && !depts.has(dept)) return 1;
    return 2;
  }
  if (kind === 'frontload-major') {
    if (dept && majorDepts.has(dept)) return 0;
    return 1;
  }
  return 1;
}
