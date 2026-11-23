// Keeps a signed-in user's plans in step between this device and their
// account. Plans for someone who isn't signed in live under LOCAL_USER in
// this browser; a signed-in user's plans are cached under their uid and
// mirrored to the cloud adapter (see ./cloud).
//
// The cloud adapter shape: { list(uid), put(uid, plan), remove(uid, id),
// subscribe(uid, cb) }. Every function here takes it as a parameter so the
// rules can be tested without Firebase.

import * as store from './dataStore.js';
import { mergePlans, newestById } from './sync.js';

// Sign-in merge. Moves the plans saved on this device (and any older cached
// copies of the account) into the account, then fills the device cache with
// everything the account holds. Device-only plans are removed only once the
// account has them. Returns { ok, added, index }: added = plans from this
// device that the account didn't have.
export async function mergeIntoAccount(cloud, uid) {
  const devicePlans = await store.loadAllPlans(store.LOCAL_USER);
  const cached = await store.loadAllPlans(uid);
  const records = await cloud.list(uid);
  const known = new Set(records.map((r) => r.id));

  const { plans, upload, removeHere } = mergePlans(newestById(cached, devicePlans), records);

  const uploads = await Promise.allSettled(upload.map((p) => cloud.put(uid, p)));
  const uploaded = uploads.every((u) => u.status === 'fulfilled');

  for (const p of plans) await store.savePlan(uid, p);
  for (const id of removeHere) await store.deletePlan(uid, id);
  if (uploaded) await store.clearPlans(store.LOCAL_USER);

  return {
    ok: uploaded,
    added: devicePlans.filter((p) => !known.has(p.id)).length,
    index: await store.listPlans(uid),
  };
}

// Save on this device and, when signed in, to the account.
// Returns { ok, synced, index }; synced is null when not signed in.
export async function savePlan(cloud, userId, plan) {
  const { ok, index } = await store.savePlan(userId, plan);
  if (!cloud || userId === store.LOCAL_USER) return { ok, synced: null, index };
  try {
    await cloud.put(userId, plan);
    return { ok, synced: true, index };
  } catch {
    return { ok, synced: false, index };
  }
}

export async function deletePlan(cloud, userId, planId) {
  const res = await store.deletePlan(userId, planId);
  if (cloud && userId !== store.LOCAL_USER) {
    try { await cloud.remove(userId, planId); } catch { /* resynced at next sign-in */ }
  }
  return res;
}

// Apply changes from another device to the local cache (newest wins).
// Returns { changed, index }: changed = ids of plans that were updated.
export async function applyRemote(uid, records) {
  const changed = [];
  for (const r of records) {
    const mine = await store.loadPlan(uid, r.id);
    if (r.deleted) {
      if (mine && (mine.lastEdited || 0) <= r.lastEdited) {
        await store.deletePlan(uid, r.id);
        changed.push(r.id);
      }
    } else if (r.plan && (!mine || (mine.lastEdited || 0) < r.lastEdited)) {
      await store.savePlan(uid, r.plan);
      changed.push(r.id);
    }
  }
  return { changed, index: await store.listPlans(uid) };
}

// Sign-out: drop the account's cached plans from this device (they stay in
// the account), so the next person on a shared computer doesn't see them.
// Anything the account hasn't received yet is sent first; if that fails the
// cache is kept so nothing is lost. Returns { ok }.
export async function forgetAccountOnDevice(cloud, uid) {
  try {
    const { ok } = await mergeIntoAccount(cloud, uid);
    if (!ok) return { ok: false };
  } catch {
    return { ok: false };
  }
  return store.clearPlans(uid);
}
