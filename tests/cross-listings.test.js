import { describe, it, expect } from 'vitest';

import coursesData from '../src/data/courses.json';
import programsData from '../src/data/programs.json';
import clustersData from '../src/data/clusters.json';
import policyData from '../src/data/policy.json';
import equivalencyGroupsData from '../src/data/equivalency_groups.json';

import { newPlan } from '../src/engine/model.js';
import { computeProgress } from '../src/engine/progress.js';
import { checkDuplicates, checkPrerequisites } from '../src/engine/constraints.js';
import { coversCourse, listingsOf } from '../src/engine/crossList.js';

const DATA = {
  courses: coursesData,
  programs: programsData,
  clusters: clustersData,
  policy: policyData,
  equivalencyGroups: equivalencyGroupsData,
};

function planWith(mods = {}) {
  const p = newPlan('test', 2026);
  return { ...p, ...mods };
}
function fill(plan, semesterIndex, courseIds) {
  plan.semesters[semesterIndex] = { ...plan.semesters[semesterIndex], courseIds };
  return plan;
}
const byRule = (vs, id) => vs.filter((x) => x.ruleId === id);

function testCourse(id, extra = {}) {
  const m = id.match(/^([A-Z]+)\s+(\d+)([A-Z]*)$/);
  return {
    id, dept: m[1], number: Number(m[2]), suffix: m[3] || '',
    title: id, credits: 4, creditsVerified: true,
    offered: ['fall'], offeredClaim: [], offeredVerified: true,
    prereqs: [], prereqsVerified: true, prereqNote: null, prereqSource: null,
    instructors: [], description: '', source: 'test', stub: false,
    crossListings: [], crossListingSource: null,
    ...extra,
  };
}

describe('catalog cross-listings', () => {
  it('groups CSC 242 with DSCC 242 and BCSC 232 (CDCS Co-Located)', () => {
    const csc = coursesData['CSC 242'];
    expect(csc).toBeTruthy();
    expect(csc.crossListings).toEqual(expect.arrayContaining(['DSCC 242', 'BCSC 232', 'CSC 442']));
    expect(csc.crossListingSource).toMatch(/CDCS Co-Located/);
    expect(listingsOf(coursesData, 'CSC 242').sort()).toEqual(
      listingsOf(coursesData, 'DSCC 242').sort(),
    );
  });

  // Stubs carry no description and no CDCS Co-Located string, so neither
  // automatic pass can see them; CROSS_LIST_OVERRIDES in build_data.py links
  // the ones an official page writes as a single listing.
  it('links stub pairs that only an official program page names together', () => {
    for (const [a, b] of [['PSCI 270', 'INTR 270'], ['LING 248', 'CSC 248']]) {
      expect(coursesData[a].crossListings, a).toContain(b);
      expect(coursesData[b].crossListings, b).toContain(a);
      expect(coursesData[a].crossListingSource, a).toMatch(/official program page/);
    }
  });

  it('never links a W variant to its non-W sibling, which would satisfy wOnly filters', () => {
    for (const id of Object.keys(coursesData)) {
      if (!id.endsWith('W')) continue;
      const base = id.slice(0, -1).trimEnd();
      if (!coursesData[base]) continue;
      const family = listingsOf(coursesData, base);
      if (!family.includes(id)) continue;
      // Families CDCS itself co-locates (INTR 270 with INTR 270W since 2025)
      // are the registrar's word; otherwise the manual override list must
      // never be what joins a W variant to its sibling.
      const source = coursesData[base].crossListingSource || '';
      if (/CDCS Co-Located/.test(source)) continue;
      expect(source, `${base} + ${id}`).not.toMatch(/official program page/);
    }
  });

  it('does not lump independent-study 391s into one family', () => {
    const indep = Object.values(coursesData).filter((c) =>
      !c.stub && /independent (study|research)/i.test(c.title || ''));
    expect(indep.length).toBeGreaterThan(10);
    for (const c of indep) {
      expect((c.crossListings || []).length).toBeLessThan(8);
    }
    const csc391 = coursesData['CSC 391'];
    if (csc391) {
      expect(csc391.crossListings || []).not.toContain('BIOL 391');
      expect(csc391.crossListings || []).not.toContain('HIST 391');
    }
  });
});

describe('checkDuplicates treats listings as one course', () => {
  it('still flags the same code twice without catalog data', () => {
    const plan = planWith();
    fill(plan, 0, ['CSC 171']);
    fill(plan, 2, ['CSC 171']);
    expect(byRule(checkDuplicates(plan), 'DUPLICATE_COURSE').length).toBe(1);
  });

  it('flags CSC 242 and DSCC 242 on the same plan', () => {
    const plan = planWith();
    fill(plan, 0, ['CSC 242']);
    fill(plan, 1, ['DSCC 242']);
    const vs = byRule(checkDuplicates(plan, DATA), 'DUPLICATE_COURSE');
    expect(vs.length).toBe(1);
    expect(vs[0].message).toMatch(/cross-listed/i);
  });
});

describe('prerequisites accept a cross-listed alias', () => {
  it('counts DSCC 242 as CSC 242 when a later course requires CSC 242', () => {
    const data = {
      ...DATA,
      courses: {
        ...DATA.courses,
        'FAKE 999': testCourse('FAKE 999', {
          prereqs: [['CSC 242']],
          prereqsVerified: true,
        }),
      },
    };
    const plan = planWith();
    fill(plan, 0, ['DSCC 242']);
    fill(plan, 1, ['FAKE 999']);
    expect(checkPrerequisites(plan, data).filter((v) => v.courseId === 'FAKE 999')).toEqual([]);
  });

  it('still flags a missing CSC 242 when no listing is placed', () => {
    const data = {
      ...DATA,
      courses: {
        ...DATA.courses,
        'FAKE 999': testCourse('FAKE 999', {
          prereqs: [['CSC 242']],
          prereqsVerified: true,
        }),
      },
    };
    const plan = fill(planWith(), 0, ['FAKE 999']);
    expect(byRule(checkPrerequisites(plan, data), 'PREREQ_ORDER').length).toBe(1);
  });
});

describe('progress treats listings as one course', () => {
  it('completes CS BS core CSC 242 when DSCC 242 is placed', () => {
    const plan = fill(planWith({ majorIds: ['major-csc-bs'] }), 0, ['DSCC 242']);
    const prog = computeProgress(plan, DATA);
    const core = prog.programs[0].groups.find((g) => g.id === 'core');
    expect(core.satisfiedBy).toContain('DSCC 242');
    expect(core.satisfiedBy).not.toContain('CSC 242');
  });

  it('does not fill two n_of slots from one listing family', () => {
    const courses = {
      'CSC 242': testCourse('CSC 242', { crossListings: ['DSCC 242'] }),
      'DSCC 242': testCourse('DSCC 242', { crossListings: ['CSC 242'] }),
      'CSC 173': testCourse('CSC 173'),
    };
    const data = {
      courses,
      programs: [{
        id: 'major-test', type: 'major', name: 'Test', degree: 'BS', status: 'ACTIVE',
        requirementGroups: [{
          id: 'pick', label: 'Pick 2',
          rule: { type: 'n_of', n: 2, options: ['CSC 242', 'DSCC 242', 'CSC 173'] },
        }],
      }],
      clusters: [],
      policy: DATA.policy,
    };
    const plan = fill(planWith({ majorIds: ['major-test'] }), 0, ['DSCC 242', 'CSC 173']);
    const g = computeProgress(plan, data).programs[0].groups[0];
    expect(g.satisfiedBy.sort()).toEqual(['CSC 173', 'DSCC 242']);
    expect(g.complete).toBe(true);
  });

  it('lets DSCC 242 count toward an n_from_filter for CSC 200+', () => {
    const courses = {
      'CSC 242': testCourse('CSC 242', { crossListings: ['DSCC 242'] }),
      'DSCC 242': testCourse('DSCC 242', { crossListings: ['CSC 242'] }),
    };
    const data = {
      courses,
      programs: [{
        id: 'major-test', type: 'major', name: 'Test', degree: 'BS', status: 'ACTIVE',
        requirementGroups: [{
          id: 'adv', label: 'CSC 200+',
          rule: { type: 'n_from_filter', n: 1, filter: { depts: ['CSC'], minNumber: 200 } },
        }],
      }],
      clusters: [],
      policy: DATA.policy,
    };
    const plan = fill(planWith({ majorIds: ['major-test'] }), 0, ['DSCC 242']);
    const g = computeProgress(plan, data).programs[0].groups[0];
    expect(g.satisfiedBy).toEqual(['DSCC 242']);
    expect(g.complete).toBe(true);
  });
});

describe('coversCourse', () => {
  it('is true when any listing of the course is in the set', () => {
    const placed = new Set(['DSCC 242']);
    expect(coversCourse(placed, 'CSC 242', coursesData)).toBe(true);
    expect(coversCourse(placed, 'CSC 171', coursesData)).toBe(false);
  });
});
