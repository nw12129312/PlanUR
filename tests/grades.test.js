import { describe, it, expect } from 'vitest';
import coursesData from '../src/data/courses.json';
import programsData from '../src/data/programs.json';
import clustersData from '../src/data/clusters.json';
import policyData from '../src/data/policy.json';
import equivalencyGroupsData from '../src/data/equivalency_groups.json';

import { newPlan } from '../src/engine/model.js';
import { computeProgress } from '../src/engine/progress.js';
import { checkAll, checkGrades, checkTotalCredits } from '../src/engine/constraints.js';
import { computeRemovable } from '../src/engine/autogen.js';
import {
  GRADE_POINTS, creditsByStatus, cumulativeGpa, earnsNoCredit, getCourseGrade, getCourseStatus,
  gpaFor, programGpa, termGpa, withCourseGrade, withCourseStatus,
} from '../src/engine/grades.js';

const DATA = { courses: coursesData, programs: programsData, clusters: clustersData, policy: policyData, equivalencyGroups: equivalencyGroupsData };
const byRule = (vs, id) => vs.filter((x) => x.ruleId === id);

function plan(mods = {}) {
  return { ...newPlan('grades', 2025), ...mods };
}
function fill(p, i, ids) {
  p.semesters[i] = { ...p.semesters[i], courseIds: ids };
  return p;
}
function graded(p, grades) {
  let next = p;
  for (const [cid, g] of Object.entries(grades)) next = withCourseGrade(next, cid, g);
  return next;
}

describe('course status', () => {
  it('defaults to planned, and transfer credit reads as completed', () => {
    const p = fill(plan({ transfer: [{ courseId: 'MATH 141', kind: 'ap' }] }), 0, ['CSC 171']);
    expect(getCourseStatus(p, 'CSC 171')).toBe('planned');
    expect(getCourseStatus(p, 'MATH 141')).toBe('completed');
  });

  it('marking completed or in progress locks the course; planned drops the grade', () => {
    let p = fill(plan(), 0, ['CSC 171']);
    p.courseMeta = { 'CSC 171': { source: 'auto', locked: false, reason: 'x' } };
    p = withCourseStatus(p, 'CSC 171', 'in_progress');
    expect(p.courseMeta['CSC 171']).toMatchObject({ status: 'in_progress', locked: true, source: 'auto' });
    p = withCourseGrade(p, 'CSC 171', 'B+');
    expect(getCourseStatus(p, 'CSC 171')).toBe('completed');
    expect(getCourseGrade(p, 'CSC 171')).toBe('B+');
    p = withCourseStatus(p, 'CSC 171', 'planned');
    expect(getCourseStatus(p, 'CSC 171')).toBe('planned');
    expect(getCourseGrade(p, 'CSC 171')).toBeNull();
  });

  it('rejects unknown statuses and grades', () => {
    const p = fill(plan(), 0, ['CSC 171']);
    expect(withCourseStatus(p, 'CSC 171', 'done')).toBe(p);
    expect(withCourseGrade(p, 'CSC 171', 'A+')).toBe(p);
  });

  it('auto-generate never removes completed or in-progress courses, even unlocked', () => {
    let p = fill(plan(), 0, ['CSC 171', 'MATH 161', 'WRTG 105']);
    p.courseMeta = {
      'CSC 171': { source: 'auto', locked: false },
      'MATH 161': { source: 'auto', locked: false },
      'WRTG 105': { source: 'auto', locked: false },
    };
    p = withCourseStatus(p, 'CSC 171', 'completed');
    p = withCourseStatus(p, 'MATH 161', 'in_progress');
    p.courseMeta['CSC 171'].locked = false;
    p.courseMeta['MATH 161'].locked = false;
    const removable = computeRemovable(p, DATA, { kind: 'all' });
    expect([...removable]).toEqual(['WRTG 105']);
  });

  it('splits credit hours by status', () => {
    let p = fill(plan(), 0, ['CSC 171', 'MATH 161']);
    fill(p, 1, ['CSC 172']);
    p = withCourseStatus(p, 'CSC 171', 'completed');
    p = withCourseStatus(p, 'MATH 161', 'in_progress');
    const s = creditsByStatus(p, DATA);
    expect(s.completed).toBe(DATA.courses['CSC 171'].credits);
    expect(s.in_progress).toBe(DATA.courses['MATH 161'].credits);
    expect(s.planned).toBe(DATA.courses['CSC 172'].credits);
  });
});

describe('GPA', () => {
  it('uses the UR College grade-point scale', () => {
    expect(GRADE_POINTS).toMatchObject({ 'A': 4, 'A-': 3.7, 'B+': 3.3, 'C': 2, 'D-': 0.7, 'E': 0 });
  });

  it('credit-weights letter grades and ignores P/S/W, planned courses and transfer', () => {
    let p = fill(plan({ transfer: [{ courseId: 'MATH 141', kind: 'transfer' }] }), 0,
      ['CSC 171', 'MATH 161', 'WRTG 105', 'CSC 172']);
    p = graded(p, { 'CSC 171': 'A', 'MATH 161': 'B', 'WRTG 105': 'P' });
    // CSC 172 stays planned; MATH 141 is transfer.
    const c = (id) => DATA.courses[id].credits;
    const expected = (4 * c('CSC 171') + 3 * c('MATH 161')) / (c('CSC 171') + c('MATH 161'));
    const r = cumulativeGpa(p, DATA);
    expect(r.gpa).toBeCloseTo(expected, 3);
    expect(r.graded.sort()).toEqual(['CSC 171', 'MATH 161']);
  });

  it('counts failing letter grades in the GPA', () => {
    const p = graded(fill(plan(), 0, ['CSC 171', 'MATH 161']), { 'CSC 171': 'A', 'MATH 161': 'E' });
    const r = gpaFor(p, DATA, ['CSC 171', 'MATH 161']);
    expect(r.gpa).toBeLessThan(4);
    expect(r.graded.length).toBe(2);
  });

  it('is null with no grades, and per term', () => {
    let p = fill(plan(), 0, ['CSC 171']);
    fill(p, 1, ['CSC 172']);
    expect(cumulativeGpa(p, DATA).gpa).toBeNull();
    p = graded(p, { 'CSC 171': 'A-', 'CSC 172': 'C' });
    expect(termGpa(p, DATA, p.semesters[0]).gpa).toBe(3.7);
    expect(termGpa(p, DATA, p.semesters[1]).gpa).toBe(2);
  });
});

describe('no-credit grades', () => {
  it('a failed course earns no credit and stops filling requirements', () => {
    let p = fill(plan({ majorIds: ['biol-ba'] }), 0, ['BIOL 110L']);
    const before = computeProgress(p, DATA).programs[0];
    expect(before.groups.find((g) => g.id === 'intro').satisfiedBy).toContain('BIOL 110L');

    p = withCourseGrade(p, 'BIOL 110L', 'E');
    expect(earnsNoCredit(p, 'BIOL 110L')).toBe(true);
    const after = computeProgress(p, DATA).programs[0];
    expect(after.groups.find((g) => g.id === 'intro').satisfiedBy).not.toContain('BIOL 110L');
    expect(byRule(checkGrades(p, DATA), 'GRADE_NO_CREDIT').length).toBe(1);
  });

  it('W and I earn no credit toward total hours; P does', () => {
    let p = fill(plan(), 0, ['CSC 171', 'MATH 161', 'WRTG 105']);
    p = graded(p, { 'CSC 171': 'W', 'MATH 161': 'I', 'WRTG 105': 'P' });
    const msg = checkTotalCredits(p, DATA).find((v) => v.ruleId === 'TOTAL_CREDITS').message;
    expect(msg.startsWith(`${DATA.courses['WRTG 105'].credits} of`)).toBe(true);
  });
});

describe('major GPA minimum (minMajorGPA)', () => {
  const bio = programsData.find((x) => x.id === 'biol-ba');

  it('is encoded on the Biology programs', () => {
    expect(bio.minMajorGPA).toBe(2.0);
  });

  it('no grades, no flags', () => {
    const p = fill(plan({ majorIds: ['biol-ba'] }), 0, ['BIOL 110L', 'BIOL 111L']);
    expect(checkGrades(p, DATA)).toEqual([]);
  });

  it('warns while the major is in progress and excludes ancillary groups', () => {
    let p = fill(plan({ majorIds: ['biol-ba'] }), 0, ['BIOL 110L', 'BIOL 111L', 'CHEM 131']);
    // Strong chemistry (ancillary) must not lift the in-major GPA.
    p = graded(p, { 'BIOL 110L': 'D', 'BIOL 111L': 'C-', 'CHEM 131': 'A' });
    const r = computeProgress(p, DATA).programs[0];
    const g = programGpa(p, DATA, bio, r);
    expect(g.courseIds).not.toContain('CHEM 131');
    expect(g.gpa).toBeLessThan(2);

    const hits = byRule(checkGrades(p, DATA), 'MAJOR_GPA_MIN');
    expect(hits.length).toBe(1);
    expect(hits[0].severity).toBe('warning');
    expect(hits[0].programId).toBe('biol-ba');
  });

  it('passes at or above the minimum', () => {
    let p = fill(plan({ majorIds: ['biol-ba'] }), 0, ['BIOL 110L', 'BIOL 111L']);
    p = graded(p, { 'BIOL 110L': 'C', 'BIOL 111L': 'C' });
    expect(byRule(checkGrades(p, DATA), 'MAJOR_GPA_MIN')).toEqual([]);
  });

  it('cumulative GPA below 2.0 warns, and checkAll includes grade checks', () => {
    let p = fill(plan(), 0, ['CSC 171', 'MATH 161']);
    p = graded(p, { 'CSC 171': 'D', 'MATH 161': 'C-' });
    expect(byRule(checkAll(p, DATA).violations, 'CUMULATIVE_GPA_MIN').length).toBe(1);
  });
});
