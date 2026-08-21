import { describe, it, expect } from 'vitest';
import coursesData from '../src/data/courses.json';
import programsData from '../src/data/programs.json';
import clustersData from '../src/data/clusters.json';
import policyData from '../src/data/policy.json';
import equivalencyGroupsData from '../src/data/equivalency_groups.json';

import { newPlan, withTrackChoice } from '../src/engine/model.js';
import { withProgramSwap } from '../src/engine/pathways.js';
import { computeProgress, pwrStatus } from '../src/engine/progress.js';
import {
  checkPrerequisites, checkOfferingSemester, checkCreditLoad, checkDuplicates,
  checkOverlap, checkClusterRules, checkDepartmentCap, checkTotalCredits,
  resolveRequiredCredits, checkCompletion, checkAll,
} from '../src/engine/constraints.js';

const DATA = { courses: coursesData, programs: programsData, clusters: clustersData, policy: policyData, equivalencyGroups: equivalencyGroupsData };

function planWith(mods = {}) {
  const p = newPlan('test', 2026);
  return { ...p, ...mods };
}
function fill(plan, semesterIndex, courseIds) {
  plan.semesters[semesterIndex] = { ...plan.semesters[semesterIndex], courseIds };
  return plan;
}
const errorsOf = (vs) => vs.filter((x) => x.severity === 'error');
const byRule = (vs, id) => vs.filter((x) => x.ruleId === id);

describe('checkPrerequisites', () => {
  it('flags a course scheduled before its prerequisite', () => {
    const plan = fill(planWith(), 0, ['CSC 172']);
    const vs = checkPrerequisites(plan, DATA);
    expect(byRule(vs, 'PREREQ_ORDER').length).toBe(1);
    expect(vs[0].courseId).toBe('CSC 172');
  });
  it('flags same-semester prerequisite', () => {
    const plan = fill(planWith(), 0, ['CSC 171', 'CSC 172']);
    const vs = byRule(checkPrerequisites(plan, DATA), 'PREREQ_ORDER');
    expect(vs.length).toBe(1);
    expect(vs[0].message).toMatch(/same semester/);
  });
  it('accepts correct ordering', () => {
    let plan = planWith();
    fill(plan, 0, ['CSC 171']);
    fill(plan, 1, ['CSC 172']);
    expect(checkPrerequisites(plan, DATA)).toEqual([]);
  });
  it('counts AP/transfer bucket as satisfied prerequisite', () => {
    const plan = fill(planWith({ transfer: [{ courseId: 'CSC 171', kind: 'ap' }] }), 0, ['CSC 172']);
    expect(checkPrerequisites(plan, DATA)).toEqual([]);
  });
  it('downgrades unverified prereqs to warnings', () => {
    const plan = fill(planWith(), 0, ['BIOL 111L']); // intro sequence, verified:false
    const vs = checkPrerequisites(plan, DATA);
    expect(byRule(vs, 'PREREQ_UNVERIFIED').length).toBe(1);
    expect(vs[0].severity).toBe('warning');
  });
});

describe('CDCS Public Notes prerequisites', () => {
  it('loads CSC 252 from CDCS notes (MATH 150 and CSC 172)', () => {
    const c = coursesData['CSC 252'];
    expect(c.prereqs).toEqual([['MATH 150'], ['CSC 172']]);
    expect(c.prereqsVerified).toBe(true);
    expect(c.prereqSource).toMatch(/CDCS/);
  });
  it('loads CSC 280 from CDCS notes (CSC 173 and MATH 150)', () => {
    expect(coursesData['CSC 280'].prereqs).toEqual([['CSC 173'], ['MATH 150']]);
  });
  it('loads PHYS 113 calculus I as an OR group', () => {
    expect(new Set(coursesData['PHYS 113'].prereqs[0])).toEqual(
      new Set(['MATH 141', 'MATH 161', 'MATH 171']),
    );
  });
  it('leaves MATH 141 and MATH 161 empty (high-school placement, not a UR course)', () => {
    expect(coursesData['MATH 141'].prereqs).toEqual([]);
    expect(coursesData['MATH 161'].prereqs).toEqual([]);
  });
  it('keeps curated CSC 171 → 172 → 173 over the CDCS MATH 150 add-on on 173', () => {
    expect(coursesData['CSC 172'].prereqs).toEqual([['CSC 171']]);
    expect(coursesData['CSC 173'].prereqs).toEqual([['CSC 172']]);
  });
});

describe('checkOfferingSemester', () => {
  it('warns when a course lands in a term it did not run in 2025-26', () => {
    const plan = planWith();
    fill(plan, 1, ['BIOL 110L']); // spring semester; ran only in fall
    const vs = byRule(checkOfferingSemester(plan, DATA), 'OFFERING_TERM');
    expect(vs.length).toBe(1);
    expect(vs[0].severity).toBe('warning');
  });
  it('emits info (not warning) for stub courses with no schedule data', () => {
    const stub = Object.values(coursesData).find((c) => c.stub);
    expect(stub, 'catalog should still contain at least one stub').toBeTruthy();
    const plan = fill(planWith(), 0, [stub.id]);
    const vs = checkOfferingSemester(plan, DATA);
    expect(byRule(vs, 'OFFERING_UNVERIFIED').length).toBe(1);
    expect(vs[0].severity).toBe('info');
  });
  it('is silent for a verified fall course in fall', () => {
    const plan = fill(planWith(), 0, ['CSC 171']);
    expect(checkOfferingSemester(plan, DATA)).toEqual([]);
  });
});

describe('checkCreditLoad', () => {
  it('warns under 12 and over 18 credits', () => {
    const plan = planWith();
    fill(plan, 0, ['CSC 171', 'CSC 172']); // 8 credits
    fill(plan, 1, ['CSC 173', 'CSC 242', 'CSC 252', 'CSC 254', 'CSC 280']); // 20 credits
    const vs = checkCreditLoad(plan, DATA);
    expect(byRule(vs, 'LOAD_MIN').length).toBe(1);
    expect(byRule(vs, 'LOAD_MAX').length).toBe(1);
  });
  it('ignores empty semesters', () => {
    expect(checkCreditLoad(planWith(), DATA)).toEqual([]);
  });
});

describe('checkDuplicates', () => {
  it('flags the same course twice', () => {
    const plan = planWith();
    fill(plan, 0, ['CSC 171']);
    fill(plan, 2, ['CSC 171']);
    expect(byRule(checkDuplicates(plan), 'DUPLICATE_COURSE').length).toBe(1);
  });
});

describe('checkDepartmentCap', () => {
  it('flags more than 20 courses from one department', () => {
    const plan = planWith();
    const csc = Object.keys(coursesData).filter((c) => c.startsWith('CSC ')).slice(0, 21);
    expect(csc.length).toBe(21);
    fill(plan, 0, csc);
    expect(byRule(checkDepartmentCap(plan, DATA), 'DEPT_20_CAP').length).toBe(1);
  });
});

describe('total credits resolution', () => {
  it('is 128 standard, 136 double degree, and honors major overrides', () => {
    expect(resolveRequiredCredits(planWith(), DATA)).toBe(128);
    expect(resolveRequiredCredits(planWith({ doubleDegree: true }), DATA)).toBe(136);
    // BME BS is 132 per the official department page (the project spec's 131 was
    // superseded by the sourced requirements page during Layer 3 encoding).
    expect(resolveRequiredCredits(planWith({ majorIds: ['major-bme-bs'] }), DATA)).toBe(132);
    expect(resolveRequiredCredits(planWith({ majorIds: ['major-bme-bs'], doubleDegree: true }), DATA)).toBe(136);
  });
});

describe('PWR', () => {
  it('handles 105 / 105E / 105A+105B variants', () => {
    expect(pwrStatus(fill(planWith(), 0, ['WRTG 105']), policyData).satisfied).toBe(true);
    expect(pwrStatus(fill(planWith(), 0, ['WRTG 105E']), policyData).satisfied).toBe(true);
    expect(pwrStatus(fill(planWith(), 0, ['WRTG 105A']), policyData).satisfied).toBe(false);
    const both = fill(planWith(), 0, ['WRTG 105A', 'WRTG 105B']);
    expect(pwrStatus(both, policyData).satisfied).toBe(true);
  });
  it('does not treat transfer-bucket WRTG 105 as satisfied', () => {
    const plan = planWith({ transfer: [{ courseId: 'WRTG 105', kind: 'transfer' }] });
    const st = pwrStatus(plan, policyData);
    expect(st.satisfied).toBe(false);
    expect(st.transferOnly).toBe(true);
    const vs = checkCompletion(plan, DATA);
    expect(byRule(vs, 'PWR_TRANSFER').length).toBe(1);
  });
});

describe('cluster rules', () => {
  it('rejects a natural-sciences cluster for a CS BS major (allowed: hum/socsci)', () => {
    const ns = clustersData.find((c) => c.division === 'natural-sciences');
    const plan = planWith({ majorIds: ['major-csc-bs'], clusterIds: [ns.id] });
    const vs = byRule(checkClusterRules(plan, DATA), 'CLUSTER_DIVISION');
    expect(vs.length).toBe(1);
  });
  it('rejects two clusters in the same division and shared home departments', () => {
    const hum = clustersData.filter((c) => c.division === 'humanities');
    const plan = planWith({ clusterIds: [hum[0].id, hum[1].id] });
    const vs = checkClusterRules(plan, DATA);
    expect(byRule(vs, 'CLUSTER_DIVISION_DISTINCT').length).toBe(1);
    const sameDept = hum.filter((c) => c.homeDept === hum[0].homeDept);
    if (sameDept.length >= 2) {
      const plan2 = planWith({ clusterIds: [sameDept[0].id, sameDept[1].id] });
      expect(byRule(checkClusterRules(plan2, DATA), 'CLUSTER_SHARED_DEPT').length).toBe(1);
    }
  });
  it("rejects a cluster homed in the major's own department", () => {
    const engCluster = clustersData.find((c) => c.homeDept === 'PSC' || c.homeDept === 'PSCI');
    if (!engCluster) return;
    const plan = planWith({ majorIds: ['major-psc-ba'], clusterIds: [engCluster.id] });
    expect(byRule(checkClusterRules(plan, DATA), 'CLUSTER_OWN_DEPT').length).toBe(1);
  });
  it('never assigns WRTG 105 or AP/IB courses to a cluster', () => {
    // synthetic cluster whose options include WRTG 105 and an AP course
    const cluster = {
      id: 'TEST001', name: 'Test', division: 'humanities', homeDept: 'ENG',
      status: 'ACTIVE', description: '', groups: [{
        n: 3, all: false, unit: 'courses', note: null,
        options: [
          { codes: ['WRTG 105'], mode: 'any', text: '' },
          { codes: ['ENGL 121'], mode: 'any', text: '' },
          { codes: ['ENGL 122'], mode: 'any', text: '' },
          { codes: ['ENGL 123'], mode: 'any', text: '' },
        ],
      }],
    };
    const data = { ...DATA, clusters: [...clustersData, cluster] };
    let plan = planWith({ clusterIds: ['TEST001'], transfer: [{ courseId: 'ENGL 121', kind: 'ap' }] });
    fill(plan, 0, ['WRTG 105', 'ENGL 122', 'ENGL 123']);
    const prog = computeProgress(plan, data);
    const cr = prog.clusters[0];
    expect(cr.usedCourseIds.has('WRTG 105')).toBe(false);
    expect(cr.usedCourseIds.has('ENGL 121')).toBe(false); // AP credit
    expect(cr.usedCourseIds.has('ENGL 122')).toBe(true);
    expect(cr.usedCourseIds.has('ENGL 123')).toBe(true);
    expect(cr.complete).toBe(false); // only 2 eligible courses
  });
  it('caps courses shared with a program at 1 per cluster', () => {
    // cluster made of CSC core courses, selected alongside CS BS major
    const cluster = {
      id: 'TEST002', name: 'Test2', division: 'social-sciences', homeDept: 'XXX',
      status: 'ACTIVE', description: '', groups: [{
        n: 3, all: false, unit: 'courses', note: null,
        options: [
          { codes: ['CSC 173'], mode: 'any', text: '' },
          { codes: ['CSC 242'], mode: 'any', text: '' },
          { codes: ['CSC 252'], mode: 'any', text: '' },
        ],
      }],
    };
    const data = { ...DATA, clusters: [...clustersData, cluster] };
    let plan = planWith({ majorIds: ['major-csc-bs'], clusterIds: ['TEST002'] });
    fill(plan, 0, ['CSC 171', 'MATH 150']);
    fill(plan, 1, ['CSC 172']);
    fill(plan, 2, ['CSC 173', 'CSC 242', 'CSC 252']);
    const prog = computeProgress(plan, data);
    const cr = prog.clusters[0];
    expect(cr.usedCourseIds.size).toBe(1); // all options shared with major; cap = 1
    expect(cr.complete).toBe(false);
    // and no cap violation, since assignment respected the cap
    expect(byRule(checkOverlap(plan, data, prog), 'OVERLAP_CLUSTER_PROGRAM')).toEqual([]);
  });
  it('assigns every course of a compound "X and Y" option, and falls back to alternate codes', () => {
    const cluster = {
      id: 'TESTC', name: 'TestC', division: 'humanities', homeDept: 'CHI',
      status: 'ACTIVE', description: '', groups: [{
        n: 3, all: false, unit: 'courses', note: null,
        options: [
          { codes: ['CHIN 114', 'CHIN 115'], mode: 'all', text: 'CHIN 114 and CHIN 115' },
          { codes: ['WRTG 105', 'CHIN 151'], mode: 'any', text: 'either' }, // first code ineligible
        ],
      }],
    };
    const data = { ...DATA, clusters: [...clustersData, cluster] };
    const plan = fill(planWith({ clusterIds: ['TESTC'] }), 0, ['CHIN 114', 'CHIN 115', 'WRTG 105', 'CHIN 151']);
    const cr = computeProgress(plan, data).clusters[0];
    expect(cr.usedCourseIds.has('CHIN 114')).toBe(true);
    expect(cr.usedCourseIds.has('CHIN 115')).toBe(true);
    expect(cr.usedCourseIds.has('WRTG 105')).toBe(false);
    expect(cr.usedCourseIds.has('CHIN 151')).toBe(true); // second code of the 'any' option
    expect(cr.complete).toBe(true);
  });
  it('no course may satisfy two clusters', () => {
    const mk = (id) => ({
      id, name: id, division: id === 'TESTA' ? 'humanities' : 'social-sciences',
      homeDept: id, status: 'ACTIVE', description: '',
      groups: [{ n: 1, all: false, unit: 'courses', note: null,
                 options: [{ codes: ['ENGL 121'], mode: 'any', text: '' }] }],
    });
    const data = { ...DATA, clusters: [...clustersData, mk('TESTA'), mk('TESTB')] };
    const plan = fill(planWith({ clusterIds: ['TESTA', 'TESTB'] }), 0, ['ENGL 121']);
    const prog = computeProgress(plan, data);
    const usedTwice = prog.clusters.filter((c) => c.usedCourseIds.has('ENGL 121'));
    expect(usedTwice.length).toBe(1);
  });
});

describe('overlap caps', () => {
  it('flags major/minor overlap beyond 2 non-exempt courses', () => {
    // CS BS + CS minor: minor's six-above-130 filter will reuse CSC courses
    let plan = planWith({ majorIds: ['major-csc-bs'], minorIds: ['minor-csc'] });
    fill(plan, 0, ['CSC 171', 'MATH 150', 'MATH 161']);
    fill(plan, 1, ['CSC 172', 'MATH 162']);
    fill(plan, 2, ['CSC 173', 'CSC 242']);
    fill(plan, 3, ['CSC 252', 'CSC 254']);
    const vs = checkOverlap(plan, DATA);
    const hit = byRule(vs, 'OVERLAP_MAJOR_MINOR');
    expect(hit.length).toBe(1);
    expect(hit[0].message).toMatch(/cap is 2/);
    // exempt math courses must not appear in the shared list
    expect(hit[0].courseIds).not.toContain('MATH 161');
    expect(hit[0].courseIds).not.toContain('MATH 150');
  });
});

describe('PSC BA track logic', () => {
  it('picks the best track and fills breadth from other tracks', () => {
    // Courses exclusive to one track (verified against sourced track lists):
    // five Elections & Government + two Philosophy/Law/Public Policy.
    const five = ['PSCI 211', 'PSCI 215', 'PSCI 218W', 'PSCI 253', 'PSCI 260'];
    const breadth = ['PSCI 104', 'PSCI 116'];
    let plan = planWith({ majorIds: ['major-psc-ba'] });
    fill(plan, 0, ['PSCI 200', 'PSCI 107']);
    fill(plan, 1, five.slice(0, 3));
    fill(plan, 2, [...five.slice(3), ...breadth]);
    const prog = computeProgress(plan, DATA);
    const r = prog.programs[0];
    const core = r.groups.find((g) => g.id === 'core-track');
    expect(core.chosenTrack).toBe('Elections and Government');
    expect(core.complete).toBe(true);
    expect(r.groups.find((g) => g.id === 'tools').complete).toBe(true);
    expect(r.groups.find((g) => g.id === 'breadth').complete).toBe(true);
  });

  it('honors a stored concentration even with no matching courses', () => {
    const plan = planWith({
      majorIds: ['major-psc-ba'],
      trackChoices: { 'major-psc-ba': { 'core-track': 'Data and Modeling' } },
    });
    const core = computeProgress(plan, DATA).programs[0].groups.find((g) => g.id === 'core-track');
    expect(core.chosenTrack).toBe('Data and Modeling');
    expect(core.have).toBe(0);
    expect(core.complete).toBe(false);
  });

  it('does not switch away from a declared concentration that has fewer matching courses', () => {
    const elections = ['PSCI 211', 'PSCI 215', 'PSCI 218W', 'PSCI 253', 'PSCI 260'];
    const plan = fill(planWith({
      majorIds: ['major-psc-ba'],
      trackChoices: { 'major-psc-ba': { 'core-track': 'Data and Modeling' } },
    }), 0, elections);
    const r = computeProgress(plan, DATA).programs[0];
    const core = r.groups.find((g) => g.id === 'core-track');
    expect(core.chosenTrack).toBe('Data and Modeling');
    expect(core.complete).toBe(false);
    expect(r.groups.find((g) => g.id === 'breadth').have).toBeGreaterThan(0);
  });

  it('withTrackChoice writes and clears a pathway without mutating the original plan', () => {
    const plan = planWith({ majorIds: ['major-psc-ba'] });
    const next = withTrackChoice(plan, 'major-psc-ba', 'core-track', 'Data and Modeling');
    expect(plan.trackChoices).toEqual({});
    expect(next.trackChoices['major-psc-ba']['core-track']).toBe('Data and Modeling');
    expect(withTrackChoice(next, 'major-psc-ba', 'core-track', '').trackChoices).toEqual({});
  });
});

describe('in-major concentration pickers', () => {
  it('honors a declared BME concentration', () => {
    const plan = planWith({
      majorIds: ['major-bme-bs'],
      trackChoices: { 'major-bme-bs': { concentration: 'Medical Optics' } },
    });
    const g = computeProgress(plan, DATA).programs[0].groups.find((x) => x.id === 'concentration');
    expect(g.chosenTrack).toBe('Medical Optics');
    expect(g.need).toBe(4);
  });

  it('honors a declared Data Science application area', () => {
    const plan = planWith({
      majorIds: ['major-dsc-bs'],
      trackChoices: { 'major-dsc-bs': { concentration: 'Artificial Intelligence' } },
    });
    const g = computeProgress(plan, DATA).programs[0].groups.find((x) => x.id === 'concentration');
    expect(g.chosenTrack).toBe('Artificial Intelligence');
    expect(g.need).toBe(3);
  });
});

describe('program family swap', () => {
  it('replaces a biology track and moves stored pathway choices', () => {
    const plan = planWith({
      majorIds: ['biol-ba', 'major-csc-bs'],
      trackChoices: { 'biol-ba': { core: 'kept' } },
    });
    const next = withProgramSwap(plan, 'biol-ba', 'biol-bs-biochem');
    expect(plan.majorIds).toEqual(['biol-ba', 'major-csc-bs']);
    expect(next.majorIds).toEqual(['biol-bs-biochem', 'major-csc-bs']);
    expect(next.trackChoices['biol-bs-biochem'].core).toBe('kept');
    expect(next.trackChoices['biol-ba']).toBeUndefined();
  });

  it('refuses to swap onto a program already on the plan', () => {
    const plan = planWith({ majorIds: ['biol-ba', 'biol-bs-biochem'] });
    expect(withProgramSwap(plan, 'biol-ba', 'biol-bs-biochem')).toBe(plan);
  });
});

describe('full CS BS plan integration', () => {
  it('completes the major, both clusters, and PWR with zero errors', () => {
    let plan = planWith({
      majorIds: ['major-csc-bs'],
      clusterIds: ['H1ENG015', 'S1ASL001'],
    });
    fill(plan, 0, ['CSC 171', 'MATH 150', 'WRTG 105', 'ENGL 121']);          // Fall 1
    fill(plan, 1, ['CSC 172', 'MATH 161', 'ENGL 122', 'ASLA 106']);          // Spring 1
    fill(plan, 2, ['CSC 173', 'CSC 242', 'MATH 162', 'ASLA 201']);           // Fall 2
    fill(plan, 3, ['CSC 252', 'CSC 282', 'MATH 165', 'ENGL 123']);           // Spring 2
    fill(plan, 4, ['CSC 254', 'CSC 280', 'STAT 190', 'ASLA 250']);           // Fall 3
    fill(plan, 5, ['CSC 240', 'CSC 246', 'CSC 299W', 'PSCI 101']);           // Spring 3
    fill(plan, 6, ['CSC 256', 'CSC 261', 'CSC 273W', 'ASLA 202']);           // Fall 4
    fill(plan, 7, ['PHIL 101', 'ECON 108', 'ANTH 101', 'PSCI 106']);         // Spring 4
    const { progress, violations } = checkAll(plan, DATA);

    const major = progress.programs[0];
    expect(major.complete).toBe(true);
    for (const g of major.groups.filter((x) => !x.isULW)) {
      expect(g.complete, `group ${g.id}`).toBe(true);
    }
    const ulw = major.groups.find((g) => g.isULW);
    expect(ulw.complete).toBe(true);

    for (const cr of progress.clusters) expect(cr.complete, cr.clusterId).toBe(true);
    expect(progress.pwr.satisfied).toBe(true);

    const errs = errorsOf(violations);
    expect(errs, JSON.stringify(errs, null, 1)).toEqual([]);
  });
});
