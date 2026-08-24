// Cross-listings: the same class offered under two or more department codes
// (CSC 242 / DSCC 242 / BCSC 232). Identified from CDCS Co-Located and from
// matching title + description. Pure functions; no UI or storage imports.

export function listingsOf(courses, cid) {
  const c = courses?.[cid];
  if (!c) return [cid];
  const others = c.crossListings || [];
  if (!others.length) return [cid];
  return [cid, ...others];
}

export function coversCourse(placedSet, cid, courses) {
  if (!placedSet || !cid) return false;
  return listingsOf(courses, cid).some((id) => placedSet.has(id));
}

export function expandPlacedSet(placedSet, courses) {
  const out = new Set(placedSet);
  for (const id of placedSet) {
    for (const a of listingsOf(courses, id)) out.add(a);
  }
  return out;
}

export function listingOnPlan(plan, cid, courses) {
  const family = new Set(listingsOf(courses, cid));
  for (const s of plan.semesters) {
    for (const id of s.courseIds) if (family.has(id)) return id;
  }
  for (const t of plan.transfer || []) {
    if (family.has(t.courseId)) return t.courseId;
  }
  return null;
}

export function markFamilyUsed(used, cid, courses) {
  for (const id of listingsOf(courses, cid)) used.add(id);
}

export function familyUsed(used, cid, courses) {
  return listingsOf(courses, cid).some((id) => used.has(id));
}

export function familyKey(courses, cid) {
  return listingsOf(courses, cid).slice().sort().join('|');
}
