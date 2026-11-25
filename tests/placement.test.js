import { describe, it, expect } from 'vitest';
import coursesData from '../src/data/courses.json';
import programsData from '../src/data/programs.json';
import clustersData from '../src/data/clusters.json';
import policyData from '../src/data/policy.json';
import equivalencyGroupsData from '../src/data/equivalency_groups.json';

import { newPlan } from '../src/engine/model.js';
import { addCourseToSemester, semesterOptionsForCourse } from '../src/engine/placement.js';

const DATA = {
  courses: coursesData, programs: programsData, clusters: clustersData,
  policy: policyData, equivalencyGroups: equivalencyGroupsData,
};

function planWith(semesters) {
  const p = newPlan('placement', 2026);
  for (const [i, ids] of semesters.entries()) p.semesters[i].courseIds = ids;
  return p;
}

const optionFor = (res, idx, plan) => res.options.find((o) => o.semesterId === plan.semesters[idx].id);

describe('semesterOptionsForCourse', () => {
  it('lists every semester in the plan', () => {
    const plan = planWith([]);
    const { blocked, options } = semesterOptionsForCourse(plan, DATA, 'CSC 171');
    expect(blocked).toBeNull();
    expect(options).toHaveLength(plan.semesters.length);
    expect(options.every((o) => o.allowed)).toBe(true);
  });

  it('disables semesters before (and alongside) a missing prerequisite', () => {
    const plan = planWith([[], ['CSC 171']]);
    const res = semesterOptionsForCourse(plan, DATA, 'CSC 172');
    const first = optionFor(res, 0, plan);
    const same = optionFor(res, 1, plan);
    const after = optionFor(res, 2, plan);
    expect(first.allowed).toBe(false);
    expect(first.reasons.join(' ')).toMatch(/Needs CSC 171 in an earlier semester/);
    expect(same.allowed).toBe(false);
    expect(same.reasons.join(' ')).toMatch(/same semester/);
    expect(after.allowed).toBe(true);
  });

  it('counts transfer credit as an earlier prerequisite', () => {
    const plan = planWith([]);
    plan.transfer = [{ courseId: 'CSC 171', kind: 'ap' }];
    const res = semesterOptionsForCourse(plan, DATA, 'CSC 172');
    expect(optionFor(res, 0, plan).allowed).toBe(true);
  });

  it('disables terms the course is not offered in', () => {
    const plan = planWith([]);
    const res = semesterOptionsForCourse(plan, DATA, 'BIOL 110'); // spring only
    for (const o of res.options) {
      expect(o.allowed).toBe(o.term === 'spring');
      if (o.term === 'fall') expect(o.reasons.join(' ')).toMatch(/Not offered in fall \(runs spring\)/);
    }
  });

  it('blocks the whole plan when the course is already placed', () => {
    const plan = planWith([['CSC 171']]);
    const res = semesterOptionsForCourse(plan, DATA, 'CSC 171');
    expect(res.blocked).toMatch(/already on your plan/);
    expect(res.options.every((o) => !o.allowed)).toBe(true);
  });

  it('notes an overload without blocking it', () => {
    const plan = planWith([['CSC 171', 'MATH 161', 'WRTG 105', 'PHYS 121']]);
    const res = semesterOptionsForCourse(plan, DATA, 'BIOL 205');
    const fall = optionFor(res, 0, plan);
    expect(fall.notes.join(' ')).toMatch(/overload/);
  });
});

describe('addCourseToSemester', () => {
  it('places the course in the chosen semester and locks it', () => {
    const plan = planWith([['CSC 171']]);
    const { plan: next, error } = addCourseToSemester(plan, DATA, 'CSC 172', plan.semesters[1].id);
    expect(error).toBeNull();
    expect(next.semesters[1].courseIds).toContain('CSC 172');
    expect(next.courseMeta['CSC 172']).toMatchObject({ locked: true, source: 'manual' });
    expect(plan.semesters[1].courseIds).not.toContain('CSC 172'); // original untouched
  });

  it('refuses a semester without the prerequisite', () => {
    const plan = planWith([]);
    const { plan: next, error } = addCourseToSemester(plan, DATA, 'CSC 172', plan.semesters[0].id);
    expect(error).toMatch(/can't go in Fall 2026/);
    expect(next).toBe(plan);
  });

  it('refuses a term the course is not offered in', () => {
    const plan = planWith([]);
    const { error } = addCourseToSemester(plan, DATA, 'BIOL 110', plan.semesters[0].id);
    expect(error).toMatch(/Not offered in fall/);
  });

  it('refuses a course already on the plan', () => {
    const plan = planWith([['CSC 171']]);
    const { error } = addCourseToSemester(plan, DATA, 'CSC 171', plan.semesters[1].id);
    expect(error).toMatch(/already on your plan/);
  });
});
