// Divisional-coverage check: does the student's combination of selected
// programs (majors + minors + clusters) collectively touch all three
// divisions of learning - Humanities, Social Sciences, Natural Sciences?
//
// This is a SELECTION-level check, deliberately separate from the
// course-level constraint engine: it fires while choosing programs, before
// any courses exist. It is advisory ("generally expects"), never a hard
// block - some majors have their own divisional arrangements.
//
// Policy basis (cited, not paraphrased from memory):
//   "All students are required to complete at least one major in one of the
//    three divisions of learning and one cluster in each of the other two
//    divisions, with an average grade of C or better."
//   - College Center for Advising Services, "Clusters"
//     https://www.rochester.edu/college/ccas/undergraduate/curriculum/clusters.html
//   A minor or second major may substitute for a cluster, which is why this
//   check looks at the whole combination, not clusters alone.
//
// NEEDS_VERIFICATION: whether the Engineering division satisfies the Natural
// Sciences slot is NOT confirmed against UR policy. Until it is, Engineering
// counts only as its own category here (consistent with the Hajim
// cluster-count rules elsewhere in this app), and combinations that rely on
// an engineering program for science coverage will warn - softly.
// If policy confirms otherwise, change ENGINEERING_SATISFIES_NATURAL_SCIENCES.
//
// Pure functions; no UI or storage imports.

export const REQUIRED_DIVISIONS = ['humanities', 'social-sciences', 'natural-sciences'];
export const ENGINEERING_SATISFIES_NATURAL_SCIENCES = false; // NEEDS_VERIFICATION - see header

export const DIVISION_LABELS = {
  humanities: 'Humanities',
  'social-sciences': 'Social Sciences',
  'natural-sciences': 'Natural Sciences',
  engineering: 'Engineering',
};

// Spec-shaped core: takes the selected program objects (majors, minors,
// clusters alike - anything with a `division` field) and reports coverage.
export function checkDivisionalCoverage(selectedPrograms) {
  const covered = new Set();
  for (const p of selectedPrograms || []) {
    if (!p?.division) continue;
    covered.add(p.division);
    if (p.division === 'engineering' && ENGINEERING_SATISFIES_NATURAL_SCIENCES) {
      covered.add('natural-sciences');
    }
  }
  const missing = REQUIRED_DIVISIONS.filter((d) => !covered.has(d));
  return {
    satisfied: missing.length === 0,
    missingDivisions: missing,
    coveredDivisions: REQUIRED_DIVISIONS.concat('engineering').filter((d) => covered.has(d)),
  };
}

// Plan-level wrapper: assembles the selected programs from a plan, applies
// the applicability rule (a combination exists only once a major plus at
// least one more program is selected - a standalone program view never
// warns), and composes the user-facing message with the selections named.
export function divisionalCoverageForPlan(plan, data) {
  const programById = new Map(data.programs.map((p) => [p.id, p]));
  const clusterById = new Map(data.clusters.map((c) => [c.id, c]));

  const parts = [];
  for (const id of plan.majorIds) {
    const p = programById.get(id);
    if (p) parts.push({ division: p.division, label: `${p.name} ${p.degree} major` });
  }
  for (const id of plan.minorIds) {
    const p = programById.get(id);
    if (p) parts.push({ division: p.division, label: `${p.name} minor` });
  }
  for (const id of plan.clusterIds) {
    const c = clusterById.get(id);
    if (c) parts.push({ division: c.division, label: `${c.name} cluster` });
  }

  const applicable = plan.majorIds.length >= 1 && parts.length >= 2;
  const result = checkDivisionalCoverage(parts);
  const comboKey = [...plan.majorIds, ...plan.minorIds, ...plan.clusterIds].sort().join('|');

  let message = null;
  if (applicable && !result.satisfied) {
    const names = parts.map((x) => x.label).join(', ');
    const miss = result.missingDivisions.map((d) => DIVISION_LABELS[d]);
    const missText = miss.length === 1 ? `a ${miss[0]} program`
      : `${miss.slice(0, -1).join(', ')} or ${miss[miss.length - 1]} programs`;
    message =
      `Your current selections (${names}) don't include ${missText}. ` +
      `UR's curriculum generally expects coverage across Humanities, Social Sciences, and Natural Sciences.`;
    if (parts.some((x) => x.division === 'engineering') && result.missingDivisions.includes('natural-sciences')) {
      message += ' Note: whether Engineering programs satisfy the Natural Sciences division is unverified - check with your adviser.';
    }
  }

  return { applicable, ...result, message, comboKey };
}
