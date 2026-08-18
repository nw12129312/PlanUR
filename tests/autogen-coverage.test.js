// Every ACTIVE major must generate a complete, error-free 4-year plan from one
// button press. This is the app's core promise, and the reason it exists as a
// standing test: the per-major failures fixed here (mandatory courses banned by
// the retry loop, cluster groups scored against the whole-cluster union, an
// equivalency path chosen against a pinned requirement, sequence_one_of drifting
// onto a longer path, the 100-level cap emptying a prerequisite group) all
// passed the targeted tests individually and only showed up in a full sweep.
import { describe, it, expect } from 'vitest';
import coursesData from '../src/data/courses.json';
import programsData from '../src/data/programs.json';
import clustersData from '../src/data/clusters.json';
import policyData from '../src/data/policy.json';
import equivalencyGroupsData from '../src/data/equivalency_groups.json';

import { newPlan } from '../src/engine/model.js';
import { checkAll } from '../src/engine/constraints.js';
import { autoGenerate } from '../src/engine/autogen.js';

const DATA = {
  courses: coursesData, programs: programsData, clusters: clustersData,
  policy: policyData, equivalencyGroups: equivalencyGroupsData,
};

const activeMajors = programsData.filter((p) => p.status === 'ACTIVE' && p.type === 'major');
const activeClusters = clustersData.filter((c) => c.status === 'ACTIVE');

// vitest's 5s default is too tight for the heaviest majors: PSC BS already runs
// ~4.4s, and Interdepartmental Studies takes ~7s because its ten core courses
// may come from ANY department, so the scheduler scores the whole catalog.
const GENERATE_TIMEOUT_MS = 20000;

// Clusters legal for this major: allowed division, not the major's own
// department, distinct divisions and distinct home departments from each other.
function legalClusters(major, n) {
  const allowed = major.allowedClusterDivisions ?? ['humanities', 'social-sciences', 'natural-sciences'];
  const own = new Set(major.departments ?? []);
  const out = [];
  const divs = new Set();
  const depts = new Set();
  for (const c of activeClusters) {
    if (out.length >= n) break;
    if (!allowed.includes(c.division) || divs.has(c.division) || depts.has(c.homeDept)) continue;
    if (own.has(c.homeDept) || (c.homeDeptCourseDepts ?? []).some((d) => own.has(d))) continue;
    out.push(c.id);
    divs.add(c.division);
    depts.add(c.homeDept);
  }
  return out;
}

function generateFor(majorId) {
  const major = programsData.find((p) => p.id === majorId);
  const p = newPlan('coverage', 2026);
  p.majorIds = [majorId];
  p.clusterIds = legalClusters(major, major.clustersRequired ?? 2);
  const result = autoGenerate(p, DATA);
  return { result, ...checkAll(result.plan, DATA) };
}

describe('auto-generate covers every ACTIVE major', () => {
  it('has majors to test (guards against an empty sweep passing vacuously)', () => {
    expect(activeMajors.length).toBeGreaterThan(20);
  });

  for (const major of activeMajors) {
    it(`${major.id} generates a complete plan with no errors`, () => {
      const { result, progress, violations } = generateFor(major.id);
      const errors = violations.filter((v) => v.severity === 'error');

      expect(result.infeasible, JSON.stringify(result.infeasible, null, 1)).toEqual([]);
      expect(errors, JSON.stringify(errors.map((e) => e.ruleId + ': ' + e.message), null, 1)).toEqual([]);
      for (const pr of progress.programs) {
        const unmet = pr.groups.filter((g) => !g.complete).map((g) => `${g.id} ${g.have}/${g.need}`);
        expect(unmet, `${pr.programId} unmet: ${unmet.join(', ')}`).toEqual([]);
      }
      for (const cr of progress.clusters) expect(cr.complete, cr.clusterId).toBe(true);
      expect(progress.pwr.satisfied).toBe(true);
    }, GENERATE_TIMEOUT_MS);
  }
});

describe('every ACTIVE minor can actually be satisfied', () => {
  // Minors are invisible to the major sweep above, so a minor whose rules do not
  // resolve against the catalog (a wOnly filter with no W courses, a code the
  // registrar spells differently) would ship unnoticed. Pair each with a major
  // from unrelated departments so overlap caps do not muddy the result.
  const activeMinors = programsData.filter((p) => p.status === 'ACTIVE' && p.type === 'minor');

  it('has minors to test', () => {
    expect(activeMinors.length).toBeGreaterThan(5);
  });

  for (const minor of activeMinors) {
    it(`${minor.id} reaches complete`, () => {
      const major = programsData.find((p) => p.type === 'major' && p.status === 'ACTIVE' &&
        !(p.departments || []).some((d) => (minor.departments || []).includes(d)));
      const plan = newPlan('minor-coverage', 2026);
      plan.majorIds = [major.id];
      plan.minorIds = [minor.id];
      plan.clusterIds = [];
      const result = autoGenerate(plan, DATA);
      const { progress } = checkAll(result.plan, DATA);
      const mr = progress.programs.find((x) => x.programId === minor.id);
      const unmet = (mr.groups || []).filter((g) => !g.complete).map((g) => `${g.id} ${g.have}/${g.need}`);
      expect(unmet, `${minor.id} unmet: ${unmet.join(', ')}`).toEqual([]);
    }, GENERATE_TIMEOUT_MS);
  }
});

describe('regressions the full sweep caught', () => {
  it('never bans a course a mandatory all_of group needs (Philosophy BA core)', () => {
    // PHIL 110 and PHIL 202 are all_of members; the retry loop used to ban them
    // as "flexible" because flexibility was inferred from the reason string.
    const { result, progress } = generateFor('major-phil-ba');
    const placed = new Set(result.plan.semesters.flatMap((s) => s.courseIds));
    for (const cid of ['PHIL 101', 'PHIL 110', 'PHIL 201', 'PHIL 202', 'PHIL 393']) {
      expect(placed.has(cid), `${cid} missing`).toBe(true);
    }
    expect(progress.programs[0].complete).toBe(true);
  }, GENERATE_TIMEOUT_MS);

  it('keeps an equivalency path that a mandatory requirement pins (ME BS needs PHYS 121)', () => {
    // intro-physics offers PHYS 113 / 121 / 141; ME's foundations group names
    // PHYS 121 outright, so resolving to another path strands the requirement.
    const { result } = generateFor('major-me-bs');
    const placed = new Set(result.plan.semesters.flatMap((s) => s.courseIds));
    expect(placed.has('PHYS 121')).toBe(true);
    expect(placed.has('PHYS 113') || placed.has('PHYS 141')).toBe(false);
  }, GENERATE_TIMEOUT_MS);

  it('commits to one sequence_one_of path instead of the union (ecoevo statistics)', () => {
    // Placing STAT 277 alone used to flip the group from "1 of [STAT 190]" to
    // "2 of [STAT 180, STAT 277]", which then could not be finished.
    const { progress } = generateFor('biol-bs-ecoevo');
    const stat = progress.programs[0].groups.find((g) => g.id === 'stat');
    expect(stat.complete, JSON.stringify(stat)).toBe(true);
  }, GENERATE_TIMEOUT_MS);

  it('the 100-level cap never empties a prerequisite group (PSC BS)', () => {
    // prereq-computing is 1 of [CSC 161, CSC 171, MATH 165] - all 100-level.
    const { result, progress } = generateFor('major-psc-bs');
    const placed = new Set(result.plan.semesters.flatMap((s) => s.courseIds));
    expect(['CSC 161', 'CSC 171', 'MATH 165'].some((c) => placed.has(c))).toBe(true);
    expect(progress.programs[0].groups.find((g) => g.id === 'prereq-computing').complete).toBe(true);
  }, GENERATE_TIMEOUT_MS);

  it('relaxes department ordering only when a degree is otherwise unschedulable', () => {
    // ME BS: 16 ME core courses in ascending order do not fit 8 alternating
    // fall/spring terms, so the advisory rule must yield to finishing the
    // degree - and must say so rather than silently dropping the rule.
    const me = generateFor('major-me-bs').result;
    expect(me.relaxedDeptOrder).toBe(true);
    expect(me.warnings.some((w) => /ascending course-number order/.test(w))).toBe(true);

    // A major that schedules fine in order must NOT be relaxed.
    const bio = generateFor('biol-ba').result;
    expect(bio.relaxedDeptOrder).toBeUndefined();
  }, GENERATE_TIMEOUT_MS);
});
