import { describe, it, expect } from 'vitest';
import coursesData from '../src/data/courses.json';
import programsData from '../src/data/programs.json';
import clustersData from '../src/data/clusters.json';
import policyData from '../src/data/policy.json';
import equivalencyGroupsData from '../src/data/equivalency_groups.json';

import { newPlan } from '../src/engine/model.js';
import { checkDivisionalCoverage, divisionalCoverageForPlan } from '../src/engine/coverage.js';

const DATA = { courses: coursesData, programs: programsData, clusters: clustersData, policy: policyData, equivalencyGroups: equivalencyGroupsData };

const plan = (majorIds = [], minorIds = [], clusterIds = []) =>
  ({ ...newPlan('cov', 2026), majorIds, minorIds, clusterIds });

const HUM_CLUSTER = clustersData.find((c) => c.division === 'humanities').id;
const SS_CLUSTER = clustersData.find((c) => c.division === 'social-sciences').id;
const NS_CLUSTER = clustersData.find((c) => c.division === 'natural-sciences').id;

describe('checkDivisionalCoverage (pure, spec signature)', () => {
  it('reports covered and missing divisions from program objects', () => {
    const r = checkDivisionalCoverage([
      { division: 'natural-sciences' }, { division: 'social-sciences' },
    ]);
    expect(r.satisfied).toBe(false);
    expect(r.missingDivisions).toEqual(['humanities']);
    expect(r.coveredDivisions).toEqual(['social-sciences', 'natural-sciences']);
  });
  it('is satisfied when all three divisions appear', () => {
    const r = checkDivisionalCoverage([
      { division: 'humanities' }, { division: 'social-sciences' }, { division: 'natural-sciences' },
    ]);
    expect(r.satisfied).toBe(true);
    expect(r.missingDivisions).toEqual([]);
  });
  it('does NOT count engineering as natural sciences (NEEDS_VERIFICATION stance)', () => {
    const r = checkDivisionalCoverage([
      { division: 'engineering' }, { division: 'humanities' }, { division: 'social-sciences' },
    ]);
    expect(r.satisfied).toBe(false);
    expect(r.missingDivisions).toEqual(['natural-sciences']);
    expect(r.coveredDivisions).toContain('engineering');
  });
});

describe('divisionalCoverageForPlan (applicability + message)', () => {
  it('is not applicable with no selections or a single standalone program', () => {
    expect(divisionalCoverageForPlan(plan(), DATA).applicable).toBe(false);
    expect(divisionalCoverageForPlan(plan(['major-csc-bs']), DATA).applicable).toBe(false);
    // a cluster alone is not a combination either (no major yet)
    expect(divisionalCoverageForPlan(plan([], [], [HUM_CLUSTER]), DATA).applicable).toBe(false);
    expect(divisionalCoverageForPlan(plan(['major-csc-bs']), DATA).message).toBeNull();
  });

  it('applies once a major plus one more program is selected', () => {
    const r = divisionalCoverageForPlan(plan(['major-csc-bs'], ['minor-csc']), DATA);
    expect(r.applicable).toBe(true);
    expect(r.satisfied).toBe(false);
    expect(r.missingDivisions.sort()).toEqual(['humanities', 'social-sciences']);
    expect(r.message).toContain('Computer Science BS major');
    expect(r.message).toContain('Computer Science minor');
    expect(r.message).toContain('generally expects');
  });

  it('names the single missing division in the message', () => {
    // CS BS (natural sciences) + Economics BA (social sciences): humanities missing
    const r = divisionalCoverageForPlan(plan(['major-csc-bs', 'major-econ-ba']), DATA);
    expect(r.applicable).toBe(true);
    expect(r.missingDivisions).toEqual(['humanities']);
    expect(r.message).toContain("don't include a Humanities program");
  });

  it('is satisfied by any combination shape covering all three divisions', () => {
    // major + 2 clusters
    const a = divisionalCoverageForPlan(plan(['major-csc-bs'], [], [HUM_CLUSTER, SS_CLUSTER]), DATA);
    expect(a.satisfied).toBe(true);
    expect(a.message).toBeNull();
    // double major + 1 cluster
    const b = divisionalCoverageForPlan(plan(['major-csc-bs', 'major-econ-ba'], [], [HUM_CLUSTER]), DATA);
    expect(b.satisfied).toBe(true);
    // major + minor + 1 cluster (minor supplies a division no cluster covers)
    const c = divisionalCoverageForPlan(plan(['major-hist-ba'], ['minor-csc'], [SS_CLUSTER]), DATA);
    expect(c.satisfied).toBe(true);
  });

  it('flags the engineering/natural-sciences question in the message', () => {
    // ME (engineering) + humanities cluster + social-sciences cluster:
    // natural sciences missing unless engineering counts - which is unverified.
    const r = divisionalCoverageForPlan(plan(['major-me-bs'], [], [HUM_CLUSTER, SS_CLUSTER]), DATA);
    expect(r.applicable).toBe(true);
    expect(r.satisfied).toBe(false);
    expect(r.missingDivisions).toEqual(['natural-sciences']);
    expect(r.message).toContain('unverified');
  });

  it('comboKey changes when selections change (drives re-acknowledgment)', () => {
    const a = divisionalCoverageForPlan(plan(['major-csc-bs'], ['minor-csc']), DATA);
    const b = divisionalCoverageForPlan(plan(['major-csc-bs'], ['minor-csc'], [HUM_CLUSTER]), DATA);
    expect(a.comboKey).not.toBe(b.comboKey);
    const a2 = divisionalCoverageForPlan(plan(['major-csc-bs'], ['minor-csc']), DATA);
    expect(a.comboKey).toBe(a2.comboKey);
  });

  it('placeholder programs still contribute their division', () => {
    // Chemical Engineering placeholder (engineering) + English BA (humanities)
    const r = divisionalCoverageForPlan(plan(['major-che-bs', 'major-engl-ba']), DATA);
    expect(r.applicable).toBe(true);
    expect(r.coveredDivisions).toContain('engineering');
    expect(r.coveredDivisions).toContain('humanities');
  });
});
