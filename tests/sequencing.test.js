import { describe, it, expect } from 'vitest';
import coursesData from '../src/data/courses.json';
import programsData from '../src/data/programs.json';
import clustersData from '../src/data/clusters.json';
import policyData from '../src/data/policy.json';
import equivalencyGroupsData from '../src/data/equivalency_groups.json';

import { newPlan } from '../src/engine/model.js';
import { autoGenerate } from '../src/engine/autogen.js';
import { checkAll, checkPrerequisites } from '../src/engine/constraints.js';

const DATA = { courses: coursesData, programs: programsData, clusters: clustersData, policy: policyData, equivalencyGroups: equivalencyGroupsData };

const byRule = (vs, id) => vs.filter((x) => x.ruleId === id);

function plan(mods = {}) { return { ...newPlan('seq', 2026), ...mods }; }
function fill(p, i, ids) { p.semesters[i] = { ...p.semesters[i], courseIds: ids }; return p; }

describe('course order is prerequisite-driven, not department numbering', () => {
  it('does not flag a lower-numbered course after a higher-numbered same-dept course', () => {
    const p = plan();
    fill(p, 2, ['BIOL 250']);
    fill(p, 3, ['BIOL 111L']);
    const { violations } = checkAll(p, DATA);
    expect(byRule(violations, 'DEPT_SEQUENCING')).toEqual([]);
    expect(byRule(violations, 'DEPT_SEQ_UNPARSEABLE')).toEqual([]);
  });

  it('still flags a course scheduled before its prerequisite', () => {
    const p = plan();
    fill(p, 0, ['CSC 172']);
    fill(p, 1, ['CSC 171']);
    const vs = byRule(checkPrerequisites(p, DATA), 'PREREQ_ORDER');
    expect(vs.length).toBeGreaterThan(0);
    expect(vs[0].courseId).toBe('CSC 172');
  });

  it('introductoryScore is gone from the course model', () => {
    expect(Object.values(coursesData).some((c) => 'introductoryScore' in c)).toBe(false);
  });
});

describe('auto-generate without department numbering', () => {
  it('still completes the Biology BA', () => {
    const p = plan({ majorIds: ['biol-ba'], clusterIds: ['H1ENG015', 'S1ASL001'] });
    const result = autoGenerate(p, DATA);
    const { progress, violations } = checkAll(result.plan, DATA);
    expect(progress.programs[0].complete,
      JSON.stringify(result.infeasible, null, 1)).toBe(true);
    expect(violations.filter((v) => v.severity === 'error')).toEqual([]);
    expect(result.relaxedDeptOrder).toBeUndefined();
  }, 20000);

  it('completes CS BS with zero errors', () => {
    const p = plan({ majorIds: ['major-csc-bs'], clusterIds: ['H1ENG015', 'S1ASL001'] });
    const result = autoGenerate(p, DATA);
    const { violations } = checkAll(result.plan, DATA);
    expect(violations.filter((v) => v.severity === 'error'),
      JSON.stringify(result.infeasible, null, 1)).toEqual([]);
  }, 20000);
});
