import { describe, it, expect } from 'vitest';
import coursesData from '../src/data/courses.json';
import programsData from '../src/data/programs.json';
import clustersData from '../src/data/clusters.json';
import policyData from '../src/data/policy.json';
import equivalencyGroupsData from '../src/data/equivalency_groups.json';

import { newPlan, getCourseMeta, withCourseMeta } from '../src/engine/model.js';
import { computeProgress } from '../src/engine/progress.js';
import { checkAll } from '../src/engine/constraints.js';
import { autoGenerate, computeRemovable } from '../src/engine/autogen.js';

const DATA = { courses: coursesData, programs: programsData, clusters: clustersData, policy: policyData, equivalencyGroups: equivalencyGroupsData };

function csPlan() {
  const p = newPlan('gen', 2026);
  p.majorIds = ['major-csc-bs'];
  p.clusterIds = ['H1ENG015', 'S1ASL001'];
  return p;
}
const allPlaced = (p) => p.semesters.flatMap((s) => s.courseIds);
const errorsOf = (vs) => vs.filter((v) => v.severity === 'error');

describe('autoGenerate: full plan from selections', () => {
  const result = autoGenerate(csPlan(), DATA);
  const { progress, violations } = checkAll(result.plan, DATA);

  it('completes the major, both clusters, and PWR', () => {
    expect(progress.programs[0].complete, JSON.stringify(result.infeasible, null, 1)).toBe(true);
    for (const cr of progress.clusters) expect(cr.complete, cr.clusterId).toBe(true);
    expect(progress.pwr.satisfied).toBe(true);
    expect(result.infeasible).toEqual([]);
  });

  it('passes its own validators (zero error-severity violations)', () => {
    expect(errorsOf(violations), JSON.stringify(errorsOf(violations), null, 1)).toEqual([]);
    expect(errorsOf(result.violations)).toEqual([]);
  });

  it('places WRTG 105 in semester 1', () => {
    expect(result.plan.semesters[0].courseIds).toContain('WRTG 105');
  });

  it('never places a verified course in a term it does not run', () => {
    result.plan.semesters.forEach((sem) => {
      for (const cid of sem.courseIds) {
        const c = coursesData[cid];
        if (c?.offeredVerified) {
          expect(c.offered, `${cid} in ${sem.label}`).toContain(sem.term);
        }
      }
    });
  });

  it('respects the credit cap and prerequisite ordering', () => {
    const seen = new Set(result.plan.transfer.map((t) => t.courseId));
    result.plan.semesters.forEach((sem) => {
      const credits = sem.courseIds.reduce((a, c) => a + (coursesData[c]?.credits ?? 4), 0);
      expect(credits).toBeLessThanOrEqual(18);
      for (const cid of sem.courseIds) {
        for (const g of coursesData[cid]?.prereqs || []) {
          expect(g.some((x) => seen.has(x)), `${cid} prereq (${g.join('|')}) in ${sem.label}`).toBe(true);
        }
      }
      sem.courseIds.forEach((c) => seen.add(c));
    });
  });

  it('orders CDCS-gated CS courses after their Public Notes prerequisites', () => {
    const idx = (cid) => {
      const i = result.plan.semesters.findIndex((s) => s.courseIds.includes(cid));
      return i;
    };
    if (idx('CSC 252') >= 0) {
      expect(idx('CSC 172')).toBeGreaterThanOrEqual(0);
      expect(idx('MATH 150')).toBeGreaterThanOrEqual(0);
      expect(idx('CSC 172')).toBeLessThan(idx('CSC 252'));
      expect(idx('MATH 150')).toBeLessThan(idx('CSC 252'));
    }
    if (idx('CSC 280') >= 0) {
      expect(idx('CSC 173')).toBeLessThan(idx('CSC 280'));
      expect(idx('MATH 150')).toBeLessThan(idx('CSC 280'));
    }
    if (idx('STAT 190') >= 0) {
      const calcIdx = ['MATH 141', 'MATH 161', 'MATH 171']
        .map(idx).filter((i) => i >= 0);
      expect(calcIdx.length).toBeGreaterThan(0);
      expect(Math.min(...calcIdx)).toBeLessThan(idx('STAT 190'));
    }
  });

  it('tags every auto placement with a reason, unlocked', () => {
    expect(result.placements.length).toBeGreaterThan(10);
    for (const pl of result.placements) {
      expect(pl.reason).toBeTruthy();
      const meta = getCourseMeta(result.plan, pl.courseId);
      expect(meta.source).toBe('auto');
      expect(meta.locked).toBe(false);
      expect(meta.reason).toBe(pl.reason);
    }
  });

  it('is deterministic', () => {
    const again = autoGenerate(csPlan(), DATA);
    expect(again.plan.semesters.map((s) => [...s.courseIds].sort()))
      .toEqual(result.plan.semesters.map((s) => [...s.courseIds].sort()));
  });

  it('stays fast (well under a second)', () => {
    const t0 = performance.now();
    autoGenerate(csPlan(), DATA);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe('autoGenerate: locking and scopes', () => {
  it('never removes locked or manual courses; unlocked auto courses are fair game', () => {
    let base = csPlan();
    base.semesters[3].courseIds = ['CSC 171'];   // weird late manual placement
    base = withCourseMeta(base, 'CSC 171', { source: 'manual', locked: true });
    const result = autoGenerate(base, DATA);
    expect(result.plan.semesters[3].courseIds).toContain('CSC 171');
    // regenerate: previous auto placements may move, the locked one may not
    const again = autoGenerate(result.plan, DATA);
    expect(again.plan.semesters[3].courseIds).toContain('CSC 171');
  });

  it('legacy plans without courseMeta treat placed courses as locked', () => {
    const base = csPlan();
    base.semesters[0].courseIds = ['CSC 172'];
    delete base.courseMeta; // simulate a plan saved before this feature
    expect(computeRemovable(base, DATA, { kind: 'all' }).size).toBe(0);
  });

  it('fromSemester scope leaves earlier semesters byte-identical', () => {
    const first = autoGenerate(csPlan(), DATA);
    const re = autoGenerate(first.plan, DATA, { scope: { kind: 'fromSemester', index: 2 } });
    for (let i = 0; i < 2; i++) {
      expect(re.plan.semesters[i].courseIds).toEqual(first.plan.semesters[i].courseIds);
    }
    for (const pl of re.placements) {
      const idx = re.plan.semesters.findIndex((s) => s.id === pl.semesterId);
      expect(idx).toBeGreaterThanOrEqual(2);
    }
  });

  it('program scope only removes courses used solely by that program', () => {
    const base = csPlan();
    base.minorIds = []; // keep it simple: major + clusters
    const first = autoGenerate(base, DATA);
    const prog = computeProgress(first.plan, DATA);
    const clusterCourses = prog.clusters.flatMap((c) => [...c.usedCourseIds]);
    const re = autoGenerate(first.plan, DATA, { scope: { kind: 'program', programId: 'major-csc-bs' } });
    for (const cid of clusterCourses) {
      const inNew = re.plan.semesters.some((s) => s.courseIds.includes(cid));
      expect(inNew, `${cid} (cluster course) should be untouched`).toBe(true);
    }
  });

  it('group scope (auto-fill a gap) is purely additive', () => {
    const base = csPlan();
    base.semesters[0].courseIds = ['CSC 171', 'MATH 150'];
    base.courseMeta = {
      'CSC 171': { source: 'manual', locked: true },
      'MATH 150': { source: 'manual', locked: true },
    };
    const re = autoGenerate(base, DATA, {
      scope: { kind: 'group', programId: 'major-csc-bs', groupId: 'stat' },
    });
    expect(re.plan.semesters[0].courseIds).toContain('CSC 171');
    expect(re.placements.length).toBeGreaterThanOrEqual(1);
    const statOptions = ['STAT 190', 'ECON 230', 'MATH 201', 'STAT 201'];
    expect(re.placements.some((pl) => statOptions.includes(pl.courseId))).toBe(true);
    const others = allPlaced(re.plan).filter((c) => !['CSC 171', 'MATH 150'].includes(c));
    expect(others.some((c) => statOptions.includes(c))).toBe(true);
  });
});

describe('autoGenerate: transfer credit and infeasibility', () => {
  it('skips WRTG 105 when transfer covers it, but flags PWR-by-transfer', () => {
    const base = csPlan();
    base.clusterIds = [];
    base.transfer = [{ courseId: 'WRTG 105', kind: 'transfer' }];
    const result = autoGenerate(base, DATA);
    expect(allPlaced(result.plan)).not.toContain('WRTG 105');
    expect(result.violations.some((v) => v.ruleId === 'PWR_TRANSFER')).toBe(true);
  });

  it('uses AP credit to satisfy prerequisite chains', () => {
    const base = csPlan();
    base.clusterIds = [];
    base.transfer = [
      { courseId: 'CSC 171', kind: 'ap' },
      { courseId: 'MATH 161', kind: 'ap' },
    ];
    const result = autoGenerate(base, DATA);
    expect(allPlaced(result.plan)).not.toContain('CSC 171');
    expect(allPlaced(result.plan)).toContain('CSC 172');
    expect(errorsOf(result.violations)).toEqual([]);
  });

  it('reports the blocking prerequisite chain when the window is too short', () => {
    const base = csPlan();
    base.clusterIds = [];
    base.semesters = base.semesters.slice(0, 2); // 2 semesters for a 3+-deep chain
    const result = autoGenerate(base, DATA);
    expect(result.infeasible.length).toBeGreaterThan(0);
    const text = result.infeasible.map((x) => x.message).join('\n');
    expect(text).toMatch(/sequential prerequisite|no eligible course|only offered|ordering rule/);
    // best partial plan still validates
    expect(errorsOf(result.violations)).toEqual([]);
  });

  it('placeholder-only selections generate nothing but stay honest', () => {
    // Uses a synthetic placeholder rather than naming a real program: every
    // time a NEEDS_DATA_ENTRY program gets encoded this test used to break
    // (it has already been re-pointed twice), and once coverage is complete
    // there would be no real placeholder left to point at.
    const placeholder = {
      id: 'major-synthetic-placeholder', type: 'major', name: 'Synthetic', degree: 'BS',
      school: 'sas', division: 'natural-sciences', departments: [],
      status: 'NEEDS_DATA_ENTRY', sourceUrl: '', sourcedOn: '',
      clustersRequired: 2, allowedClusterDivisions: ['humanities', 'social-sciences'],
      requirementGroups: [], upperLevelWriting: null,
    };
    const data = { ...DATA, programs: [...DATA.programs, placeholder] };
    const base = newPlan('ph', 2026);
    base.majorIds = [placeholder.id];
    const result = autoGenerate(base, data);
    expect(result.placements.filter((p) => p.courseId !== 'WRTG 105')).toEqual([]);
    expect(result.violations.some((v) => v.ruleId === 'PROGRAM_NEEDS_DATA')).toBe(true);
  });
});

describe('autoGenerate: Biology BA (offering-constrained pipeline)', () => {
  it('completes the major with fall-only chemistry in fall slots', () => {
    const base = newPlan('bio', 2026);
    base.majorIds = ['biol-ba'];
    base.clusterIds = ['H1ENG015'];
    const result = autoGenerate(base, DATA);
    const { progress } = checkAll(result.plan, DATA);
    expect(progress.programs[0].complete, JSON.stringify(result.infeasible, null, 1)).toBe(true);
    expect(errorsOf(result.violations)).toEqual([]);
    const chemSem = result.plan.semesters.find((s) => s.courseIds.includes('CHEM 131'));
    expect(chemSem.term).toBe('fall');
  });
});
