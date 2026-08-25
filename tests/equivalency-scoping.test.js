// The search rail's "choose one path" block must reflect the SELECTED
// programs. It used to filter by search RESULTS, and since the unfiltered
// result set is just the first 400 catalog courses, MATH 141 was always in it
// — so every plan was shown the calculus sequence no matter what it had
// selected. These tests pin the scoping.
import { describe, it, expect } from 'vitest';
import coursesData from '../src/data/courses.json';
import programsData from '../src/data/programs.json';
import equivalencyGroupsData from '../src/data/equivalency_groups.json';

import { namedCandidates, groupCandidates } from '../src/engine/candidates.js';
import { groupsForCourseSet } from '../src/engine/equivalency.js';

const DATA = { courses: coursesData, programs: programsData, equivalencyGroups: equivalencyGroupsData };

// Mirrors CourseSearch's selectableCourseIds for a single program.
function namedCourseIds(program) {
  const s = new Set();
  for (const g of program.requirementGroups || []) {
    for (const cid of namedCandidates(g, DATA)) s.add(cid);
  }
  if (program.upperLevelWriting?.rule) {
    for (const cid of namedCandidates({ rule: program.upperLevelWriting.rule }, DATA)) s.add(cid);
  }
  return s;
}

const groupsFor = (programId) => {
  const p = programsData.find((x) => x.id === programId);
  expect(p, `${programId} exists`).toBeTruthy();
  return groupsForCourseSet(equivalencyGroupsData, namedCourseIds(p)).map((g) => g.id);
};

describe('equivalency blocks are scoped to the selected program', () => {
  it('shows nothing when no program is selected', () => {
    expect(groupsForCourseSet(equivalencyGroupsData, new Set())).toEqual([]);
  });

  it('CS BS depends on calculus, intro CS, and intro statistics', () => {
    expect(groupsFor('major-csc-bs')).toEqual(['calc-sequence', 'intro-cs', 'intro-statistics']);
  });

  it('Biology BA depends on the biology and organic-chemistry sequences', () => {
    const ids = groupsFor('biol-ba');
    expect(ids).toContain('intro-biology');
    expect(ids).toContain('orgo-sequence');
  });

  it('humanities majors that name no alternatives show no block', () => {
    for (const id of ['major-engl-ba', 'major-hist-ba', 'major-musc-ba']) {
      expect(groupsFor(id), id).toEqual([]);
    }
  });

  it('different majors do not all get the same block', () => {
    const cs = groupsFor('major-csc-bs').join(',');
    const bio = groupsFor('biol-ba').join(',');
    const engl = groupsFor('major-engl-ba').join(',');
    expect(new Set([cs, bio, engl]).size).toBe(3);
  });

  it('a broad n_from_filter elective does not imply dependence on a sequence', () => {
    // ME BS has natural-science electives that sweep whole departments, so
    // groupCandidates would drag in biology and organic chemistry. Only the
    // courses ME actually NAMES should scope the block.
    const me = programsData.find((p) => p.id === 'major-me-bs');
    const named = groupsForCourseSet(equivalencyGroupsData, namedCourseIds(me)).map((g) => g.id);
    expect(named).not.toContain('intro-biology');
    expect(named).not.toContain('orgo-sequence');

    const broad = new Set();
    for (const g of me.requirementGroups || []) for (const c of groupCandidates(g, DATA)) broad.add(c);
    const withFilters = groupsForCourseSet(equivalencyGroupsData, broad).map((g) => g.id);
    expect(withFilters.length).toBeGreaterThan(named.length);
  });

  it('namedCandidates ignores n_from_filter but keeps explicit lists', () => {
    const filterRule = { rule: { type: 'n_from_filter', n: 2, filter: { depts: ['BIOL'] } } };
    expect(namedCandidates(filterRule, DATA)).toEqual([]);
    expect(groupCandidates(filterRule, DATA).length).toBeGreaterThan(0);

    const listRule = { rule: { type: 'n_of', n: 1, options: ['MATH 141', 'MATH 161'] } };
    expect(namedCandidates(listRule, DATA)).toEqual(['MATH 141', 'MATH 161']);
  });
});
