// Pure merge rules for syncing plans between this device and an account.
//
// A cloud record is { id, lastEdited, deleted, plan }. Deleting a plan while
// signed in leaves a tombstone ({ deleted: true }) so other devices drop it
// instead of uploading it again. For any plan id the newest lastEdited wins;
// on a tie the cloud copy is kept.

const stamp = (x) => (typeof x?.lastEdited === 'number' ? x.lastEdited : 0);

// Combine plan lists that hold copies of the same plans (newest copy wins).
export function newestById(...lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const p of list || []) {
      if (!p?.id) continue;
      const cur = byId.get(p.id);
      if (!cur || stamp(p) > stamp(cur)) byId.set(p.id, p);
    }
  }
  return [...byId.values()];
}

// Decide what each side needs so both end up with the same plans.
// Returns {
//   plans:      the merged live plans (what the device should hold),
//   upload:     plans the cloud is missing or has an older copy of,
//   removeHere: ids deleted on another device that this device still has,
// }
export function mergePlans(localPlans, cloudRecords) {
  const cloud = new Map((cloudRecords || []).filter((r) => r?.id).map((r) => [r.id, r]));
  const local = new Map((localPlans || []).filter((p) => p?.id).map((p) => [p.id, p]));
  const plans = [];
  const upload = [];
  const removeHere = [];

  for (const [id, p] of local) {
    const r = cloud.get(id);
    if (!r || stamp(p) > stamp(r)) {
      plans.push(p);
      upload.push(p);
    } else if (r.deleted) {
      removeHere.push(id);
    } else {
      plans.push(r.plan);
    }
  }
  for (const [id, r] of cloud) {
    if (!local.has(id) && !r.deleted && r.plan) plans.push(r.plan);
  }
  return { plans, upload, removeHere };
}
