// Swap (or add) a requirement option from the degree audit.
//
// Clicking an unplaced alternative:
//   - adds it when the group still has an open slot
//   - replaces the current filler(s) when the group is already using a
//     different option / sequence / track
// Sequences are swapped as a set (MATH 161+162 ↔ MATH 141+142+143). Missing
// prerequisites of the incoming courses are inserted into the earliest
// semester that can hold them.
//
// Pure functions; no UI or storage imports.

import { plannedCourseIds, semesterIndexOf, withCourseMeta, addSemester, withTrackChoice } from './model.js';
import { computeProgress } from './progress.js';
import { isLevelEntry, levelTag, levelSatisfied } from './equivalency.js';
import { coversCourse, expandPlacedSet, listingOnPlan, listingsOf } from './crossList.js';

const MAX_LOAD = 18;

function clonePlan(plan) {
  return {
    ...plan,
    semesters: plan.semesters.map((s) => ({ ...s, courseIds: [...s.courseIds] })),
    transfer: plan.transfer.map((t) => ({ ...t })),
    transferExams: (plan.transferExams || []).map((e) => ({ ...e })),
    courseMeta: { ...(plan.courseMeta || {}) },
    trackChoices: Object.fromEntries(
      Object.entries(plan.trackChoices || {}).map(([pid, groups]) => [pid, { ...groups }]),
    ),
  };
}

function seqKey(seq) {
  return seq.join('\0');
}

function currentSequence(sequences, satisfiedBy) {
  const have = new Set(satisfiedBy || []);
  let best = null;
  for (const seq of sequences) {
    const n = seq.filter((c) => have.has(c)).length;
    const score = n / seq.length;
    if (!best || score > best.score || (score === best.score && n > best.n)) {
      best = { seq, score, n };
    }
  }
  return best && best.n > 0 ? best.seq : null;
}

function trackOf(rule, courseId) {
  if (rule?.type !== 'track_n_of') return null;
  for (const [name, courses] of Object.entries(rule.tracks || {})) {
    if (courses.includes(courseId)) return name;
  }
  return null;
}

function replaceOne(current) {
  return current.length ? [current[current.length - 1]] : [];
}

function incomingCourses(rule, courseId) {
  if (rule?.type === 'sequence_one_of') {
    const seq = (rule.sequences || []).find((s) => s.includes(courseId));
    return seq ? [...seq] : [courseId];
  }
  return [courseId];
}

function outgoingCourses(rule, courseId, group) {
  const current = group.satisfiedBy || [];
  if (current.includes(courseId)) return [];

  if (rule?.type === 'sequence_one_of') {
    const target = (rule.sequences || []).find((s) => s.includes(courseId));
    const cur = currentSequence(rule.sequences || [], current);
    if (!target || !cur || seqKey(target) === seqKey(cur)) return [];
    return cur.filter((c) => current.includes(c) && !target.includes(c));
  }

  if (rule?.type === 'track_n_of') {
    const targetTrack = trackOf(rule, courseId);
    if (group.chosenTrack && targetTrack && targetTrack !== group.chosenTrack) {
      const keep = new Set(rule.tracks[targetTrack] || []);
      return current.filter((c) => !keep.has(c));
    }
  }

  if ((group.need || 0) > 0 && current.length >= group.need) return replaceOne(current);
  return [];
}

export function describeOptionAction(group, rule, courseId, courses) {
  const current = group?.satisfiedBy || [];
  const already = courses
    ? current.some((id) => listingsOf(courses, id).includes(courseId))
    : current.includes(courseId);
  if (already) return { kind: 'placed', incoming: [courseId], outgoing: [] };
  const outgoing = outgoingCourses(rule, courseId, group);
  if (outgoing.length) {
    return { kind: 'swap', incoming: incomingCourses(rule, courseId), outgoing };
  }
  return { kind: 'add', incoming: [courseId], outgoing: [] };
}

function creditsIn(sem, data) {
  return sem.courseIds.reduce((a, id) => a + (data.courses[id]?.credits ?? 4), 0);
}

function offeredOk(course, term) {
  if (!course) return true;
  if (course.offeredVerified) return course.offered.includes(term);
  return true;
}

function earlierSet(plan, semIdx) {
  const s = new Set(plan.transfer.map((t) => t.courseId));
  for (let i = 0; i < semIdx; i++) {
    for (const cid of plan.semesters[i].courseIds) s.add(cid);
  }
  return s;
}

function orGroupSatisfied(orGroup, placed, eqGroups, courses) {
  const fam = courses ? expandPlacedSet(placed, courses) : placed;
  return orGroup.some((p) => (isLevelEntry(p)
    ? levelSatisfied(levelTag(p), fam, eqGroups)
    : fam.has(p)));
}

function prereqsOk(cid, earlier, data, eqGroups) {
  const c = data.courses[cid];
  if (!c?.prereqs?.length) return true;
  return c.prereqs.every((g) => orGroupSatisfied(g, earlier, eqGroups, data.courses));
}

function chainDepth(cid, data, seen = new Set()) {
  if (seen.has(cid)) return 0;
  seen.add(cid);
  const c = data.courses[cid];
  if (!c?.prereqs?.length) return 0;
  let d = 0;
  for (const g of c.prereqs) {
    const best = Math.min(
      ...g.map((p) => (data.courses[p] ? chainDepth(p, data, seen) + 1 : 0)),
      Infinity,
    );
    d = Math.max(d, best === Infinity ? 0 : best);
  }
  return d;
}

function pickPrereqMember(orGroup, data, plan) {
  const placed = new Set(plannedCourseIds(plan));
  const already = orGroup.find((p) => !isLevelEntry(p) && coversCourse(placed, p, data.courses));
  if (already) return already;
  const scored = orGroup
    .filter((p) => !isLevelEntry(p) && data.courses[p])
    .map((cid) => {
      const c = data.courses[cid];
      return { cid, stub: c.notRecentlyOffered ? 2 : (c.stub ? 1 : 0), depth: chainDepth(cid, data) };
    })
    .sort((a, b) => (a.stub - b.stub) || (a.depth - b.depth) || a.cid.localeCompare(b.cid));
  return scored[0]?.cid || null;
}

function removeCourse(plan, cid) {
  return withCourseMeta({
    ...plan,
    semesters: plan.semesters.map((s) => ({ ...s, courseIds: s.courseIds.filter((x) => x !== cid) })),
    transfer: plan.transfer.filter((t) => t.courseId !== cid),
  }, cid, null);
}

function placeIn(plan, cid, semIdx, meta) {
  const next = {
    ...plan,
    semesters: plan.semesters.map((s, i) => (
      i === semIdx ? { ...s, courseIds: [...s.courseIds, cid] } : s
    )),
  };
  return withCourseMeta(next, cid, meta);
}

function slotOk(plan, data, cid, semIdx, { ignoreLoad = false } = {}) {
  const c = data.courses[cid];
  const sem = plan.semesters[semIdx];
  if (!sem) return false;
  if (!offeredOk(c, sem.term)) return false;
  if (!prereqsOk(cid, earlierSet(plan, semIdx), data, data.equivalencyGroups || [])) return false;
  if (!ignoreLoad && creditsIn(sem, data) + (c?.credits ?? 4) > MAX_LOAD) return false;
  return true;
}

function pickSlot(plan, data, cid, minIdx, prefer) {
  const attempts = [
    { idxs: prefer, opts: {} },
    { idxs: range(Math.max(0, minIdx), plan.semesters.length), opts: {} },
    { idxs: prefer, opts: { ignoreLoad: true } },
    { idxs: range(Math.max(0, minIdx), plan.semesters.length), opts: { ignoreLoad: true } },
  ];
  for (const { idxs, opts } of attempts) {
    for (const i of idxs) {
      if (i == null || i < minIdx || i >= plan.semesters.length) continue;
      if (slotOk(plan, data, cid, i, opts)) return i;
    }
  }
  return -1;
}

function range(lo, hi) {
  const out = [];
  for (let i = lo; i < hi; i++) out.push(i);
  return out;
}

function minIndexAfterPrereqs(plan, cid, data) {
  const c = data.courses[cid];
  if (!c?.prereqs?.length) return 0;
  let min = 0;
  for (const g of c.prereqs) {
    const members = g.filter((p) => !isLevelEntry(p));
    const idxs = members.map((p) => {
      const family = listingsOf(data.courses, p);
      for (let i = 0; i < plan.semesters.length; i++) {
        if (plan.semesters[i].courseIds.some((id) => family.includes(id))) return i;
      }
      return -1;
    }).filter((i) => i >= 0);
    if (idxs.length) min = Math.max(min, Math.max(...idxs) + 1);
  }
  return min;
}

function ensurePlaced(plan, data, cid, { prefer, added, reasons, guard }) {
  if (listingOnPlan(plan, cid, data.courses)) return plan;
  if (guard.has(cid)) return plan;
  guard.add(cid);

  const c = data.courses[cid];
  const eqGroups = data.equivalencyGroups || [];
  const placedNow = () => new Set(plannedCourseIds(plan));

  for (const g of c?.prereqs || []) {
    if (orGroupSatisfied(g, placedNow(), eqGroups, data.courses)) continue;
    const member = pickPrereqMember(g, data, plan);
    if (!member) continue;
    if (!reasons.has(member)) reasons.set(member, `Prerequisite for ${cid}`);
    plan = ensurePlaced(plan, data, member, {
      prefer, added, reasons, guard,
    });
  }

  if (listingOnPlan(plan, cid, data.courses)) return plan;

  let minIdx = minIndexAfterPrereqs(plan, cid, data);
  let idx = pickSlot(plan, data, cid, minIdx, prefer);
  let safety = 4;
  while (idx < 0 && safety-- > 0) {
    plan = addSemester(plan);
    minIdx = minIndexAfterPrereqs(plan, cid, data);
    idx = pickSlot(plan, data, cid, minIdx, prefer);
  }
  if (idx < 0) return plan;

  const reason = reasons.get(cid) || null;
  plan = placeIn(plan, cid, idx, { source: 'manual', locked: true, reason });
  added.push(cid);
  return plan;
}

function groupRule(program, groupId) {
  if (groupId === '__ulw') return program.upperLevelWriting?.rule || null;
  return (program.requirementGroups || []).find((g) => g.id === groupId)?.rule || null;
}

export function applyRequirementOption(plan, data, { programId, groupId, courseId }) {
  const program = data.programs.find((p) => p.id === programId);
  if (!program) return { error: 'Program not found.' };
  const rule = groupRule(program, groupId);
  if (!rule) return { error: 'Requirement not found.' };

  const progress = computeProgress(plan, data);
  const group = (progress.programs.find((r) => r.programId === programId)?.groups || [])
    .find((g) => g.id === groupId);
  if (!group) return { error: 'Requirement not found.' };

  const action = describeOptionAction(group, rule, courseId, data.courses);
  if (action.kind === 'placed') return { ...action, plan };
  if (action.kind === 'add') return action;

  let next = clonePlan(plan);
  const vacated = action.outgoing
    .map((cid) => semesterIndexOf(next, cid))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);
  for (const cid of action.outgoing) next = removeCourse(next, cid);

  const added = [];
  const reasons = new Map();
  const prefer = [...vacated];
  for (const cid of action.incoming) {
    if (plannedCourseIds(next).includes(cid)) continue;
    reasons.set(cid, `Swapped into ${group.label}`);
    const before = added.length;
    next = ensurePlaced(next, data, cid, { prefer, added, reasons, guard: new Set() });
    if (added.length === before && !plannedCourseIds(next).includes(cid)) {
      return { error: `Could not find a semester for ${cid}.`, kind: 'swap', ...action };
    }
  }

  const prereqsAdded = added.filter((c) => !action.incoming.includes(c));
  if (rule.type === 'track_n_of') {
    const targetTrack = trackOf(rule, action.incoming[0]);
    if (targetTrack) next = withTrackChoice(next, programId, groupId, targetTrack);
  }
  return {
    kind: 'swap',
    plan: next,
    incoming: action.incoming,
    outgoing: action.outgoing,
    added,
    prereqsAdded,
  };
}

// Place a course from search / a plain audit add, inserting any missing
// CDCS (or curated) prerequisites into earlier semesters.
export function placeCourseWithPrereqs(plan, data, cid, { preferSemesterId } = {}) {
  const existing = listingOnPlan(plan, cid, data.courses);
  if (existing) {
    return existing === cid
      ? { plan, added: [], prereqsAdded: [], error: null }
      : { plan, added: [], prereqsAdded: [], error: `${cid} is already on the plan as ${existing} (cross-listed).` };
  }
  let next = clonePlan(plan);
  const added = [];
  const reasons = new Map();
  const prefer = [];
  if (preferSemesterId) {
    const i = next.semesters.findIndex((s) => s.id === preferSemesterId);
    if (i >= 0) prefer.push(i);
  }
  next = ensurePlaced(next, data, cid, { prefer, added, reasons, guard: new Set() });
  if (!plannedCourseIds(next).includes(cid)) {
    return { plan, added: [], prereqsAdded: [], error: `Could not find a semester for ${cid}.` };
  }
  return {
    plan: next,
    added,
    prereqsAdded: added.filter((c) => c !== cid),
    error: null,
  };
}

// Drag an already-placed course onto another semester. If that landing
// would sit before a CDCS/curated prerequisite, snap to the first legal slot.
export function relocateCourseRespectingPrereqs(plan, data, cid, semId) {
  let next = clonePlan(plan);
  const meta = { ...(next.courseMeta?.[cid] || {}), locked: true };
  next = {
    ...next,
    semesters: next.semesters.map((s) => ({ ...s, courseIds: s.courseIds.filter((x) => x !== cid) })),
  };
  const want = next.semesters.findIndex((s) => s.id === semId);
  if (want < 0) return { plan, error: 'Semester not found.' };
  let minIdx = minIndexAfterPrereqs(next, cid, data);
  let idx = pickSlot(next, data, cid, minIdx, [want]);
  let safety = 4;
  while (idx < 0 && safety-- > 0) {
    next = addSemester(next);
    minIdx = minIndexAfterPrereqs(next, cid, data);
    idx = pickSlot(next, data, cid, minIdx, [want]);
  }
  if (idx < 0) return { plan, error: `Could not find a semester for ${cid}.` };
  return { plan: placeIn(next, cid, idx, meta), error: null };
}
