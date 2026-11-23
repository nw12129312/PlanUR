import { describe, it, expect } from 'vitest';
import coursesData from '../src/data/courses.json';
import programsData from '../src/data/programs.json';
import clustersData from '../src/data/clusters.json';
import policyData from '../src/data/policy.json';
import equivalencyGroupsData from '../src/data/equivalency_groups.json';

import { newPlan } from '../src/engine/model.js';
import { computeProgress } from '../src/engine/progress.js';
import { checkClusterRules } from '../src/engine/constraints.js';
import { closestClusters, closestPrograms, whatIfPlan, whatIfProgress } from '../src/engine/whatIf.js';

const DATA = { courses: coursesData, programs: programsData, clusters: clustersData, policy: policyData, equivalencyGroups: equivalencyGroupsData };

function csPlan() {
  const p = newPlan('what-if', 2025);
  p.majorIds = ['major-csc-bs'];
  p.semesters[0].courseIds = ['CSC 171', 'MATH 161', 'WRTG 105', 'ECON 108'];
  p.semesters[1].courseIds = ['CSC 172', 'MATH 162', 'PSYC 101', 'ECON 207'];
  p.semesters[2].courseIds = ['CSC 173', 'MATH 165', 'PHIL 101'];
  return p;
}

describe('whatIfProgress', () => {
  it('never changes the plan it is given', () => {
    const p = csPlan();
    const before = JSON.stringify(p);
    whatIfProgress(p, DATA, 'major-math-ba');
    closestPrograms(p, DATA);
    closestClusters(p, DATA);
    expect(JSON.stringify(p)).toBe(before);
  });

  it('matches the real audit for the hypothetical plan', () => {
    const p = csPlan();
    const r = whatIfProgress(p, DATA, 'major-math-ba', 'replace');
    const real = computeProgress({ ...p, majorIds: ['major-math-ba'] }, DATA)
      .programs.find((x) => x.programId === 'major-math-ba');
    expect(r.percent).toBe(real.percent);
    expect(r.needsData).toBe(false);
    expect(r.countedCourseIds).toEqual(expect.arrayContaining(['MATH 161', 'MATH 162']));
    expect(r.remaining).toBeGreaterThan(0);
    expect(r.groupsDone).toBeLessThan(r.groupsTotal);
  });

  it('replace swaps the majors; add keeps the current one', () => {
    const p = csPlan();
    const math = programsData.find((x) => x.id === 'major-math-ba');
    expect(whatIfPlan(p, math, 'replace').majorIds).toEqual(['major-math-ba']);
    expect(whatIfPlan(p, math, 'add').majorIds).toEqual(['major-csc-bs', 'major-math-ba']);
    const minor = programsData.find((x) => x.id === 'minor-math');
    expect(whatIfPlan(p, minor, 'add')).toMatchObject({ majorIds: ['major-csc-bs'], minorIds: ['minor-math'] });
  });

  it('returns null for an unknown program', () => {
    expect(whatIfProgress(csPlan(), DATA, 'nope')).toBeNull();
  });
});

describe('closestPrograms', () => {
  it('ranks minors by courses left and skips the major\'s own department', () => {
    const list = closestPrograms(csPlan(), DATA, { type: 'minor', limit: 10 });
    expect(list.length).toBeGreaterThan(0);
    expect(list.map((m) => m.program.id)).not.toContain('minor-csc');
    for (let i = 1; i < list.length; i++) expect(list[i].remaining).toBeGreaterThanOrEqual(list[i - 1].remaining);
    expect(list.every((m) => m.countedCourseIds.length > 0)).toBe(true);
  });

  it('leaves out programs already on the plan', () => {
    const p = { ...csPlan(), minorIds: ['minor-math'] };
    expect(closestPrograms(p, DATA, { limit: 50 }).map((m) => m.program.id)).not.toContain('minor-math');
  });

  it('returns nothing for an empty plan', () => {
    expect(closestPrograms(newPlan('x', 2025), DATA)).toEqual([]);
  });
});

describe('closestClusters', () => {
  it('only suggests clusters the major allows, ranked by courses left', () => {
    const p = csPlan();
    const list = closestClusters(p, DATA, { limit: 10 });
    expect(list.length).toBeGreaterThan(0);
    for (const c of list) {
      const hypo = { ...p, clusterIds: [c.cluster.id] };
      const errs = checkClusterRules(hypo, DATA, computeProgress(hypo, DATA))
        .filter((v) => v.clusterId === c.cluster.id
          && (v.ruleId === 'CLUSTER_DIVISION' || v.ruleId === 'CLUSTER_OWN_DEPT'));
      expect(errs).toEqual([]);
    }
    for (let i = 1; i < list.length; i++) expect(list[i].remaining).toBeGreaterThanOrEqual(list[i - 1].remaining);
  });

  it('an economics-heavy plan puts an economics cluster near the top', () => {
    const top = closestClusters(csPlan(), DATA, { limit: 3 }).map((c) => c.cluster.name);
    expect(top.some((n) => /Economics/.test(n))).toBe(true);
  });
});
