// Same-department ascending-number ordering: within one department, a course
// must never sit in a LATER semester than a same-department course with a
// LOWER number (same semester is fine). Blunt by design (~90% right per UR
// numbering conventions), so it ships with an easy per-pair override:
//
//   plan.sequencingOverrides = [{ lower: "BIOL 111L", higher: "BIOL 250" }]
//
// means "this plan is allowed to schedule BIOL 111L after BIOL 250".
// Overrides are plan-level (a student's exception), never global course data.
//
// This REPLACES the earlier introductoryScore soft heuristic (removed) - one
// system, not two that can disagree.
// Pure functions; no UI or storage imports.

// Parse "BIOL 198P" -> {dept: "BIOL", number: 198}. Returns null (and the
// caller logs/skips) when a code has no space or no leading digits - the
// rule degrades gracefully on malformed codes instead of crashing.
export function parseCourseCode(code) {
  if (typeof code !== 'string') return null;
  const i = code.indexOf(' ');
  if (i <= 0) return null;
  const dept = code.slice(0, i);
  const m = code.slice(i + 1).match(/^(\d+)/);
  if (!m) return null;
  return { dept, number: parseInt(m[1], 10) };
}

export function isSequencingOverridden(plan, lowerId, higherId) {
  return (plan.sequencingOverrides || []).some(
    (o) => o.lower === lowerId && o.higher === higherId,
  );
}

// Constraint check, same shape as the other check* functions. Emits one
// violation per involved course so BOTH cards highlight inline. Transfer-
// bucket courses have no semester and are excluded. Unparseable codes are
// collected into a single info-level notice (and excluded from the rule).
export function checkDepartmentSequencing(plan) {
  const out = [];
  const placed = []; // {id, dept, number, semIdx, semLabel}
  const malformed = [];
  plan.semesters.forEach((sem, semIdx) => {
    for (const id of sem.courseIds) {
      const p = parseCourseCode(id);
      if (!p) { malformed.push(id); continue; }
      placed.push({ id, ...p, semIdx, semLabel: sem.label });
    }
  });

  const byDept = new Map();
  for (const c of placed) {
    if (!byDept.has(c.dept)) byDept.set(c.dept, []);
    byDept.get(c.dept).push(c);
  }

  const seen = new Set();
  for (const list of byDept.values()) {
    for (const lo of list) {
      for (const hi of list) {
        if (lo.number >= hi.number) continue;
        if (lo.semIdx <= hi.semIdx) continue; // ascending or same semester: fine
        if (isSequencingOverridden(plan, lo.id, hi.id)) continue;
        const key = `${lo.id}|${hi.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const message =
          `${hi.id} (${hi.semLabel}) is scheduled before ${lo.id} (${lo.semLabel}) - ` +
          `same-department courses are generally expected in ascending number order.`;
        const pair = { lower: lo.id, higher: hi.id };
        out.push({ ruleId: 'DEPT_SEQUENCING', severity: 'warning', message, courseId: lo.id, semesterId: plan.semesters[lo.semIdx].id, pair });
        out.push({ ruleId: 'DEPT_SEQUENCING', severity: 'warning', message, courseId: hi.id, semesterId: plan.semesters[hi.semIdx].id, pair });
      }
    }
  }

  if (malformed.length) {
    out.push({
      ruleId: 'DEPT_SEQ_UNPARSEABLE', severity: 'info',
      message: `Excluded from department-ordering checks (unparseable codes): ${[...new Set(malformed)].join(', ')}.`,
    });
  }
  return out;
}

// Placement guard for auto-generate (hard constraint, same tier as offering
// and prerequisite checks): would putting `courseId` into semester `semIdx`
// violate ascending order against any course already placed in the plan?
export function placementViolatesDeptOrder(plan, courseId, semIdx) {
  const me = parseCourseCode(courseId);
  if (!me) return false; // malformed codes are excluded from the rule
  for (let i = 0; i < plan.semesters.length; i++) {
    for (const otherId of plan.semesters[i].courseIds) {
      if (otherId === courseId) continue;
      const other = parseCourseCode(otherId);
      if (!other || other.dept !== me.dept) continue;
      // I'd be the LOWER number sitting after a higher one...
      if (me.number < other.number && semIdx > i &&
          !isSequencingOverridden(plan, courseId, otherId)) return true;
      // ...or the HIGHER number landing before a lower one placed later
      // (possible via locked/kept courses in later semesters).
      if (me.number > other.number && semIdx < i &&
          !isSequencingOverridden(plan, otherId, courseId)) return true;
    }
  }
  return false;
}
