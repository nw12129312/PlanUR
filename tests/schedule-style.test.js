import { describe, it, expect } from 'vitest';
import coursesData from '../src/data/courses.json';
import programsData from '../src/data/programs.json';
import clustersData from '../src/data/clusters.json';
import policyData from '../src/data/policy.json';
import equivalencyGroupsData from '../src/data/equivalency_groups.json';

import {
  SCHEDULE_STYLES, styleScore, deptDivisionIndex, majorDepartments,
  withScheduleStyle, styleOf,
} from '../src/engine/scheduleStyle.js';
import { newPlan } from '../src/engine/model.js';

const DATA = {
  courses: coursesData, programs: programsData, clusters: clustersData,
  policy: policyData, equivalencyGroups: equivalencyGroupsData,
};

describe('schedule style scoring', () => {
  const divIndex = deptDivisionIndex(DATA);
  const plan = { ...newPlan('style', 2026), majorIds: ['major-csc-bs'] };
  const majorDepts = majorDepartments(plan, DATA);
  const ctx = (style, semesterIds) => ({ style, semesterIds, majorDepts, divIndex, data: DATA });

  it('lists mixed, subject-block, and major-first styles', () => {
    expect(SCHEDULE_STYLES.map((s) => s.id)).toEqual(['balanced', 'focused', 'frontload-major']);
  });

  it('mixed style prefers a humanities course once a science is already in the term', () => {
    const mixed = ctx('balanced', ['CSC 171']);
    expect(styleScore('ENGL 121', mixed)).toBeLessThan(styleScore('CSC 172', mixed));
  });

  it('subject-block style prefers another CSC course once CSC is already in the term', () => {
    const pack = ctx('focused', ['CSC 171']);
    expect(styleScore('CSC 172', pack)).toBeLessThan(styleScore('ENGL 121', pack));
  });

  it('major-first style prefers CSC over a cluster course', () => {
    const first = ctx('frontload-major', []);
    expect(styleScore('CSC 171', first)).toBeLessThan(styleScore('ENGL 121', first));
  });

  it('persists the choice on the plan', () => {
    const next = withScheduleStyle(plan, 'focused');
    expect(styleOf(next)).toBe('focused');
    expect(styleOf(withScheduleStyle(plan, 'nope'))).toBe('balanced');
  });
});
