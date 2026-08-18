import { describe, it, expect } from 'vitest';
import coursesData from '../src/data/courses.json';
import programsData from '../src/data/programs.json';
import clustersData from '../src/data/clusters.json';
import policyData from '../src/data/policy.json';
import equivalencyGroupsData from '../src/data/equivalency_groups.json';

import { newPlan } from '../src/engine/model.js';
import { autoGenerate } from '../src/engine/autogen.js';
import { diffPlans, applyOps, opKey } from '../src/ui/AutoGen.jsx';

const DATA = { courses: coursesData, programs: programsData, clusters: clustersData, policy: policyData, equivalencyGroups: equivalencyGroupsData };

function basePlan() {
  const p = newPlan('diff', 2026);
  p.majorIds = ['major-csc-bs'];
  p.semesters[0].courseIds = ['CSC 171'];
  p.semesters[2].courseIds = ['MATH 150'];
  p.courseMeta = {
    'CSC 171': { source: 'manual', locked: true, reason: null },
    'MATH 150': { source: 'auto', locked: false, reason: 'old reason' },
  };
  return p;
}

describe('diffPlans / applyOps', () => {
  const base = basePlan();
  const result = autoGenerate(base, DATA);
  const ops = diffPlans(base, result.plan);

  it('classifies adds, moves, and removes', () => {
    expect(ops.some((o) => o.type === 'add')).toBe(true);
    // locked CSC 171 must never appear as removed or moved
    expect(ops.filter((o) => o.cid === 'CSC 171')).toEqual([]);
    for (const o of ops) expect(['add', 'move', 'remove']).toContain(o.type);
  });

  it('applying every op reproduces the generated plan exactly', () => {
    const applied = applyOps(base, result.plan, ops, new Set(ops.map(opKey)));
    const flat = (p) => p.semesters.map((s) => [s.id, [...s.courseIds].sort()]);
    expect(flat(applied)).toEqual(flat(result.plan));
    // metadata for auto-placed courses carried over
    const anyAdd = ops.find((o) => o.type === 'add');
    expect(applied.courseMeta[anyAdd.cid].source).toBe('auto');
    expect(applied.courseMeta[anyAdd.cid].reason).toBeTruthy();
  });

  it('applying a subset only performs the selected changes', () => {
    const adds = ops.filter((o) => o.type === 'add');
    const chosen = new Set([opKey(adds[0])]);
    const applied = applyOps(base, result.plan, ops, chosen);
    const placed = applied.semesters.flatMap((s) => s.courseIds);
    expect(placed).toContain(adds[0].cid);
    expect(placed).not.toContain(adds[1].cid);
    expect(placed).toContain('CSC 171'); // untouched
  });

  it('rejecting all changes leaves the base plan intact', () => {
    const applied = applyOps(base, result.plan, ops, new Set());
    expect(applied.semesters.map((s) => s.courseIds)).toEqual(base.semesters.map((s) => s.courseIds));
  });
});
