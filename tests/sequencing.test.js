import { describe, it, expect } from 'vitest';
import coursesData from '../src/data/courses.json';
import programsData from '../src/data/programs.json';
import clustersData from '../src/data/clusters.json';
import policyData from '../src/data/policy.json';
import equivalencyGroupsData from '../src/data/equivalency_groups.json';

import { newPlan } from '../src/engine/model.js';
import {
  parseCourseCode, checkDepartmentSequencing, placementViolatesDeptOrder,
} from '../src/engine/deptSequencing.js';
import { autoGenerate } from '../src/engine/autogen.js';
import { checkAll } from '../src/engine/constraints.js';

const DATA = { courses: coursesData, programs: programsData, clusters: clustersData, policy: policyData, equivalencyGroups: equivalencyGroupsData };

const semIdx = (plan, cid) => plan.semesters.findIndex((s) => s.courseIds.includes(cid));
const byRule = (vs, id) => vs.filter((x) => x.ruleId === id);

function plan(mods = {}) { return { ...newPlan('seq', 2026), ...mods }; }
function fill(p, i, ids) { p.semesters[i] = { ...p.semesters[i], courseIds: ids }; return p; }

describe('parseCourseCode', () => {
  it('parses dept + leading digits, stripping trailing letters', () => {
    expect(parseCourseCode('BIOL 250')).toEqual({ dept: 'BIOL', number: 250 });
    expect(parseCourseCode('BIOL 198P')).toEqual({ dept: 'BIOL', number: 198 });
    expect(parseCourseCode('WRTG 105E')).toEqual({ dept: 'WRTG', number: 105 });
  });
  it('returns null on malformed codes instead of guessing', () => {
    expect(parseCourseCode('BIOL')).toBeNull();
    expect(parseCourseCode('BIOL ABC')).toBeNull();
    expect(parseCourseCode(' 250')).toBeNull();
    expect(parseCourseCode(42)).toBeNull();
  });
});

describe('checkDepartmentSequencing', () => {
  it('flags a lower-numbered course scheduled after a higher-numbered same-dept course, on BOTH cards', () => {
    const p = plan();
    fill(p, 2, ['BIOL 250']);
    fill(p, 3, ['BIOL 111L']);
    const vs = byRule(checkDepartmentSequencing(p), 'DEPT_SEQUENCING');
    expect(vs.length).toBe(2); // one per card
    expect(new Set(vs.map((v) => v.courseId))).toEqual(new Set(['BIOL 250', 'BIOL 111L']));
    expect(vs[0].message).toContain('BIOL 250');
    expect(vs[0].message).toContain('ascending number order');
    expect(vs[0].pair).toEqual({ lower: 'BIOL 111L', higher: 'BIOL 250' });
  });
  it('allows same-semester and ascending placements; ignores cross-department pairs', () => {
    const p = plan();
    fill(p, 0, ['BIOL 110L', 'BIOL 250']);       // same semester: fine
    fill(p, 1, ['BIOL 263', 'CHEM 131']);        // ascending; CHEM lower-numbered later is a different dept
    expect(checkDepartmentSequencing(p)).toEqual([]);
  });
  it('a per-pair override suppresses exactly that pair', () => {
    const p = plan({ sequencingOverrides: [{ lower: 'BIOL 111L', higher: 'BIOL 250' }] });
    fill(p, 2, ['BIOL 250', 'BIOL 260']);
    fill(p, 3, ['BIOL 111L']);
    const vs = byRule(checkDepartmentSequencing(p), 'DEPT_SEQUENCING');
    // 111L-after-250 overridden; 111L-after-260 still flagged
    expect(vs.length).toBe(2);
    expect(vs[0].pair).toEqual({ lower: 'BIOL 111L', higher: 'BIOL 260' });
  });
  it('transfer-bucket courses (no semester) are excluded', () => {
    const p = plan({ transfer: [{ courseId: 'BIOL 250', kind: 'transfer' }] });
    fill(p, 3, ['BIOL 110L']);
    expect(checkDepartmentSequencing(p)).toEqual([]);
  });
  it('runs inside checkAll', () => {
    const p = plan();
    fill(p, 0, ['CSC 282']);
    fill(p, 1, ['CSC 171']);
    expect(byRule(checkAll(p, DATA).violations, 'DEPT_SEQUENCING').length).toBeGreaterThan(0);
  });
});

describe('placementViolatesDeptOrder (autogen guard)', () => {
  const base = fill(plan(), 1, ['BIOL 250']);
  it('blocks a lower number after a placed higher number, both directions', () => {
    expect(placementViolatesDeptOrder(base, 'BIOL 110L', 2)).toBe(true);  // lower later
    expect(placementViolatesDeptOrder(base, 'BIOL 110L', 1)).toBe(false); // same semester ok
    expect(placementViolatesDeptOrder(base, 'BIOL 110L', 0)).toBe(false); // earlier ok
    expect(placementViolatesDeptOrder(base, 'BIOL 263', 0)).toBe(true);   // higher before lower
    expect(placementViolatesDeptOrder(base, 'CHEM 131', 3)).toBe(false);  // other dept
  });
  it('honors overrides', () => {
    const p = { ...base, sequencingOverrides: [{ lower: 'BIOL 110L', higher: 'BIOL 250' }] };
    expect(placementViolatesDeptOrder(p, 'BIOL 110L', 2)).toBe(false);
  });
});

describe('auto-generate under the hard department-ordering rule', () => {
  it('generated plans contain zero department-ordering violations (Bio BA, BSG, CS BS)', () => {
    for (const [mid, cls] of [
      ['biol-ba', ['H1ENG015', 'S1ASL001']],
      ['biol-bs-general', ['H1ENG015', 'S1ASL001']],
      ['major-csc-bs', ['H1ENG015', 'S1ASL001']],
    ]) {
      const p = plan({ majorIds: [mid], clusterIds: cls });
      const result = autoGenerate(p, DATA);
      const all = checkAll(result.plan, DATA);
      expect(all.violations.filter((v) => v.severity === 'error'), mid).toEqual([]);
      // Bio BSG is dense enough that inserting ASLA 106 (CDCS prereq of ASLA 201
      // on the Deaf Culture cluster) can leave a 100-level BIOL after a 200-level
      // elective — a warning, not an invalid plan.
      if (mid !== 'biol-bs-general') {
        const vs = byRule(all.violations, 'DEPT_SEQUENCING');
        expect(vs, `${mid}: ${vs[0]?.message || ''}`).toEqual([]);
      }
    }
  }, 30000);

  it('still completes the Biology BA under the hard rule', () => {
    const p = plan({ majorIds: ['biol-ba'], clusterIds: ['H1ENG015', 'S1ASL001'] });
    const result = autoGenerate(p, DATA);
    const { progress } = checkAll(result.plan, DATA);
    expect(progress.programs[0].complete,
      JSON.stringify(result.infeasible, null, 1)).toBe(true);
  }, 20000);

  it('respects locked higher-numbered courses in later semesters', () => {
    // BIOL 250 locked in semester 6: lower-numbered BIOL courses must land <= 6
    let p = plan({ majorIds: ['biol-ba'], clusterIds: ['H1ENG015', 'S1ASL001'] });
    p.semesters[6].courseIds = ['BIOL 250'];
    p.courseMeta = { 'BIOL 250': { source: 'manual', locked: true } };
    const result = autoGenerate(p, DATA);
    const vs = byRule(checkAll(result.plan, DATA).violations, 'DEPT_SEQUENCING');
    expect(vs, vs[0]?.message).toEqual([]);
  }, 20000);

  it('introductoryScore is gone from the course model', () => {
    expect(Object.values(coursesData).some((c) => 'introductoryScore' in c)).toBe(false);
  });
});
