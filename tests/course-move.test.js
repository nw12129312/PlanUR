import { describe, it, expect } from 'vitest';
import coursesData from '../src/data/courses.json';
import programsData from '../src/data/programs.json';
import clustersData from '../src/data/clusters.json';
import policyData from '../src/data/policy.json';
import equivalencyGroupsData from '../src/data/equivalency_groups.json';

import { newPlan, semesterIndexOf } from '../src/engine/model.js';
import { swapPlacedCourses, moveCourseToSemester, placementWarnings } from '../src/engine/courseMove.js';

const DATA = {
  courses: coursesData, programs: programsData, clusters: clustersData,
  policy: policyData, equivalencyGroups: equivalencyGroupsData,
};

function planWith(semesters) {
  const p = newPlan('move', 2026);
  for (const [i, ids] of semesters.entries()) p.semesters[i].courseIds = ids;
  return p;
}

describe('swapPlacedCourses', () => {
  it('exchanges courses across semesters (MATH 161 ↔ MATH 150)', () => {
    const plan = planWith([['MATH 150', 'CSC 171'], ['MATH 161', 'CSC 172']]);
    const next = swapPlacedCourses(plan, 'MATH 161', 'MATH 150');
    expect(plan.semesters[0].courseIds).toEqual(['MATH 150', 'CSC 171']); // original untouched
    expect(next.semesters[0].courseIds).toEqual(['MATH 161', 'CSC 171']);
    expect(next.semesters[1].courseIds).toEqual(['MATH 150', 'CSC 172']);
  });

  it('exchanges positions inside the same semester', () => {
    const plan = planWith([['CSC 171', 'MATH 150', 'WRTG 105']]);
    const next = swapPlacedCourses(plan, 'CSC 171', 'WRTG 105');
    expect(next.semesters[0].courseIds).toEqual(['WRTG 105', 'MATH 150', 'CSC 171']);
  });

  it('is a no-op when either course is missing', () => {
    const plan = planWith([['CSC 171']]);
    expect(swapPlacedCourses(plan, 'CSC 171', 'MATH 150')).toBe(plan);
  });
});

describe('moveCourseToSemester', () => {
  it('appends to the target semester without swapping occupants', () => {
    const plan = planWith([['MATH 150', 'CSC 171'], ['MATH 161']]);
    const next = moveCourseToSemester(plan, 'MATH 161', plan.semesters[0].id);
    expect(next.semesters[0].courseIds).toEqual(['MATH 150', 'CSC 171', 'MATH 161']);
    expect(next.semesters[1].courseIds).toEqual([]);
  });

  it('places a new course at the end of the semester', () => {
    const plan = planWith([['CSC 171']]);
    const next = moveCourseToSemester(plan, 'MATH 150', plan.semesters[0].id);
    expect(next.semesters[0].courseIds).toEqual(['CSC 171', 'MATH 150']);
  });
});

describe('placementWarnings', () => {
  it('warns when a swap puts a course before its prerequisite', () => {
    const plan = planWith([['CSC 171'], ['CSC 172']]);
    const next = swapPlacedCourses(plan, 'CSC 172', 'CSC 171');
    expect(semesterIndexOf(next, 'CSC 172')).toBe(0);
    const hits = placementWarnings(next, DATA, ['CSC 172', 'CSC 171']);
    expect(hits.some((v) => v.ruleId === 'PREREQ_ORDER')).toBe(true);
  });

  it('warns when a move lands in a term the course did not run', () => {
    const plan = planWith([['BIOL 110L'], []]); // fall-only course
    const next = moveCourseToSemester(plan, 'BIOL 110L', plan.semesters[1].id);
    const hits = placementWarnings(next, DATA, ['BIOL 110L'], [plan.semesters[1].id]);
    expect(hits.some((v) => v.ruleId === 'OFFERING_TERM')).toBe(true);
  });

  it('is silent for a legal swap of unrelated courses', () => {
    const plan = planWith([['CSC 171'], ['WRTG 105']]);
    const next = swapPlacedCourses(plan, 'WRTG 105', 'CSC 171');
    expect(placementWarnings(next, DATA, ['CSC 171', 'WRTG 105'])).toEqual([]);
  });
});
