// Named concentrations that live as separate program IDs, plus helpers to
// swap one for another on a plan. In-major pathways (PSC, BME, DSC, …) use
// track_n_of + trackChoices; switching a track also drops courses that only
// filled the previous area so the new list has room.

import { getTrackChoice, withTrackChoice, withCourseMeta } from './model.js';
import { computeProgress } from './progress.js';
import { listingsOf } from './crossList.js';

export const PROGRAM_FAMILIES = [
  {
    id: 'biology',
    noun: 'Track',
    members: [
      'biol-ba',
      'biol-bs-general',
      'biol-bs-biochem',
      'biol-bs-celldev',
      'biol-bs-compbio',
      'biol-bs-ecoevo',
      'biol-bs-microbio',
      'biol-bs-molgen',
      'biol-bs-neuro',
      'biol-bs-clintrans',
    ],
  },
  {
    id: 'business',
    noun: 'Concentration',
    members: [
      'major-bus-bs',
      'major-bus-acc-bs',
      'major-bus-ba-bs',
      'major-bus-ent-bs',
      'major-bus-fin-bs',
      'major-bus-is-bs',
      'major-bus-mkt-bs',
    ],
  },
  {
    id: 'english',
    noun: 'Concentration',
    members: [
      'major-engl-ba',
      'major-engl-cw-ba',
      'major-engl-lmc-ba',
      'major-thtr-ba',
    ],
  },
  {
    id: 'dance',
    noun: 'Concentration',
    members: ['major-danc-cep-ba', 'major-danc-ds-ba'],
  },
  {
    id: 'film',
    noun: 'Track',
    members: ['major-fmst-theory-ba', 'major-fmst-production-ba'],
  },
  {
    id: 'gsws',
    noun: 'Track',
    members: ['major-gsws-h-ba', 'major-gsws-ss-ba'],
  },
  {
    id: 'religion',
    noun: 'Track',
    members: ['major-relc-ba', 'major-relps-ba'],
  },
  {
    id: 'aths',
    noun: 'Track',
    members: ['major-aths-a-ba', 'major-aths-b-ba'],
  },
];

const FAMILY_BY_PROGRAM = new Map();
for (const family of PROGRAM_FAMILIES) {
  for (const id of family.members) FAMILY_BY_PROGRAM.set(id, family);
}

export function familyForProgram(programId) {
  return FAMILY_BY_PROGRAM.get(programId) || null;
}

function addListings(into, cid, courses) {
  if (!cid) return;
  for (const id of listingsOf(courses, cid)) into.add(id);
}

function neededCourseIds(progress, courses) {
  const needed = new Set();
  for (const r of progress.programs || []) {
    if (r.usedCourseIds) for (const cid of r.usedCourseIds) addListings(needed, cid, courses);
    for (const g of r.groups || []) {
      for (const cid of g.satisfiedBy || []) addListings(needed, cid, courses);
    }
  }
  for (const r of progress.clusters || []) {
    if (r.usedCourseIds) for (const cid of r.usedCourseIds) addListings(needed, cid, courses);
  }
  if (progress.pwr?.via) for (const cid of progress.pwr.via) addListings(needed, cid, courses);
  return needed;
}

function dropSemesterCourses(plan, ids) {
  const drop = new Set(ids);
  if (!drop.size) return plan;
  let next = {
    ...plan,
    semesters: plan.semesters.map((s) => ({
      ...s,
      courseIds: s.courseIds.filter((c) => !drop.has(c)),
    })),
  };
  for (const cid of drop) next = withCourseMeta(next, cid, null);
  return next;
}

function trackCourses(program, groupId, trackName) {
  if (!trackName) return new Set();
  const group = (program?.requirementGroups || []).find((g) => g.id === groupId);
  if (group?.rule?.type !== 'track_n_of') return new Set();
  return new Set(group.rule.tracks?.[trackName] || []);
}

function hitsSet(cid, set, courses) {
  return listingsOf(courses, cid).some((id) => set.has(id));
}

// Drop semester courses that filled the outgoing program/track and are not
// still assigned to anything else. Transfer/AP credit is left alone.
function dropUnneeded(afterPlan, data, { oldIds, oldTrack, newTrack }) {
  const courses = data.courses;
  const needed = neededCourseIds(computeProgress(afterPlan, data), courses);
  const drop = [];
  for (const s of afterPlan.semesters) {
    for (const cid of s.courseIds) {
      if (hitsSet(cid, needed, courses)) continue;
      const fromOldTrack = oldTrack && hitsSet(cid, oldTrack, courses);
      const fromOldProgram = oldIds && hitsSet(cid, oldIds, courses);
      if (!fromOldTrack && !fromOldProgram) continue;
      if (newTrack && hitsSet(cid, newTrack, courses)) continue;
      drop.push(cid);
    }
  }
  return dropSemesterCourses(afterPlan, drop);
}

export function withProgramSwap(plan, fromId, toId, data) {
  if (!fromId || !toId || fromId === toId) return plan;
  const occupied = [...(plan.majorIds || []), ...(plan.minorIds || [])]
    .filter((id) => id !== fromId);
  if (occupied.includes(toId)) return plan;
  const swap = (ids) => (ids || []).map((id) => (id === fromId ? toId : id));
  const trackChoices = { ...(plan.trackChoices || {}) };
  if (trackChoices[fromId]) {
    trackChoices[toId] = { ...(trackChoices[toId] || {}), ...trackChoices[fromId] };
    delete trackChoices[fromId];
  }
  const swapped = {
    ...plan,
    majorIds: swap(plan.majorIds),
    minorIds: swap(plan.minorIds),
    trackChoices,
  };
  if (!data) return swapped;
  const before = computeProgress(plan, data);
  const oldProg = before.programs.find((p) => p.programId === fromId);
  const oldIds = new Set();
  if (oldProg?.usedCourseIds) for (const cid of oldProg.usedCourseIds) addListings(oldIds, cid, data.courses);
  for (const g of oldProg?.groups || []) {
    for (const cid of g.satisfiedBy || []) addListings(oldIds, cid, data.courses);
  }
  return dropUnneeded(swapped, data, { oldIds });
}

// Record a new concentration / application area and remove courses that only
// counted toward the previous one.
export function switchTrackChoice(plan, data, programId, groupId, trackName) {
  const nextName = trackName || '';
  const prevName = getTrackChoice(plan, programId, groupId);
  if (prevName === nextName) return plan;

  const chosen = withTrackChoice(plan, programId, groupId, nextName || null);
  if (!data || !nextName) return chosen;

  const program = (data.programs || []).find((p) => p.id === programId);
  const inferred = computeProgress(plan, data).programs
    ?.find((p) => p.programId === programId)
    ?.groups?.find((g) => g.id === groupId)
    ?.chosenTrack || '';
  const oldTrackName = prevName || inferred;
  if (!oldTrackName || oldTrackName === nextName) return chosen;

  return dropUnneeded(chosen, data, {
    oldTrack: trackCourses(program, groupId, oldTrackName),
    newTrack: trackCourses(program, groupId, nextName),
  });
}
