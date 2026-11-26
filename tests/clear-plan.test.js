import { describe, it, expect } from 'vitest';
import { newPlan, clearedPlan, isPlanEmpty, addSummerSemester } from '../src/engine/model.js';

describe('clearing a plan', () => {
  const full = () => {
    let p = newPlan('Spring plan', 2024);
    p = {
      ...p,
      majorIds: ['m1'], minorIds: ['n1'], clusterIds: ['c1'],
      transfer: [{ courseId: 'MATH 161', kind: 'ap' }],
      transferExams: [{ examId: 'calc-bc', score: 5 }],
      courseMeta: { 'CSC 171': { source: 'manual', locked: true, status: 'completed', grade: 'A' } },
      trackChoices: { m1: { g1: 'Track A' } },
      preferences: { scheduleStyle: 'front-loaded' },
    };
    p.semesters[0].courseIds = ['CSC 171'];
    return addSummerSemester(p, 2025);
  };

  it('wipes programs, courses, credit and grades', () => {
    const c = clearedPlan(full());
    expect(isPlanEmpty(c)).toBe(true);
    expect(c.transfer).toEqual([]);
    expect(c.transferExams).toEqual([]);
    expect(c.courseMeta).toEqual({});
    expect(c.trackChoices).toEqual({});
    expect(c.semesters).toHaveLength(8);
    expect(c.semesters.some((s) => s.term === 'summer')).toBe(false);
  });

  it('keeps the plan id, name, start year and schedule style', () => {
    const p = full();
    const c = clearedPlan(p);
    expect(c.id).toBe(p.id);
    expect(c.name).toBe('Spring plan');
    expect(c.createdAt).toBe(p.createdAt);
    expect(c.semesters[0].label).toBe('Fall 2024');
    expect(c.preferences.scheduleStyle).toBe('front-loaded');
  });

  it('knows when there is nothing to clear', () => {
    expect(isPlanEmpty(newPlan('x'))).toBe(true);
    expect(isPlanEmpty(full())).toBe(false);
  });
});
