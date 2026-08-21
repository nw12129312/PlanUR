import { describe, it, expect } from 'vitest';
import coursesData from '../src/data/courses.json';
import programsData from '../src/data/programs.json';
import clustersData from '../src/data/clusters.json';
import policyData from '../src/data/policy.json';
import equivalencyGroupsData from '../src/data/equivalency_groups.json';

import { newPlan, plannedCourseIds, semesterIndexOf } from '../src/engine/model.js';
import { computeProgress } from '../src/engine/progress.js';
import { checkPrerequisites } from '../src/engine/constraints.js';
import { checkEquivalencyConflicts } from '../src/engine/equivalency.js';
import { describeOptionAction, applyRequirementOption, placeCourseWithPrereqs, relocateCourseRespectingPrereqs } from '../src/engine/swapRequirement.js';

const DATA = {
  courses: coursesData, programs: programsData, clusters: clustersData,
  policy: policyData, equivalencyGroups: equivalencyGroupsData,
};

function planWith(semesters) {
  const p = newPlan('swap', 2026);
  p.majorIds = ['major-csc-bs'];
  for (const [i, ids] of semesters.entries()) p.semesters[i].courseIds = ids;
  return p;
}

const calculus = () => DATA.programs.find((p) => p.id === 'major-csc-bs')
  .requirementGroups.find((g) => g.id === 'calculus').rule;

const stats = () => DATA.programs.find((p) => p.id === 'major-csc-bs')
  .requirementGroups.find((g) => g.id === 'stat').rule;

describe('describeOptionAction', () => {
  it('adds when the group still has an open slot', () => {
    expect(describeOptionAction({ satisfiedBy: [], need: 1, have: 0 }, stats(), 'STAT 190').kind).toBe('add');
  });

  it('swaps when an n_of group is already filled', () => {
    const a = describeOptionAction({ satisfiedBy: ['STAT 190'], need: 1, have: 1 }, stats(), 'ECON 230');
    expect(a.kind).toBe('swap');
    expect(a.outgoing).toEqual(['STAT 190']);
    expect(a.incoming).toEqual(['ECON 230']);
  });

  it('treats an alternate calculus sequence as a set swap', () => {
    const group = { satisfiedBy: ['MATH 161', 'MATH 162'], need: 2, have: 2, complete: true };
    const a = describeOptionAction(group, calculus(), 'MATH 141');
    expect(a.kind).toBe('swap');
    expect(a.outgoing).toEqual(['MATH 161', 'MATH 162']);
    expect(a.incoming).toEqual(['MATH 141', 'MATH 142', 'MATH 143']);
  });

  it('adds the rest of the same sequence instead of swapping', () => {
    const group = { satisfiedBy: ['MATH 161'], need: 2, have: 1, complete: false };
    const a = describeOptionAction(group, calculus(), 'MATH 162');
    expect(a.kind).toBe('add');
    expect(a.outgoing).toEqual([]);
  });
});

describe('applyRequirementOption', () => {
  it('leaves the plan alone for a plain add', () => {
    const plan = planWith([]);
    const result = applyRequirementOption(plan, DATA, {
      programId: 'major-csc-bs', groupId: 'stat', courseId: 'STAT 190',
    });
    expect(result.kind).toBe('add');
    expect(result.plan).toBeUndefined();
  });

  it('swaps MATH 161+162 for the three-course 14x sequence across semesters', () => {
    const plan = planWith([['MATH 161'], ['MATH 162']]);
    const result = applyRequirementOption(plan, DATA, {
      programId: 'major-csc-bs', groupId: 'calculus', courseId: 'MATH 141',
    });
    expect(result.kind).toBe('swap');
    expect(result.outgoing).toEqual(['MATH 161', 'MATH 162']);
    expect(plannedCourseIds(result.plan)).toEqual(['MATH 141', 'MATH 142', 'MATH 143']);
    expect(semesterIndexOf(result.plan, 'MATH 141')).toBe(0);
    expect(semesterIndexOf(result.plan, 'MATH 142')).toBe(1);
    expect(semesterIndexOf(result.plan, 'MATH 143')).toBe(2);
    expect(checkPrerequisites(result.plan, DATA).filter((v) => v.severity === 'error')).toEqual([]);
    expect(checkEquivalencyConflicts(result.plan, DATA.equivalencyGroups)).toEqual([]);
  });

  it('swaps the 14x sequence back down to MATH 161+162', () => {
    const plan = planWith([['MATH 141'], ['MATH 142'], ['MATH 143']]);
    const result = applyRequirementOption(plan, DATA, {
      programId: 'major-csc-bs', groupId: 'calculus', courseId: 'MATH 161',
    });
    expect(result.kind).toBe('swap');
    expect(plannedCourseIds(result.plan)).toEqual(['MATH 161', 'MATH 162']);
    expect(semesterIndexOf(result.plan, 'MATH 161')).toBe(0);
    expect(semesterIndexOf(result.plan, 'MATH 162')).toBe(1);
  });

  it('places MATH 171 in a fall term when swapping from 16x', () => {
    const plan = planWith([['MATH 161'], ['MATH 162']]);
    const result = applyRequirementOption(plan, DATA, {
      programId: 'major-csc-bs', groupId: 'calculus', courseId: 'MATH 171',
    });
    expect(result.kind).toBe('swap');
    expect(plannedCourseIds(result.plan)).toEqual(['MATH 171', 'MATH 172']);
    expect(result.plan.semesters[semesterIndexOf(result.plan, 'MATH 171')].term).toBe('fall');
    expect(result.plan.semesters[semesterIndexOf(result.plan, 'MATH 172')].term).toBe('spring');
  });

  it('replaces one n_of option with another', () => {
    const plan = planWith([['STAT 190']]);
    const result = applyRequirementOption(plan, DATA, {
      programId: 'major-csc-bs', groupId: 'stat', courseId: 'ECON 230',
    });
    expect(result.kind).toBe('swap');
    expect(plannedCourseIds(result.plan)).toEqual(['ECON 230']);
    const g = computeProgress(result.plan, DATA).programs[0].groups.find((x) => x.id === 'stat');
    expect(g.satisfiedBy).toEqual(['ECON 230']);
  });

  it('inserts prerequisite courses when the replacement cannot stand alone', () => {
    const plan = planWith([['MATH 165']]);
    const result = applyRequirementOption(plan, DATA, {
      programId: 'major-csc-bs', groupId: 'linear', courseId: 'MATH 173',
    });
    expect(result.kind).toBe('swap');
    expect(result.outgoing).toEqual(['MATH 165']);
    expect(plannedCourseIds(result.plan)).toContain('MATH 173');
    expect(result.prereqsAdded).toEqual(['MATH 171', 'MATH 172']);
    expect(semesterIndexOf(result.plan, 'MATH 171'))
      .toBeLessThan(semesterIndexOf(result.plan, 'MATH 172'));
    expect(semesterIndexOf(result.plan, 'MATH 172'))
      .toBeLessThan(semesterIndexOf(result.plan, 'MATH 173'));
    expect(checkPrerequisites(result.plan, DATA).filter((v) => v.severity === 'error')).toEqual([]);
  });
});

describe('placeCourseWithPrereqs (CDCS ordering)', () => {
  it('inserts CSC 172 and MATH 150 before CSC 252', () => {
    const plan = planWith([]);
    const result = placeCourseWithPrereqs(plan, DATA, 'CSC 252');
    expect(result.error).toBeNull();
    expect(result.prereqsAdded).toEqual(expect.arrayContaining(['CSC 172', 'MATH 150']));
    expect(semesterIndexOf(result.plan, 'CSC 172'))
      .toBeLessThan(semesterIndexOf(result.plan, 'CSC 252'));
    expect(semesterIndexOf(result.plan, 'MATH 150'))
      .toBeLessThan(semesterIndexOf(result.plan, 'CSC 252'));
    expect(checkPrerequisites(result.plan, DATA).filter((v) => v.severity === 'error')).toEqual([]);
  });

  it('inserts a calculus I course before STAT 190', () => {
    const plan = planWith([]);
    const result = placeCourseWithPrereqs(plan, DATA, 'STAT 190');
    expect(result.error).toBeNull();
    const calc = ['MATH 141', 'MATH 161', 'MATH 171'];
    expect(result.prereqsAdded.some((c) => calc.includes(c))).toBe(true);
    const calcIdx = Math.min(...calc.map((c) => semesterIndexOf(result.plan, c)).filter((i) => i >= 0));
    expect(calcIdx).toBeLessThan(semesterIndexOf(result.plan, 'STAT 190'));
  });

  it('snaps a drag that would land before a CDCS prerequisite', () => {
    const plan = planWith([['CSC 171'], ['CSC 172', 'MATH 150'], ['CSC 252']]);
    const fall1 = plan.semesters[0].id;
    const result = relocateCourseRespectingPrereqs(plan, DATA, 'CSC 252', fall1);
    expect(result.error).toBeNull();
    expect(semesterIndexOf(result.plan, 'CSC 252'))
      .toBeGreaterThan(semesterIndexOf(result.plan, 'CSC 172'));
  });
});
