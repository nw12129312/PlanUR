import { describe, it, expect } from 'vitest';
import coursesData from '../src/data/courses.json';
import programsData from '../src/data/programs.json';
import clustersData from '../src/data/clusters.json';
import policyData from '../src/data/policy.json';
import equivalencyGroupsData from '../src/data/equivalency_groups.json';

import { newPlan, withCourseMeta } from '../src/engine/model.js';
import {
  checkEquivalencyConflicts, conflictForAdd, consistentPaths, levelSatisfied,
} from '../src/engine/equivalency.js';
import { checkPrerequisites, checkAll } from '../src/engine/constraints.js';
import { autoGenerate } from '../src/engine/autogen.js';

const DATA = {
  courses: coursesData, programs: programsData, clusters: clustersData,
  policy: policyData, equivalencyGroups: equivalencyGroupsData,
};
const CALC = equivalencyGroupsData.find((g) => g.id === 'calc-sequence');

function planWith(mods = {}) {
  return { ...newPlan('eq', 2026), ...mods };
}
function fill(plan, i, courseIds) {
  plan.semesters[i] = { ...plan.semesters[i], courseIds };
  return plan;
}
const placed = (p) => p.semesters.flatMap((s) => s.courseIds);
const byRule = (vs, id) => vs.filter((x) => x.ruleId === id);

describe('checkEquivalencyConflicts', () => {
  it('flags courses from two different paths, once per conflicting course', () => {
    const plan = fill(planWith(), 0, ['MATH 171', 'MATH 142']);
    const vs = checkEquivalencyConflicts(plan, equivalencyGroupsData);
    expect(vs.length).toBe(2);
    expect(new Set(vs.map((v) => v.courseId))).toEqual(new Set(['MATH 171', 'MATH 142']));
    for (const v of vs) {
      expect(v.ruleId).toBe('EQUIV_CONFLICT');
      expect(v.severity).toBe('error');
      expect(v.message).toContain('Calculus sequence');
      expect(v.message).toContain('choose one path');
    }
  });
  it('is silent for courses on the same path', () => {
    expect(checkEquivalencyConflicts(fill(planWith(), 0, ['MATH 141', 'MATH 142']), equivalencyGroupsData)).toEqual([]);
    expect(checkEquivalencyConflicts(fill(planWith(), 0, ['MATH 161', 'MATH 162']), equivalencyGroupsData)).toEqual([]);
  });
  it('counts transfer credit as commitment to a path', () => {
    const plan = fill(planWith({ transfer: [{ courseId: 'MATH 141', kind: 'ap' }] }), 0, ['MATH 171']);
    expect(checkEquivalencyConflicts(plan, equivalencyGroupsData).length).toBe(2);
  });
  it('covers the intro biology group', () => {
    const plan = fill(planWith(), 0, ['BIOL 110L', 'BIOL 113L']);
    expect(checkEquivalencyConflicts(plan, equivalencyGroupsData).length).toBe(2);
  });
  it('treats CSC 161 and CSC 171 as one intro-CS path, not two courses', () => {
    const plan = fill(planWith(), 0, ['CSC 161', 'CSC 171']);
    const vs = checkEquivalencyConflicts(plan, equivalencyGroupsData);
    expect(new Set(vs.map((v) => v.courseId))).toEqual(new Set(['CSC 161', 'CSC 171']));
    for (const v of vs) {
      expect(v.ruleId).toBe('EQUIV_CONFLICT');
      expect(v.message).toContain('Introductory computer science');
    }
    expect(checkEquivalencyConflicts(fill(planWith(), 0, ['CSC 161']), equivalencyGroupsData)).toEqual([]);
    expect(checkEquivalencyConflicts(fill(planWith(), 0, ['CSC 171', 'CSC 172']), equivalencyGroupsData)).toEqual([]);
  });
  it('runs as part of checkAll (same trigger points as other checks)', () => {
    const plan = fill(planWith(), 0, ['MATH 171', 'MATH 142']);
    expect(byRule(checkAll(plan, DATA).violations, 'EQUIV_CONFLICT').length).toBe(2);
  });
});

describe('conflictForAdd (blocking manual adds)', () => {
  it('blocks a cross-path add with an actionable explanation', () => {
    const plan = fill(planWith(), 0, ['MATH 171']);
    const c = conflictForAdd(plan, 'MATH 142', equivalencyGroupsData);
    expect(c).not.toBeNull();
    expect(c.message).toContain('MATH 171');
    expect(c.message).toContain('MATH 142');
    expect(c.message).toContain('remove MATH 171');
  });
  it('allows completing the committed path and unrelated courses', () => {
    const plan = fill(planWith(), 0, ['MATH 171']);
    expect(conflictForAdd(plan, 'MATH 172', equivalencyGroupsData)).toBeNull();
    expect(conflictForAdd(plan, 'CSC 171', equivalencyGroupsData)).toBeNull();
    expect(conflictForAdd(planWith(), 'MATH 141', equivalencyGroupsData)).toBeNull();
  });
  it('blocks adding CSC 171 once CSC 161 is on the plan, and vice versa', () => {
    expect(conflictForAdd(fill(planWith(), 0, ['CSC 161']), 'CSC 171', equivalencyGroupsData)).not.toBeNull();
    expect(conflictForAdd(fill(planWith(), 0, ['CSC 171']), 'CSC 161', equivalencyGroupsData)).not.toBeNull();
    expect(conflictForAdd(fill(planWith(), 0, ['CSC 171']), 'CSC 172', equivalencyGroupsData)).toBeNull();
  });
  it('does not double-block a plan that is already conflicted', () => {
    const plan = fill(planWith(), 0, ['MATH 171', 'MATH 142']);
    expect(conflictForAdd(plan, 'MATH 143', equivalencyGroupsData)).toBeNull();
  });
});

describe('requires_level prerequisites', () => {
  const testCourse = {
    id: 'TEST 300', dept: 'TEST', number: 300, suffix: '',
    title: 'Needs completed calculus', credits: 4, creditsVerified: false,
    offered: [], offeredClaim: [], offeredVerified: false,
    prereqs: [['level:calc_sequence_complete']], prereqsVerified: true,
    prereqNote: null, prereqSource: null, description: '', source: 'test', stub: false,
  };
  const data = { ...DATA, courses: { ...coursesData, 'TEST 300': testCourse } };

  it('satisfied by the terminal course of the standard path (MATH 143)', () => {
    let plan = planWith();
    fill(plan, 0, ['MATH 141']); fill(plan, 1, ['MATH 142']); fill(plan, 2, ['MATH 143']);
    fill(plan, 3, ['TEST 300']);
    expect(checkPrerequisites(plan, data)).toEqual([]);
  });
  it('satisfied by the terminal course of the honors path', () => {
    let plan = planWith();
    fill(plan, 0, ['MATH 171']); fill(plan, 1, ['MATH 172']);
    fill(plan, 2, ['TEST 300']);
    expect(checkPrerequisites(plan, data)).toEqual([]);
  });
  it('not satisfied by a partial path, with the group named in the message', () => {
    let plan = planWith();
    fill(plan, 0, ['MATH 141']); fill(plan, 1, ['TEST 300']);
    const vs = checkPrerequisites(plan, data);
    expect(vs.length).toBe(1);
    expect(vs[0].message).toContain('Calculus sequence complete');
  });
  it('"not both": taking both paths satisfies the level but raises a conflict', () => {
    let plan = planWith();
    fill(plan, 0, ['MATH 141']);
    fill(plan, 1, ['MATH 142']);
    fill(plan, 2, ['MATH 143', 'MATH 171']);
    fill(plan, 3, ['TEST 300']);
    expect(checkPrerequisites(plan, data)).toEqual([]); // level is met
    expect(byRule(checkAll(plan, data).violations, 'EQUIV_CONFLICT').length).toBeGreaterThan(0);
  });
  it('levelSatisfied is one fulfillment per group, not per course', () => {
    expect(levelSatisfied('calc_sequence_complete', new Set(['MATH 143']), equivalencyGroupsData)).toBe(true);
    expect(levelSatisfied('calc_sequence_complete', new Set(['MATH 141', 'MATH 142']), equivalencyGroupsData)).toBe(false);
    expect(levelSatisfied('unknown_tag', new Set(['MATH 143']), equivalencyGroupsData)).toBe(false);
  });
});

describe('autoGenerate with equivalency groups', () => {
  function csPlan() {
    const p = newPlan('gen', 2026);
    p.majorIds = ['major-csc-bs'];
    p.clusterIds = ['H1ENG015', 'S1ASL001'];
    return p;
  }

  it('default preference picks one calculus path and never mixes', () => {
    const result = autoGenerate(csPlan(), DATA);
    const ids = new Set(placed(result.plan));
    expect(result.pathChoices['calc-sequence']).toBe('16x');
    expect(ids.has('MATH 161') && ids.has('MATH 162')).toBe(true);
    for (const other of ['MATH 141', 'MATH 142', 'MATH 143', 'MATH 171', 'MATH 172']) {
      expect(ids.has(other), other).toBe(false);
    }
    expect(consistentPaths(CALC, ids).size).toBeGreaterThan(0);
    const mathPl = result.placements.find((x) => x.courseId === 'MATH 161');
    expect(mathPl.reason).toContain('Calculus sequence');
    expect(mathPl.reason).toContain('MATH 161-162');
    expect(result.warnings.some((w) => w.includes('chose the MATH 161-162 path'))).toBe(true);
    expect(result.violations.filter((v) => v.severity === 'error')).toEqual([]);
  });

  it('accelerated preference selects the honors path, traceably', () => {
    const result = autoGenerate(csPlan(), DATA, { pathPreference: 'accelerated' });
    const ids = new Set(placed(result.plan));
    expect(result.pathChoices['calc-sequence']).toBe('17x');
    expect(ids.has('MATH 171') && ids.has('MATH 172')).toBe(true);
    for (const other of ['MATH 141', 'MATH 142', 'MATH 143', 'MATH 161', 'MATH 162']) {
      expect(ids.has(other), other).toBe(false);
    }
    expect(result.warnings.some((w) => w.includes('Honors (MATH 171-172)') && w.includes('accelerated preference'))).toBe(true);
    expect(result.violations.filter((v) => v.severity === 'error')).toEqual([]);
  });

  it('a locked course resolves the whole path for regeneration', () => {
    let base = csPlan();
    base.semesters[0].courseIds = ['MATH 171'];
    base = withCourseMeta(base, 'MATH 171', { source: 'manual', locked: true });
    const result = autoGenerate(base, DATA);
    const ids = new Set(placed(result.plan));
    expect(result.pathChoices['calc-sequence']).toBe('17x');
    expect(ids.has('MATH 172')).toBe(true);
    for (const other of ['MATH 141', 'MATH 142', 'MATH 143', 'MATH 161', 'MATH 162']) {
      expect(ids.has(other), other).toBe(false);
    }
    expect(result.violations.filter((v) => v.severity === 'error')).toEqual([]);
  });

  it('AP credit commits the path: AP MATH 141 leads to 142/143, never 161/171', () => {
    const base = csPlan();
    base.transfer = [{ courseId: 'MATH 141', kind: 'ap' }];
    const result = autoGenerate(base, DATA);
    const ids = new Set(placed(result.plan));
    expect(result.pathChoices['calc-sequence']).toBe('14x');
    expect(ids.has('MATH 142') && ids.has('MATH 143')).toBe(true);
    for (const other of ['MATH 161', 'MATH 162', 'MATH 171', 'MATH 172']) {
      expect(ids.has(other), other).toBe(false);
    }
    expect(result.violations.filter((v) => v.severity === 'error')).toEqual([]);
  });
});
