import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { newPlan } from '../src/engine/model.js';
import * as store from '../src/storage/dataStore.js';
import * as account from '../src/storage/account.js';
import { mergePlans, newestById } from '../src/storage/sync.js';

function plan(name, lastEdited, id) {
  const p = newPlan(name, 2026);
  return { ...p, id: id || p.id, lastEdited };
}
const rec = (p) => ({ id: p.id, lastEdited: p.lastEdited, deleted: false, plan: p });

// Browser localStorage stand-in (no window.storage, like a normal web page).
function installLocalStorage() {
  const kv = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => (kv.has(k) ? kv.get(k) : null),
      setItem: (k, v) => kv.set(k, String(v)),
      removeItem: (k) => kv.delete(k),
    },
  };
  return kv;
}

// In-memory account backend with the cloud adapter shape.
function fakeCloud(initial = []) {
  const records = new Map(initial.map((r) => [r.id, r]));
  return {
    records,
    failPuts: false,
    async list() { return [...records.values()]; },
    async put(uid, p) {
      if (this.failPuts) throw new Error('offline');
      records.set(p.id, { id: p.id, lastEdited: p.lastEdited, deleted: false, plan: p });
    },
    async remove(uid, id) { records.set(id, { id, lastEdited: Date.now(), deleted: true, plan: null }); },
  };
}

afterEach(() => { delete globalThis.window; });

describe('saving in the browser without an account', () => {
  it('falls back to localStorage when window.storage is absent', async () => {
    const kv = installLocalStorage();
    const p = plan('Browser plan', 5);
    const res = await store.savePlan(store.LOCAL_USER, p);
    expect(res.ok).toBe(true);
    expect(store.storageBackendKind()).toBe('browser');
    expect(kv.has(`planur:plans:${p.id}`)).toBe(true);
    expect((await store.loadPlan(store.LOCAL_USER, p.id)).name).toBe('Browser plan');
  });

  it('prefers the artifact runtime store when present', () => {
    globalThis.window = { storage: { getItem() {}, setItem() {} }, localStorage: {} };
    expect(store.storageBackendKind()).toBe('artifact');
  });
});

describe('merge rules', () => {
  it('keeps the newest copy of each plan and uploads what the cloud lacks', () => {
    const localOnly = plan('Local only', 10);
    const sharedOld = plan('Shared', 10, 'shared');
    const sharedNew = plan('Shared newer', 20, 'shared');
    const cloudOnly = plan('Cloud only', 15);
    const { plans, upload, removeHere } = mergePlans([localOnly, sharedOld], [rec(sharedNew), rec(cloudOnly)]);
    expect(plans.map((p) => p.name).sort()).toEqual(['Cloud only', 'Local only', 'Shared newer']);
    expect(upload.map((p) => p.name)).toEqual(['Local only']);
    expect(removeHere).toEqual([]);
  });

  it('uploads a local edit that is newer than the cloud copy', () => {
    const cloudCopy = plan('Old', 10, 'x');
    const mine = plan('Edited here', 30, 'x');
    const { plans, upload } = mergePlans([mine], [rec(cloudCopy)]);
    expect(plans).toEqual([mine]);
    expect(upload).toEqual([mine]);
  });

  it('drops a plan deleted on another device unless it was edited here afterwards', () => {
    const stale = plan('Deleted elsewhere', 10, 'a');
    const fresh = plan('Edited after delete', 50, 'b');
    const tomb = (id, t) => ({ id, lastEdited: t, deleted: true, plan: null });
    const { plans, removeHere, upload } = mergePlans([stale, fresh], [tomb('a', 20), tomb('b', 40)]);
    expect(removeHere).toEqual(['a']);
    expect(plans).toEqual([fresh]);
    expect(upload).toEqual([fresh]);
  });

  it('newestById collapses duplicate ids', () => {
    expect(newestById([plan('a', 1, 'x')], [plan('b', 2, 'x')]).map((p) => p.name)).toEqual(['b']);
  });
});

describe('signing in merges this browser into the account', () => {
  beforeEach(() => { installLocalStorage(); });

  it('moves device plans into the account and brings account plans down', async () => {
    const mine = plan('Made before sign-in', 100);
    await store.savePlan(store.LOCAL_USER, mine);
    const theirs = plan('From my laptop', 50);
    const cloud = fakeCloud([rec(theirs)]);

    const res = await account.mergeIntoAccount(cloud, 'u1');
    expect(res.ok).toBe(true);
    expect(res.added).toBe(1);
    expect(res.index.map((e) => e.name).sort()).toEqual(['From my laptop', 'Made before sign-in']);
    expect(cloud.records.get(mine.id).plan.name).toBe('Made before sign-in');
    expect(await store.listPlans(store.LOCAL_USER)).toEqual([]); // moved, not copied
  });

  it('keeps device plans in place when the account cannot be reached', async () => {
    const mine = plan('Offline plan', 100);
    await store.savePlan(store.LOCAL_USER, mine);
    const cloud = fakeCloud();
    cloud.failPuts = true;
    const res = await account.mergeIntoAccount(cloud, 'u1');
    expect(res.ok).toBe(false);
    expect((await store.listPlans(store.LOCAL_USER)).map((e) => e.id)).toEqual([mine.id]);
  });

  it('saves and deletes go to the account while signed in', async () => {
    const cloud = fakeCloud();
    const p = plan('Synced', 10);
    const saved = await account.savePlan(cloud, 'u1', p);
    expect(saved.synced).toBe(true);
    expect(cloud.records.get(p.id).plan.name).toBe('Synced');
    await account.deletePlan(cloud, 'u1', p.id);
    expect(cloud.records.get(p.id).deleted).toBe(true);
    expect(await store.listPlans('u1')).toEqual([]);
  });

  it('applies newer edits from another device but ignores older ones', async () => {
    const p = plan('Mine', 100, 'p1');
    await store.savePlan('u1', p);
    let r = await account.applyRemote('u1', [rec(plan('Older remote', 50, 'p1'))]);
    expect(r.changed).toEqual([]);
    r = await account.applyRemote('u1', [rec(plan('Newer remote', 200, 'p1'))]);
    expect(r.changed).toEqual(['p1']);
    expect((await store.loadPlan('u1', 'p1')).name).toBe('Newer remote');
  });

  it('sign-out clears the cached account plans once the account has them', async () => {
    const cloud = fakeCloud();
    await account.savePlan(cloud, 'u1', plan('Cached', 10));
    const { ok } = await account.forgetAccountOnDevice(cloud, 'u1');
    expect(ok).toBe(true);
    expect(await store.listPlans('u1')).toEqual([]);
    expect(cloud.records.size).toBe(1);
  });
});
