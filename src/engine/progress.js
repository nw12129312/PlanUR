// Requirement-fill assignment: decides which placed courses count toward which
// requirement groups, deterministically (greedy, in group order), so overlap
// and uniqueness checks operate on an explainable assignment.
// Pure functions; no UI or storage imports.

import { buildContext, isTransfer, transferKind, isWrtgPwr } from './model.js';
import { listingsOf, familyUsed } from './crossList.js';

function matchesFilter(course, filter) {
  if (!course) return false;
  if (filter.depts && !filter.depts.includes(course.dept)) return false;
  if (filter.minNumber != null && course.number < filter.minNumber) return false;
  if (filter.maxNumber != null && course.number > filter.maxNumber) return false;
  if (filter.minCredits != null && course.credits < filter.minCredits) return false;
  if (filter.wOnly && !course.suffix.includes('W')) return false;
  if (filter.exclude && filter.exclude.includes(course.id)) return false;
  return true;
}

function placedListing(ctx, cid) {
  return listingsOf(ctx.courses, cid).find((id) => ctx.placedSet.has(id)) || null;
}

function familyMatchesFilter(ctx, cid, filter) {
  return listingsOf(ctx.courses, cid).some((id) => matchesFilter(ctx.course(id), filter));
}

// Fill one program's requirement groups from available courses.
// `available` = ordered course ids; `used` = set mutated as slots fill.
function fillProgram(program, available, ctx) {
  const used = new Set(); // course ids used by THIS program's main groups
  const groups = [];
  let chosenTrack = null;

  // Programs flagged apIbCreditExcluded (e.g. every Biology program: AP Bio
  // 4/5 and IB Bio 6/7 earn general credit only) never count AP/IB-bucket
  // courses toward their requirements - same mechanism as the cluster-level
  // AP/IB exclusion in fillCluster.
  const apIbBlocked = (cid) => {
    if (!program.apIbCreditExcluded) return false;
    const kind = transferKind(ctx.plan, cid);
    return kind === 'ap' || kind === 'ib';
  };

  const allGroups = [...(program.requirementGroups || [])];
  if (program.upperLevelWriting?.rule) {
    allGroups.push({
      id: '__ulw', label: program.upperLevelWriting.label,
      rule: program.upperLevelWriting.rule, note: program.upperLevelWriting.note,
      allowReuse: true, isULW: true,
    });
  }

  for (const g of allGroups) {
    const rule = g.rule;
    const canUse = (cid) => {
      const actual = placedListing(ctx, cid);
      if (!actual) return false;
      if (!g.allowReuse && familyUsed(used, cid, ctx.courses)) return false;
      return !apIbBlocked(actual);
    };
    const takeActual = (cid) => placedListing(ctx, cid) || cid;
    const take = [];
    let need = 0;

    if (rule.type === 'all_of') {
      need = rule.courses.length;
      for (const cid of rule.courses) {
        if (canUse(cid) && !familyUsed(new Set(take), cid, ctx.courses)) take.push(takeActual(cid));
      }
    } else if (rule.type === 'n_of') {
      need = rule.n;
      for (const cid of rule.options) {
        if (take.length >= need) break;
        if (canUse(cid) && !familyUsed(new Set(take), cid, ctx.courses)) take.push(takeActual(cid));
      }
    } else if (rule.type === 'sequence_one_of') {
      // Pick the sequence with the most progress; need = its length.
      let best = null;
      for (const seq of rule.sequences) {
        const have = [];
        for (const cid of seq) {
          if (canUse(cid) && !familyUsed(new Set(have), cid, ctx.courses)) have.push(takeActual(cid));
        }
        const score = have.length / seq.length;
        if (!best || score > best.score) best = { seq, have, score };
      }
      need = best.seq.length;
      take.push(...best.have);
    } else if (rule.type === 'n_from_filter') {
      need = rule.n;
      for (const cid of ctx.placed) {
        if (take.length >= need) break;
        if (!canUse(cid) || familyUsed(new Set(take), cid, ctx.courses)) continue;
        if (familyMatchesFilter(ctx, cid, rule.filter)) take.push(cid);
      }
    } else if (rule.type === 'track_n_of') {
      need = rule.n;
      const declared = ctx.plan.trackChoices?.[program.id]?.[g.id];
      if (declared && rule.tracks[declared]) {
        chosenTrack = declared;
        const ids = [];
        for (const cid of rule.tracks[declared] || []) {
          if (ids.length >= need) break;
          if (canUse(cid) && !familyUsed(new Set(ids), cid, ctx.courses)) ids.push(takeActual(cid));
        }
        take.push(...ids);
      } else {
        let best = null;
        for (const [name, codes] of Object.entries(rule.tracks)) {
          const have = [];
          for (const cid of codes) {
            if (canUse(cid) && !familyUsed(new Set(have), cid, ctx.courses)) have.push(takeActual(cid));
          }
          if (!best || have.length > best.have.length) best = { name, have };
        }
        chosenTrack = best?.name || null;
        take.push(...(best?.have.slice(0, need) || []));
      }
    } else if (rule.type === 'breadth_outside_track') {
      need = rule.n;
      const coreGroup = (program.requirementGroups || []).find((x) => x.id === rule.trackGroupId);
      const tracks = coreGroup?.rule?.tracks || {};
      for (const [name, codes] of Object.entries(tracks)) {
        if (name === chosenTrack) continue;
        for (const cid of codes) {
          if (take.length >= need) break;
          if (canUse(cid) && !familyUsed(new Set(take), cid, ctx.courses)) take.push(takeActual(cid));
        }
      }
    }

    if (!g.allowReuse) for (const cid of take) used.add(cid);
    groups.push({
      id: g.id, label: g.label, note: g.note || null, isULW: !!g.isULW,
      need, have: take.length, satisfiedBy: take,
      complete: take.length >= need,
      chosenTrack: rule.type === 'track_n_of' ? chosenTrack : undefined,
    });
  }

  const mainGroups = groups.filter((g) => !g.isULW);
  const totNeed = mainGroups.reduce((a, g) => a + g.need, 0);
  const totHave = mainGroups.reduce((a, g) => a + Math.min(g.have, g.need), 0);
  return {
    programId: program.id,
    status: program.status,
    groups,
    usedCourseIds: used,               // main-group courses (reuse groups excluded)
    percent: totNeed ? Math.round((100 * totHave) / totNeed) : 0,
    complete: mainGroups.length > 0 && mainGroups.every((g) => g.complete),
    chosenTrack,
  };
}

// Fill one cluster. Eligibility: UR courses only (no AP/IB/transfer), never
// WRTG 105 variants, never a course already used by another cluster.
// Preference order implements the uniqueness rule: courses unused by any
// program first, then at most `clusterProgram` overlap-cap shared courses.
function fillCluster(cluster, ctx, usedByPrograms, usedByOtherClusters) {
  const { plan, policy } = ctx;
  const groups = [];
  const usedHere = new Set();

  const placedCode = (listed) => listingsOf(ctx.courses, listed).find((id) => ctx.placedSet.has(id));

  const eligible = (cid) => {
    const actual = placedCode(cid);
    return !!actual &&
      !isWrtgPwr(policy, actual) &&
      !isTransfer(plan, actual) &&
      !familyUsed(usedByOtherClusters, actual, ctx.courses) &&
      !familyUsed(usedHere, actual, ctx.courses);
  };

  let sharedUsed = 0;
  const cap = policy.overlapCaps.clusterProgram;

  for (const g of cluster.groups) {
    const need = g.n;
    const take = [];
    const value = g.unit === 'credits'
      ? (cid) => (ctx.course(cid)?.credits ?? 4)
      : () => 1;

    // two passes: unique-first, then shared (respecting the 1-shared cap)
    const grab = (cid) => {
      const actual = placedCode(cid) || cid;
      take.push(actual);
      usedHere.add(actual);
      if (familyUsed(usedByPrograms, actual, ctx.courses)) sharedUsed++;
    };
    for (const pass of ['unique', 'shared']) {
      let got = take.reduce((a, c) => a + value(c), 0);
      if (got >= need) break;
      for (const opt of g.options) {
        got = take.reduce((a, c) => a + value(c), 0);
        if (got >= need) break;
        const codes = opt.codes.filter(eligible)
          .filter((c) => !familyUsed(usedHere, c, ctx.courses));
        if (opt.mode === 'all') {
          // compound option ("X and Y"): every code must be assignable together
          if (codes.length !== opt.codes.length) continue;
          const sharedCodes = codes.filter((c) => familyUsed(usedByPrograms, c, ctx.courses));
          if (pass === 'unique' && sharedCodes.length) continue;
          if (pass === 'shared' && (sharedCodes.length === 0 || sharedUsed + sharedCodes.length > cap)) continue;
          codes.forEach(grab);
        } else {
          // alternatives: take the first code allowed in this pass
          const pick = codes.find((cid) => {
            const shared = familyUsed(usedByPrograms, cid, ctx.courses);
            return pass === 'unique' ? !shared : (shared && sharedUsed < cap);
          });
          if (pick) grab(pick);
        }
      }
    }

    const got = take.reduce((a, c) => a + value(c), 0);
    groups.push({
      id: `${cluster.id}-g${groups.length}`, label: g.note ||
        (g.unit === 'credits' ? `${g.n} credits from the list` : `${g.all ? 'All' : g.n} of the list`),
      need, have: got, unit: g.unit, satisfiedBy: take, complete: got >= need,
    });
  }

  return {
    clusterId: cluster.id,
    status: cluster.status,
    groups,
    usedCourseIds: usedHere,
    sharedWithPrograms: [...usedHere].filter((c) => usedByPrograms.has(c)),
    uniqueCount: [...usedHere].filter((c) => !usedByPrograms.has(c)).length,
    percent: groups.length
      ? Math.round((100 * groups.reduce((a, g) => a + Math.min(g.have, g.need), 0)) /
                   Math.max(1, groups.reduce((a, g) => a + g.need, 0)))
      : 0,
    complete: groups.length > 0 && groups.every((g) => g.complete),
  };
}

// Primary Writing Requirement status.
export function pwrStatus(plan, policy) {
  const placed = new Set();
  for (const s of plan.semesters) for (const c of s.courseIds) placed.add(c);
  const transferIds = new Set(plan.transfer.map((t) => t.courseId));
  for (const combo of policy.pwr.satisfiedBy) {
    if (combo.every((c) => placed.has(c))) return { satisfied: true, via: combo, transferOnly: false };
  }
  for (const combo of policy.pwr.satisfiedBy) {
    if (combo.every((c) => placed.has(c) || transferIds.has(c))) {
      return { satisfied: false, via: combo, transferOnly: true };
    }
  }
  return { satisfied: false, via: null, transferOnly: false };
}

// Main entry: compute the full assignment for a plan.
export function computeProgress(plan, data) {
  const ctx = buildContext(plan, data);
  const programResults = [];
  const usedByPrograms = new Set();

  for (const p of [...ctx.majors, ...ctx.minors]) {
    if (p.status !== 'ACTIVE') {
      programResults.push({
        programId: p.id, status: p.status, groups: [], usedCourseIds: new Set(),
        percent: 0, complete: false, needsData: true,
      });
      continue;
    }
    const r = fillProgram(p, ctx.placed, ctx);
    programResults.push(r);
    for (const cid of r.usedCourseIds) usedByPrograms.add(cid);
    for (const g of r.groups) if (g.isULW) for (const cid of g.satisfiedBy) usedByPrograms.add(cid);
  }

  const clusterResults = [];
  const usedByClusters = new Set();
  for (const cl of ctx.selClusters) {
    const r = fillCluster(cl, ctx, usedByPrograms, usedByClusters);
    clusterResults.push(r);
    for (const cid of r.usedCourseIds) usedByClusters.add(cid);
  }

  // courseId -> [{kind, id, label}] for course-card badges
  const courseUses = new Map();
  const addUse = (cid, use) => {
    if (!courseUses.has(cid)) courseUses.set(cid, []);
    courseUses.get(cid).push(use);
  };
  for (const r of programResults) {
    const p = ctx.programById.get(r.programId);
    for (const g of r.groups || []) {
      for (const cid of g.satisfiedBy) {
        addUse(cid, { kind: p.type, id: p.id, label: `${p.name} ${p.degree}: ${g.label}` });
      }
    }
  }
  for (const r of clusterResults) {
    const cl = ctx.clusterById.get(r.clusterId);
    for (const cid of r.usedCourseIds) addUse(cid, { kind: 'cluster', id: cl.id, label: `Cluster: ${cl.name}` });
  }

  return {
    programs: programResults,
    clusters: clusterResults,
    pwr: pwrStatus(plan, data.policy),
    courseUses,
    usedByPrograms,
    usedByClusters,
  };
}
