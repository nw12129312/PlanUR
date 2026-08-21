import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { newPlan } from '../src/engine/model.js';
import * as store from '../src/storage/dataStore.js';

// Fake window.storage backed by a Map, mimicking the artifact runtime API.
function installFakeStorage() {
  const kv = new Map();
  globalThis.window = {
    storage: {
      async getItem(k) { return kv.has(k) ? kv.get(k) : null; },
      async setItem(k, v) { kv.set(k, String(v)); },
      async removeItem(k) { kv.delete(k); },
    },
  };
  return kv;
}

afterEach(() => { delete globalThis.window; });

describe('dataStore plan persistence', () => {
  let kv;
  beforeEach(() => { kv = installFakeStorage(); });

  it('round-trips save -> list -> load -> delete for the default user', async () => {
    const plan = newPlan('My plan', 2026);
    plan.majorIds = ['major-csc-bs'];

    const saved = await store.savePlan(store.LOCAL_USER, plan);
    expect(saved.ok).toBe(true);
    expect(saved.index).toHaveLength(1);
    expect(saved.index[0]).toMatchObject({ id: plan.id, name: 'My plan', major: 'Computer Science' });

    const listed = await store.listPlans(store.LOCAL_USER);
    expect(listed).toEqual(saved.index);

    const loaded = await store.loadPlan(store.LOCAL_USER, plan.id);
    expect(loaded).toEqual(JSON.parse(JSON.stringify(plan))); // plain JSON round-trip

    const del = await store.deletePlan(store.LOCAL_USER, plan.id);
    expect(del.ok).toBe(true);
    expect(del.index).toEqual([]);
    expect(await store.loadPlan(store.LOCAL_USER, plan.id)).toBeNull();
  });

  it('uses legacy keys for the local user (pre-multi-user saves stay readable)', async () => {
    const plan = newPlan('Legacy', 2026);
    await store.savePlan(store.LOCAL_USER, plan);
    expect(kv.has(`plans:${plan.id}`)).toBe(true);
    expect(kv.has('plan-index')).toBe(true);
    // and a plan seeded under old keys is visible without migration
    kv.set('plan-index', JSON.stringify([{ id: 'old-1', name: 'Old', clusters: [], last_edited: 1 }]));
    kv.set('plans:old-1', JSON.stringify({ ...newPlan('Old', 2025), id: 'old-1' }));
    const listed = await store.listPlans();
    expect(listed.some((e) => e.id === 'old-1')).toBe(true);
    expect((await store.loadPlan(undefined, 'old-1')).id).toBe('old-1');
  });

  it('namespaces other userIds and isolates them from each other', async () => {
    const a = newPlan('A plan', 2026);
    const b = newPlan('B plan', 2026);
    await store.savePlan('alice', a);
    await store.savePlan('bob', b);
    expect(kv.has(`users:alice:plans:${a.id}`)).toBe(true);
    expect(kv.has('users:alice:plan-index')).toBe(true);
    expect((await store.listPlans('alice')).map((e) => e.id)).toEqual([a.id]);
    expect((await store.listPlans('bob')).map((e) => e.id)).toEqual([b.id]);
    expect(await store.loadPlan('alice', b.id)).toBeNull();
    expect(await store.listPlans(store.LOCAL_USER)).toEqual([]);
  });

  it('duplicatePlan copies under a new id and name; missing source reports ok:false', async () => {
    const plan = newPlan('Original', 2026);
    plan.semesters[0].courseIds = ['CSC 171'];
    await store.savePlan('alice', plan);

    const dup = await store.duplicatePlan('alice', plan.id);
    expect(dup.ok).toBe(true);
    expect(dup.plan.id).not.toBe(plan.id);
    expect(dup.plan.name).toBe('Original (copy)');
    expect(dup.plan.semesters[0].courseIds).toEqual(['CSC 171']);
    expect(dup.index).toHaveLength(2);

    const missing = await store.duplicatePlan('alice', 'nope');
    expect(missing.ok).toBe(false);
    expect(missing.plan).toBeNull();
  });

  it('stores only JSON strings (plain-serializable shapes, no live objects)', async () => {
    const plan = newPlan('Shape', 2026);
    await store.savePlan(store.LOCAL_USER, plan);
    const raw = kv.get(`plans:${plan.id}`);
    expect(typeof raw).toBe('string');
    expect(() => JSON.parse(raw)).not.toThrow();
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual(JSON.parse(JSON.stringify(plan)));
  });

  it('defaults missing trackChoices on load so older saves still open', async () => {
    const plan = newPlan('No tracks', 2026);
    const raw = { ...plan };
    delete raw.trackChoices;
    kv.set(`plans:${plan.id}`, JSON.stringify(raw));
    const loaded = await store.loadPlan(store.LOCAL_USER, plan.id);
    expect(loaded.trackChoices).toEqual({});
  });
});

describe('dataStore degradation without window.storage', () => {
  it('keeps working via the in-memory mirror and reports unavailable status', async () => {
    delete globalThis.window;
    const plan = newPlan('Offline', 2026);
    const saved = await store.savePlan(store.LOCAL_USER, plan);
    expect(saved.ok).toBe(false); // persistence failed...
    expect(store.storageStatus().available).toBe(false);
    // ...but the session still functions through the mirror
    const loaded = await store.loadPlan(store.LOCAL_USER, plan.id);
    expect(loaded?.id).toBe(plan.id);
    expect((await store.listPlans()).some((e) => e.id === plan.id)).toBe(true);
  });
});

describe('dataStore static data accessors', () => {
  it('serves programs, courses, and equivalency groups as plain data', () => {
    expect(store.getPrograms().some((p) => p.id === 'major-csc-bs')).toBe(true);
    expect(store.getCourses()['CSC 172'].credits).toBe(4);
    expect(store.getEquivalencyGroups().some((g) => g.id === 'calc-sequence')).toBe(true);
    expect(store.getClusters().length).toBeGreaterThan(100);
    expect(store.getPolicy().standardTotalCredits).toBe(128);
  });
});
