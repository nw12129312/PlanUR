// Every requirement group must be able to explain how it can be satisfied,
// and must do so ACCURATELY. The audit rail reuses the visual language of the
// equivalency block, but only equivalency groups are mutually exclusive — an
// ordinary n_of elective lets you mix freely. Wording that implies otherwise
// would tell students their degree has constraints it does not have.
import { describe, it, expect } from 'vitest';
import coursesData from '../src/data/courses.json';
import programsData from '../src/data/programs.json';
import { describeRequirement, describeFilter } from '../src/engine/requirementOptions.js';

const DATA = { courses: coursesData };

const allGroups = () => {
  const out = [];
  for (const p of programsData.filter((x) => x.status === 'ACTIVE')) {
    for (const g of p.requirementGroups || []) out.push({ p, g });
    if (p.upperLevelWriting?.rule) out.push({ p, g: { id: '__ulw', rule: p.upperLevelWriting.rule } });
  }
  return out;
};

describe('describeRequirement covers every active requirement group', () => {
  it('produces a non-empty summary for all of them', () => {
    const bad = allGroups()
      .map(({ p, g }) => ({ p: p.id, g: g.id, d: describeRequirement(g, DATA) }))
      .filter((x) => !x.d.summary || x.d.kind === 'none');
    expect(bad, JSON.stringify(bad.slice(0, 5))).toEqual([]);
  });

  it('never implies mixing is blocked — that is only true of equivalency groups', () => {
    const forbidden = /blocked|mutually exclusive|cannot combine|only one path/i;
    const offenders = allGroups()
      .map(({ p, g }) => ({ p: p.id, g: g.id, s: describeRequirement(g, DATA).summary }))
      .filter((x) => forbidden.test(x.s));
    expect(offenders, JSON.stringify(offenders.slice(0, 5))).toEqual([]);
  });

  it('every choice group exposes something to choose between', () => {
    const empty = allGroups()
      .map(({ p, g }) => ({ p: p.id, g: g.id, d: describeRequirement(g, DATA) }))
      .filter((x) => x.d.choice && x.d.kind !== 'filter' && x.d.kind !== 'breadth'
        && !(x.d.options?.length > 1) && !(x.d.sets?.length > 1));
    expect(empty, JSON.stringify(empty.slice(0, 5))).toEqual([]);
  });
});

describe('choice semantics per rule type', () => {
  it('an n_of whose options do not exceed n is required, not a choice', () => {
    const d = describeRequirement({ rule: { type: 'n_of', n: 2, options: ['A 1', 'A 2'] } }, DATA);
    expect(d.choice).toBe(false);
    expect(d.summary).toBe('All 2 required');
  });

  it('a real n_of reports the ratio', () => {
    const d = describeRequirement({ rule: { type: 'n_of', n: 2, options: ['A 1', 'A 2', 'A 3'] } }, DATA);
    expect(d.choice).toBe(true);
    expect(d.summary).toBe('Choose 2 of 3');
    expect(d.options).toHaveLength(3);
  });

  it('all_of is never a choice', () => {
    const d = describeRequirement({ rule: { type: 'all_of', courses: ['A 1', 'A 2'] } }, DATA);
    expect(d.choice).toBe(false);
    expect(d.kind).toBe('all');
  });

  it('sequence_one_of keeps each sequence as a named set', () => {
    const d = describeRequirement({ rule: { type: 'sequence_one_of',
      sequences: [['MATH 161', 'MATH 162'], ['MATH 141', 'MATH 142', 'MATH 143']] } }, DATA);
    expect(d.kind).toBe('sequence');
    expect(d.summary).toBe('Complete ONE of 2 sequences');
    expect(d.sets.map((s) => s.name)).toEqual(['MATH 161 → MATH 162', 'MATH 141 → MATH 143']);
  });

  it('track_n_of says the courses must come from a single track', () => {
    const d = describeRequirement({ rule: { type: 'track_n_of', n: 3,
      tracks: { Alpha: ['A 1', 'A 2', 'A 3'], Beta: ['B 1', 'B 2', 'B 3'] } } }, DATA);
    expect(d.summary).toBe('3 courses — all from ONE of 2 tracks');
    expect(d.sets).toHaveLength(2);
  });

  it('n_from_filter counts the real matches instead of listing them', () => {
    const d = describeRequirement({ rule: { type: 'n_from_filter', n: 2,
      filter: { depts: ['BIOL'], minNumber: 200, maxNumber: 399 } } }, DATA);
    expect(d.kind).toBe('filter');
    expect(d.total).toBeGreaterThan(0);
    expect(d.summary).toMatch(/^Choose 2 of \d+ matching courses$/);
    expect(d.options).toBeUndefined();   // must not enumerate hundreds of courses
  });
});

describe('describeFilter reads as English', () => {
  it('names departments and a number range', () => {
    expect(describeFilter({ depts: ['BIOL'], minNumber: 200, maxNumber: 399 }))
      .toBe('any BIOL course, numbered 200-399');
  });
  it('collapses long department lists', () => {
    expect(describeFilter({ depts: ['A', 'B', 'C', 'D'] })).toBe('any course from 4 departments');
  });
  it('mentions credits and the W designation', () => {
    expect(describeFilter({ depts: ['ENGL'], minCredits: 4, wOnly: true }))
      .toBe('any ENGL course, 4+ credits, W-designated only');
  });
  it('handles a filter with no department restriction', () => {
    expect(describeFilter({ minNumber: 100, maxNumber: 399 })).toBe('any course, numbered 100-399');
  });
});
