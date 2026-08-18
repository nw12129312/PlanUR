import { describe, it, expect, afterEach } from 'vitest';
import coursesData from '../src/data/courses.json';
import programsData from '../src/data/programs.json';
import clustersData from '../src/data/clusters.json';
import policyData from '../src/data/policy.json';
import equivalencyGroupsData from '../src/data/equivalency_groups.json';

import { newPlan } from '../src/engine/model.js';
import { computeProgress } from '../src/engine/progress.js';
import { checkAll, checkCompletion } from '../src/engine/constraints.js';
import { checkEquivalencyConflicts, conflictForAdd } from '../src/engine/equivalency.js';
import { autoGenerate } from '../src/engine/autogen.js';
import * as store from '../src/storage/dataStore.js';

const DATA = { courses: coursesData, programs: programsData, clusters: clustersData, policy: policyData, equivalencyGroups: equivalencyGroupsData };
const byRule = (vs, id) => vs.filter((x) => x.ruleId === id);
const errorsOf = (vs) => vs.filter((x) => x.severity === 'error');

const BIO_IDS = ['biol-ba', 'biol-bs-general', 'biol-bs-biochem', 'biol-bs-celldev',
  'biol-bs-compbio', 'biol-bs-ecoevo', 'biol-bs-microbio', 'biol-bs-molgen',
  'biol-bs-neuro', 'biol-bs-clintrans'];

function plan(mods = {}) {
  return { ...newPlan('bio', 2026), ...mods };
}
function fill(p, i, ids) { p.semesters[i] = { ...p.semesters[i], courseIds: ids }; return p; }

describe('Biology program data', () => {
  it('all ten programs exist, ACTIVE, with cross-cutting flags and provenance', () => {
    for (const id of BIO_IDS) {
      const p = programsData.find((x) => x.id === id);
      expect(p, id).toBeTruthy();
      expect(p.status, id).toBe('ACTIVE');
      expect(p.apIbCreditExcluded, id).toBe(true);
      expect(p.minMajorGPA, id).toBe(2.0);
      expect(p.minPctFromHomeInstitution, id).toBe(50);
      expect(p.sourceUrl, id).toBeTruthy();
      expect(p.last_verified, id).toBeTruthy();
      expect(p.requirementGroups.length, id).toBeGreaterThan(5);
    }
  });
  it('old bio ids are gone from the program list', () => {
    expect(programsData.some((p) => p.id.startsWith('major-bio-'))).toBe(false);
  });
  it('diversification lists resolved from the shared fall/spring data', () => {
    const ba = programsData.find((x) => x.id === 'biol-ba');
    const div = ba.requirementGroups.find((g) => g.id === 'diversification');
    expect(div.rule.n).toBe(3);
    expect(div.rule.options.length).toBeGreaterThan(30);
    expect(div.rule.options).toContain('BIOL 205');
  });
  it('BMB upper-level writing is the track-specific MBI 221W override', () => {
    const bmb = programsData.find((x) => x.id === 'biol-bs-microbio');
    expect(bmb.upperLevelWriting.rule.options).toContain('MBI 221W');
    expect(bmb.upperLevelWriting.note).toContain('MBI 221W');
  });
});

describe('new equivalency groups (orgo, physics)', () => {
  it('mixing organic chemistry paths is a conflict; completing one path is not', () => {
    const p1 = fill(plan(), 0, ['CHEM 203', 'CHEM 171']);
    expect(byRule(checkEquivalencyConflicts(p1, equivalencyGroupsData), 'EQUIV_CONFLICT').length).toBe(2);
    let p2 = plan();
    fill(p2, 0, ['CHEM 203', 'CHEM 207']);
    expect(checkEquivalencyConflicts(p2, equivalencyGroupsData)).toEqual([]);
  });
  it('blocks a manual cross-path physics add with an explanation', () => {
    const p = fill(plan(), 0, ['PHYS 121']);
    const c = conflictForAdd(p, 'PHYS 113', equivalencyGroupsData);
    expect(c).not.toBeNull();
    expect(c.message).toContain('PHYS 121');
    expect(conflictForAdd(p, 'PHYS 122', equivalencyGroupsData)).toBeNull(); // not in the group
  });
});

describe('AP/IB exclusion (apIbCreditExcluded)', () => {
  it('AP-bucket biology never fills Bio requirements but still fills CS ones', () => {
    const p = plan({
      majorIds: ['biol-ba', 'major-csc-bs'],
      transfer: [{ courseId: 'BIOL 110L', kind: 'ap' }, { courseId: 'CSC 171', kind: 'ap' }],
    });
    const prog = computeProgress(p, DATA);
    const bio = prog.programs.find((r) => r.programId === 'biol-ba');
    const cs = prog.programs.find((r) => r.programId === 'major-csc-bs');
    const bioIntro = bio.groups.find((g) => g.id === 'intro');
    expect(bioIntro.satisfiedBy).not.toContain('BIOL 110L');
    const csPre = cs.groups.find((g) => g.id === 'premajor');
    expect(csPre.satisfiedBy).toContain('CSC 171'); // CS has no such flag
    const vs = checkCompletion(p, DATA, prog);
    expect(byRule(vs, 'AP_IB_MAJOR_EXCLUDED').length).toBeGreaterThan(0);
  });
  it('regular placed courses still fill Bio requirements', () => {
    const p = plan({ majorIds: ['biol-ba'] });
    fill(p, 0, ['BIOL 110L']);
    const bio = computeProgress(p, DATA).programs[0];
    expect(bio.groups.find((g) => g.id === 'intro').satisfiedBy).toContain('BIOL 110L');
  });
});

describe('home-institution share (minPctFromHomeInstitution)', () => {
  it('warns when transfer credit fulfills more than half the non-ancillary requirements', () => {
    const p = plan({
      majorIds: ['biol-ba'],
      transfer: [
        { courseId: 'BIOL 110L', kind: 'transfer' },
        { courseId: 'BIOL 111L', kind: 'transfer' },
      ],
    });
    const vs = checkCompletion(p, DATA);
    const hits = byRule(vs, 'HOME_INSTITUTION_MIN');
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain('50%');
  });
  it('ancillary (allied-field) transfer courses are exempt', () => {
    const p = plan({
      majorIds: ['biol-ba'],
      transfer: [
        { courseId: 'CHEM 131', kind: 'transfer' },
        { courseId: 'CHEM 132', kind: 'transfer' },
        { courseId: 'MATH 141', kind: 'transfer' },
      ],
    });
    fill(p, 0, ['BIOL 110L']);
    fill(p, 1, ['BIOL 111L']);
    expect(byRule(checkCompletion(p, DATA), 'HOME_INSTITUTION_MIN')).toEqual([]);
  });
});

describe('legacy id migration in dataStore', () => {
  afterEach(() => { delete globalThis.window; });
  it('loadPlan maps old major-bio-* ids to the new biol-* ids', async () => {
    const kv = new Map();
    globalThis.window = { storage: {
      async getItem(k) { return kv.get(k) ?? null; },
      async setItem(k, v) { kv.set(k, String(v)); },
      async removeItem(k) { kv.delete(k); },
    } };
    const old = { ...newPlan('legacy', 2025), id: 'plan-legacy', majorIds: ['major-bio-ba', 'major-csc-bs'], minorIds: ['major-bio-bsg'] };
    kv.set('plans:plan-legacy', JSON.stringify(old));
    const loaded = await store.loadPlan(store.LOCAL_USER, 'plan-legacy');
    expect(loaded.majorIds).toEqual(['biol-ba', 'major-csc-bs']);
    expect(loaded.minorIds).toEqual(['biol-bs-general']);
  });
});

describe('auto-generate across the Bio tracks', () => {
  it('generates complete, zero-error plans for BA, BSG, BCB, and BMB', () => {
    for (const id of ['biol-ba', 'biol-bs-general', 'biol-bs-compbio', 'biol-bs-microbio']) {
      const p = plan({ majorIds: [id], clusterIds: ['H1ENG015', 'S1ASL001'] });
      const result = autoGenerate(p, DATA);
      const { progress, violations } = checkAll(result.plan, DATA);
      expect(progress.programs[0].complete,
        `${id}: ${JSON.stringify(result.infeasible, null, 1)}`).toBe(true);
      expect(errorsOf(violations), id + JSON.stringify(errorsOf(violations), null, 1)).toEqual([]);
      // exactly one orgo path and one physics variant used
      const ids = new Set(result.plan.semesters.flatMap((s) => s.courseIds));
      expect(ids.has('CHEM 203') && ids.has('CHEM 171')).toBe(false);
      expect([...['PHYS 113', 'PHYS 121', 'PHYS 141'].filter((c) => ids.has(c))].length).toBeLessThanOrEqual(1);
    }
  }, 20000);
});
