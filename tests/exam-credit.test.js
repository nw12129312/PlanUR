import { describe, it, expect } from 'vitest';
import examCredit from '../src/data/exam_credit.json';
import {
  applyRecordedExams, examById, previewExamAdd, resolveExamCredit,
  transferCreditGroups, upsertRecordedExam,
} from '../src/engine/examCredit.js';
import { newPlan } from '../src/engine/model.js';

describe('CCAS exam credit table', () => {
  it('only auto-awards named UR courses from the handbook', () => {
    expect(examCredit.sourceUrl).toContain('ccas/handbook/ap.html');
    expect(examById(examCredit, 'ap-csa').awards[0].courses).toEqual(['CSC 171']);
    expect(examById(examCredit, 'ap-bio').awards).toBeUndefined();
    expect(examById(examCredit, 'ap-engl-lang').note).toMatch(/No credit/i);
  });
});

describe('resolveExamCredit', () => {
  it('maps AP Computer Science A 5 to CSC 171', () => {
    const { courses } = resolveExamCredit(examCredit, [{ examId: 'ap-csa', score: 5 }]);
    expect(courses.map((c) => c.courseId)).toEqual(['CSC 171']);
    expect(courses[0].kind).toBe('ap');
  });

  it('maps Calculus BC 5 to MATH 161 and MATH 162, and BC 3 to MATH 161 only', () => {
    expect(resolveExamCredit(examCredit, [{ examId: 'ap-calc-bc', score: 5 }]).courses.map((c) => c.courseId))
      .toEqual(['MATH 161', 'MATH 162']);
    expect(resolveExamCredit(examCredit, [{ examId: 'ap-calc-bc', score: 3 }]).courses.map((c) => c.courseId))
      .toEqual(['MATH 161']);
  });

  it('maps Calculus AB 4+ to MATH 161 and not a 3', () => {
    expect(resolveExamCredit(examCredit, [{ examId: 'ap-calc-ab', score: 4 }]).courses.map((c) => c.courseId))
      .toEqual(['MATH 161']);
    expect(resolveExamCredit(examCredit, [{ examId: 'ap-calc-ab', score: 3 }]).courses).toEqual([]);
  });

  it('maps Chemistry 4 to CHEM 131', () => {
    expect(resolveExamCredit(examCredit, [{ examId: 'ap-chem', score: 4 }]).courses.map((c) => c.courseId))
      .toEqual(['CHEM 131']);
  });

  it('does not invent a biology lecture for AP Biology 5', () => {
    expect(resolveExamCredit(examCredit, [{ examId: 'ap-bio', score: 5 }]).courses).toEqual([]);
  });

  it('awards ECON 108 only when micro and macro scores both qualify', () => {
    const micro = { examId: 'ap-econ-micro', score: 5 };
    const macro = { examId: 'ap-econ-macro', score: 3 };
    expect(resolveExamCredit(examCredit, [micro]).courses).toEqual([]);
    expect(resolveExamCredit(examCredit, [macro]).courses).toEqual([]);
    expect(resolveExamCredit(examCredit, [micro, macro]).courses.map((c) => c.courseId)).toEqual(['ECON 108']);
  });

  it('requires a PHYS 113 vs 121 choice for Physics C Mechanics', () => {
    expect(resolveExamCredit(examCredit, [{ examId: 'ap-phys-c-mech', score: 5 }]).courses).toEqual([]);
    expect(resolveExamCredit(examCredit, [{ examId: 'ap-phys-c-mech', score: 5, choice: 'PHYS 121' }]).courses.map((c) => c.courseId))
      .toEqual(['PHYS 121']);
  });

  it('maps IB Computer Science HL 5+ and A-Level CS grade A to CSC 171', () => {
    expect(resolveExamCredit(examCredit, [{ examId: 'ib-cs-hl', score: 5 }]).courses[0]).toMatchObject({ courseId: 'CSC 171', kind: 'ib' });
    expect(resolveExamCredit(examCredit, [{ examId: 'alevel-cs', score: 'A' }]).courses[0]).toMatchObject({ courseId: 'CSC 171', kind: 'transfer' });
  });
});

describe('applyRecordedExams', () => {
  it('lists awarded courses in the transfer bucket and keeps manual rows', () => {
    const plan = newPlan('ap', 2026);
    plan.transfer = [{ courseId: 'HIST 101', kind: 'transfer' }];
    const next = applyRecordedExams(plan, examCredit, [{ examId: 'ap-csa', score: 5 }]);
    expect(next.transfer.map((t) => t.courseId).sort()).toEqual(['CSC 171', 'HIST 101']);
    expect(next.transfer.find((t) => t.courseId === 'CSC 171').examId).toBe('ap-csa');
  });
});

describe('previewExamAdd', () => {
  it('tells the student ECON 108 still needs the other exam', () => {
    const preview = previewExamAdd(examCredit, [], 'ap-econ-micro', 5);
    expect(preview.newCourses).toEqual([]);
    expect(preview.pendingCombo.missing.map((e) => e.id)).toEqual(['ap-econ-macro']);
  });
});

describe('transferCreditGroups', () => {
  it('labels Calculus BC with both course codes', () => {
    const plan = applyRecordedExams(newPlan('g', 2026), examCredit, [{ examId: 'ap-calc-bc', score: 5 }]);
    const groups = transferCreditGroups(plan, examCredit);
    expect(groups[0].title).toMatch(/Calculus BC \(5\)/);
    expect(groups[0].courses.map((c) => c.courseId)).toEqual(['MATH 161', 'MATH 162']);
  });
});

describe('upsertRecordedExam', () => {
  it('replaces the score for the same exam', () => {
    const once = upsertRecordedExam([], { examId: 'ap-csa', score: 4 });
    const twice = upsertRecordedExam(once, { examId: 'ap-csa', score: 5 });
    expect(twice).toEqual([{ examId: 'ap-csa', score: 5 }]);
  });
});
