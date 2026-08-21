// Auto-generate: deterministic greedy scheduler with bounded backtracking.
//
// autoGenerate(plan, data, opts) -> { plan, placements, warnings, infeasible,
//                                     violations, attempts }
//
// It never re-implements a rule: requirement status comes from
// computeProgress(), candidates from candidates.js, and the finished plan is
// accepted only after checkAll() — the same validators the UI runs. When a
// generated plan fails its own validators, the offending *flexible* choices
// are banned and the pass reruns (bounded), falling back to the best partial
// plan with explicit warnings instead of hanging or hiding a violation.
//
// Pure functions; no UI or storage imports.

import { getCourseMeta, plannedCourseIds } from './model.js';
import { computeProgress } from './progress.js';
import { checkAll } from './constraints.js';
import { groupCandidates, clusterCandidates, clusterGroupCandidates } from './candidates.js';
import {
  activeGroups, consistentPaths, groupsForCourse, levelSatisfied, isLevelEntry, levelTag,
  describePrereqEntry,
} from './equivalency.js';
import { placementViolatesDeptOrder, parseCourseCode } from './deptSequencing.js';

// ---------------------------------------------------------------- helpers ---

const byCourseId = (a, b) => a.localeCompare(b, 'en');

function clonePlan(plan) {
  return {
    ...plan,
    semesters: plan.semesters.map((s) => ({ ...s, courseIds: [...s.courseIds] })),
    transfer: plan.transfer.map((t) => ({ ...t })),
    courseMeta: { ...(plan.courseMeta || {}) },
  };
}

function semesterIndexMap(plan) {
  const m = new Map();
  plan.semesters.forEach((s, i) => s.courseIds.forEach((c) => m.set(c, i)));
  return m;
}

// Which placed courses may be removed under this scope.
export function computeRemovable(plan, data, scope) {
  const placedIdx = semesterIndexMap(plan);
  const unlocked = [...placedIdx.keys()].filter((cid) => !getCourseMeta(plan, cid).locked);
  if (scope.kind === 'fromSemester') {
    return new Set(unlocked.filter((cid) => placedIdx.get(cid) >= scope.index));
  }
  if (scope.kind === 'program') {
    const uses = computeProgress(plan, data).courseUses;
    return new Set(unlocked.filter((cid) => {
      const u = uses.get(cid) || [];
      return u.length > 0 && u.every((x) => x.id === scope.programId);
    }));
  }
  if (scope.kind === 'group') return new Set(); // auto-fill a gap: purely additive
  return new Set(unlocked); // 'all'
}

// Does an ACTIVE equivalency group already govern these courses? If so it owns
// the choice between them (it carries the user's pathPreference, the "chose
// the X path" warning, and the cross-path add blocking), and the ledger must
// not pre-empt it by committing to one sequence itself.
function equivalencyGoverns(courses, data) {
  const active = activeGroups(data.equivalencyGroups || []);
  return courses.some((c) => active.some((g) => g.paths.some((p) => p.courses.includes(c))));
}

// Which sequence of a sequence_one_of rule the plan is already on (or should
// start): most members already placed, then fewest courses left to add.
function pickSequence(sequences, data, placed) {
  const usable = sequences.filter((seq) => seq.every((c) => data.courses[c]));
  const scored = (usable.length ? usable : sequences).map((seq) => ({
    seq,
    have: seq.filter((c) => placed.has(c)).length,
    left: seq.filter((c) => !placed.has(c)).length,
  }));
  scored.sort((a, b) => (b.have - a.have) || (a.left - b.left) ||
    byCourseId(a.seq.join(), b.seq.join()));
  return scored[0] ? [...scored[0].seq] : [];
}

// ------------------------------------------------------------------ ledger ---

// Rebuilt each semester from real engine progress, so the scheduler can never
// drift from what the validators will actually count.
function buildLedger(plan, data, scope) {
  const progress = computeProgress(plan, data);
  const placed = new Set(plannedCourseIds(plan));
  const bansafe = (list) => [...new Set(list)].filter((cid) => data.courses[cid] && !placed.has(cid)).sort(byCourseId);
  const entries = [];
  const notes = [];

  const wantProgram = (pid) =>
    scope.kind !== 'program' && scope.kind !== 'group' ? true : scope.programId === pid;

  for (const r of progress.programs) {
    if (r.needsData || !wantProgram(r.programId)) continue;
    const program = data.programs.find((p) => p.id === r.programId);
    for (const g of r.groups) {
      if (scope.kind === 'group' && g.id !== scope.groupId) continue;
      const remaining = Math.max(0, g.need - g.have);
      if (!remaining) continue;
      const def = g.isULW
        ? { rule: program.upperLevelWriting?.rule }
        : (program.requirementGroups || []).find((x) => x.id === g.id);
      if (!def?.rule) continue;
      // sequence_one_of: commit to ONE sequence instead of offering the union.
      // The union lets the scheduler place a course that flips computeProgress
      // onto a LONGER sequence (place STAT 277 and "1 of [STAT 190]" silently
      // becomes "2 of [STAT 180, STAT 277]"), which then can't be finished.
      // Same choice rule computeProgress uses: most progress, then shortest.
      const cands = def.rule.type === 'sequence_one_of' &&
                    !equivalencyGoverns(def.rule.sequences.flat(), data)
        ? bansafe(pickSequence(def.rule.sequences, data, placed))
        : bansafe(groupCandidates(def, data, { program, chosenTrack: g.chosenTrack || r.chosenTrack }));
      const flexible = def.rule.type !== 'all_of' && def.rule.type !== 'sequence_one_of';
      // programs with a 100-level cap: once the cap is used up, stop
      // offering further 100-level candidates for their groups
      const cap100 = program.programChecks?.max100Level;
      let finalCands = cands;
      if (cap100 != null) {
        const used100 = [...r.usedCourseIds]
          .filter((x) => (data.courses[x]?.number ?? 999) < 200).length;
        if (used100 >= cap100) {
          const above = cands.filter((x) => (data.courses[x]?.number ?? 999) >= 200);
          // A group whose options are ALL 100-level (PSC BS's "CSC 161 /
          // CSC 171 / MATH 165" prerequisite) would be emptied by the cap and
          // could never be satisfied. The cap limits how many 100-level
          // courses COUNT toward the major body - and the source note excludes
          // prerequisites from that count - so it must never remove a group's
          // last option. checkDepartmentCap still reports a real overage.
          if (above.length) finalCands = above;
        }
      }
      entries.push({
        key: `${program.id}::${g.id}`,
        need: remaining,
        candidates: finalCands,
        flexible,
        rule: def.rule,
        reason: `${program.name} ${program.degree} — ${g.label}` +
          (g.chosenTrack ? ` (${g.chosenTrack})` : ''),
        kind: 'program',
      });
    }
  }

  if (scope.kind !== 'program' && scope.kind !== 'group') {
    for (const r of progress.clusters) {
      if (r.complete) continue;
      const cluster = data.clusters.find((c) => c.id === r.clusterId);
      const { compoundOptions } = clusterCandidates(cluster, data, data.policy);
      // courses another cluster already uses can't be reused
      const usedElsewhere = new Set(
        progress.clusters.filter((x) => x.clusterId !== r.clusterId)
          .flatMap((x) => [...x.usedCourseIds]),
      );
      r.groups.forEach((g, gi) => {
        const remaining = Math.max(0, g.need - g.have);
        if (!remaining) return;
        entries.push({
          key: `cluster::${cluster.id}::g${gi}`,
          need: remaining, // for credit-unit groups this is remaining credits
          unit: g.unit,
          candidates: bansafe(clusterGroupCandidates(cluster.groups[gi], data.policy))
            .filter((c) => !usedElsewhere.has(c)),
          flexible: true,
          clusterId: cluster.id,
          reason: `Cluster: ${cluster.name}`,
          kind: 'cluster',
        });
      });
      if (compoundOptions.length && !r.complete) {
        notes.push(
          `Cluster "${cluster.name}" also has compound options (${compoundOptions
            .map((o) => o.text).join('; ')}) that auto-generate leaves for manual placement.`,
        );
      }
    }
    if (!progress.pwr.satisfied && !progress.pwr.transferOnly && !placed.has('WRTG 105')) {
      entries.push({
        key: 'pwr', need: 1, candidates: ['WRTG 105'], flexible: false,
        reason: 'Primary Writing Requirement', kind: 'pwr',
      });
    }
  }

  return { entries, notes, progress };
}

// -------------------------------------------------- prerequisite machinery ---

function orGroupSatisfied(orGroup, placedBeforeSet, eqGroups) {
  return orGroup.some((p) => (isLevelEntry(p)
    ? levelSatisfied(levelTag(p), placedBeforeSet, eqGroups)
    : placedBeforeSet.has(p)));
}

// Choose which member of an OR-group to schedule when none is placed:
// in-catalog, non-stub, shortest own chain, then alphabetical.
function pickOrMember(orGroup, data, seen) {
  const scored = orGroup
    .filter((cid) => data.courses[cid])
    .map((cid) => {
      const c = data.courses[cid];
      const depth = chainDepth(cid, data, new Set(seen));
      return { cid, s: [c.stub ? 1 : 0, depth, cid] };
    })
    .sort((a, b) => (a.s[0] - b.s[0]) || (a.s[1] - b.s[1]) || byCourseId(a.s[2], b.s[2]));
  return scored[0]?.cid || null;
}

function chainDepth(cid, data, seen = new Set()) {
  if (seen.has(cid)) return 0; // cycle guard
  seen.add(cid);
  const c = data.courses[cid];
  if (!c || !c.prereqs?.length) return 0;
  let d = 0;
  for (const g of c.prereqs) {
    const best = Math.min(...g.map((p) => (data.courses[p] ? chainDepth(p, data, seen) + 1 : 0)), Infinity);
    d = Math.max(d, best === Infinity ? 0 : best);
  }
  return d;
}

// Human-readable chain "CSC 171 → CSC 172 → CSC 173".
function chainString(cid, data, placedSet) {
  const parts = [cid];
  let cur = data.courses[cid];
  const guard = new Set([cid]);
  while (cur?.prereqs?.length) {
    const g = cur.prereqs.find((x) => !x.some((p) => placedSet.has(p)));
    if (!g) break;
    const next = pickOrMember(g, data, guard);
    if (!next || guard.has(next)) break;
    guard.add(next);
    parts.unshift(next);
    cur = data.courses[next];
  }
  return parts.join(' → ');
}

// -------------------------------------------------------------- one pass ----

function generateOnce(plan, data, { scope, targetLoad, maxLoad, bans, pathPreference, relaxDeptOrder = false }) {
  const warnings = [];
  const placements = [];
  const eqGroups = data.equivalencyGroups || [];
  const removable = computeRemovable(plan, data, scope);

  let p = clonePlan(plan);
  p.semesters = p.semesters.map((s) => ({
    ...s, courseIds: s.courseIds.filter((c) => !removable.has(c)),
  }));
  for (const cid of removable) delete p.courseMeta[cid];

  const startIdx = scope.kind === 'fromSemester' ? Math.min(scope.index, p.semesters.length) : 0;
  const lastIdx = p.semesters.length - 1;
  const term = (i) => p.semesters[i].term;

  // `mandatory` marks a placement the retry loop must never ban: the course is
  // the only way to satisfy some non-flexible entry (all_of / sequence_one_of
  // member, prerequisite support, PWR). Banning one of those makes its
  // requirement permanently unsatisfiable instead of trying another
  // combination.
  const place = (cid, semIdx, reason, mandatory = false) => {
    p.semesters[semIdx] = {
      ...p.semesters[semIdx],
      courseIds: [...p.semesters[semIdx].courseIds, cid],
    };
    p.courseMeta[cid] = { source: 'auto', locked: false, reason };
    placements.push({ courseId: cid, semesterId: p.semesters[semIdx].id, semesterLabel: p.semesters[semIdx].label, reason, mandatory });
  };

  const offeredOk = (c, t) => (c.offeredVerified ? c.offered.includes(t) : true);
  const offeringCaveat = (c) => (c.offeredVerified ? '' : ' (offering terms unverified)');

  // ---- equivalency paths: a real, explainable choice point --------------
  // Locked/manual/transfer courses already in the plan narrow the consistent
  // paths; the generator resolves any remaining choice ONCE per group, by
  // preference, and from then on cross-path courses are simply ineligible.
  const pathChoice = new Map(); // groupId -> pathId
  const equivGroupsActive = activeGroups(eqGroups);

  // `pinned` = courses a non-flexible entry (all_of / sequence_one_of member,
  // prerequisite support, PWR) names outright. A program that requires PHYS 121
  // by name has already chosen its intro-physics path; picking a different one
  // on offering grounds would make that requirement permanently unsatisfiable.
  const resolveEquivGroups = (candidateSet, placedSet, currentTerm, pinned = new Set()) => {
    for (const g of equivGroupsActive) {
      if (pathChoice.has(g.id)) continue;
      if (!g.paths.some((p) => p.courses.some((c) => candidateSet.has(c)))) continue;
      const possible = consistentPaths(g, placedSet);
      if (possible.size === 0) continue; // pre-existing conflict: not ours to resolve
      let options = g.paths.filter((p) =>
        possible.has(p.id) &&
        p.courses.every((c) => data.courses[c] && !bans.has(c)));
      if (!options.length) continue;
      // a pinned course decides the group; only fall back to scoring when no
      // still-possible path carries one (or several do, and it's a real choice)
      const pinnedOptions = options.filter((p) => p.courses.some((c) => pinned.has(c)));
      if (pinnedOptions.length) options = pinnedOptions;
      // a "choice" only exists among paths the pool can actually draw from
      const withCandidates = options.filter((p) => p.courses.some((c) => candidateSet.has(c)));
      if (withCandidates.length) options = withCandidates;
      const scorePath = (p) => {
        const firstUnplaced = p.courses.find((c) => !placedSet.has(c));
        const fc = firstUnplaced ? data.courses[firstUnplaced] : null;
        const offeredNow = fc && fc.offeredVerified && !fc.offered.includes(currentTerm) ? 1 : 0;
        const credits = p.courses.reduce((a, c) => a + (data.courses[c]?.credits ?? 4), 0);
        return [
          pathPreference === 'accelerated' ? (p.accelerated ? 0 : 1) : 0,
          offeredNow,          // next course placeable this term
          credits,             // lighter total load
          p.courses.length,
          p.id,
        ];
      };
      const best = [...options].sort((a, b) => cmp(scorePath(a), scorePath(b)))[0];
      pathChoice.set(g.id, best.id);
      if (options.length > 1) {
        warnings.push(`${g.name}: chose the ${best.name} path` +
          (pathPreference === 'accelerated' && best.accelerated ? ' (accelerated preference)' : '') +
          '; switch by locking a course from another path and regenerating.');
      }
    }
  };

  const eligibleByEquiv = (cid, placedSet) => {
    for (const { group, paths } of groupsForCourse(eqGroups, cid)) {
      const chosen = pathChoice.get(group.id);
      if (chosen && !paths.some((p) => p.id === chosen)) return false;
      const possible = consistentPaths(group, placedSet);
      if (possible.size && !paths.some((p) => possible.has(p.id))) return false;
    }
    return true;
  };

  const equivReasonSuffix = (cid) => {
    for (const { group, paths } of groupsForCourse(eqGroups, cid)) {
      const chosen = pathChoice.get(group.id);
      const p = paths.find((x) => x.id === chosen);
      if (p) return ` · ${group.name}: ${p.name} path`;
    }
    return '';
  };

  let ledgerNotes = [];

  for (let s = startIdx; s <= lastIdx; s++) {
    const { entries, notes } = buildLedger(p, data, scope);
    ledgerNotes = notes;
    if (!entries.length) break;

    // support entries: prereqs of required candidates that nothing else provides
    const placedAll = new Set(plannedCourseIds(p));
    const poolSet = new Set(entries.flatMap((e) => e.candidates));
    const pinnedSet = new Set(entries.filter((e) => !e.flexible).flatMap((e) => e.candidates));
    resolveEquivGroups(poolSet, placedAll, term(s), pinnedSet);
    for (const e of entries) e.candidates = e.candidates.filter((c) => eligibleByEquiv(c, placedAll));
    const support = [];
    const needSupport = (cid, forWhat, depthGuard) => {
      const c = data.courses[cid];
      if (!c || depthGuard.has(cid)) return;
      depthGuard.add(cid);
      for (const g of c.prereqs || []) {
        if (g.some((x) => isLevelEntry(x)
          ? levelSatisfied(levelTag(x), placedAll, eqGroups)
          : (placedAll.has(x) || poolSet.has(x) || support.some((e) => e.candidates[0] === x)))) continue;
        const allowed = g.filter((x) => !isLevelEntry(x) && eligibleByEquiv(x, placedAll));
        const member = pickOrMember(allowed, data, depthGuard);
        if (!member) continue;
        support.push({
          key: `support::${member}`, need: 1, candidates: [member], flexible: false,
          reason: `Prerequisite for ${forWhat}`, kind: 'support',
        });
        needSupport(member, member, depthGuard);
      }
    };
    for (const e of entries) {
      if (e.kind !== 'program' && e.kind !== 'pwr') continue;
      for (const cid of e.candidates.slice(0, e.need + 2)) needSupport(cid, cid, new Set());
    }
    const allEntries = [...support, ...entries];

    // scoring inputs over the current pool (memoized per semester)
    const pool = [...new Set(allEntries.flatMap((e) => e.candidates))];
    // members of FORCED entries (every remaining candidate is needed) are
    // mandatory - treat them as maximally urgent regardless of how many
    // other groups also list them, so they can't languish behind
    // single-purpose electives while the strand-guard holds a whole
    // department's higher-numbered courses behind them
    const forcedSet = new Set();
    for (const e of allEntries) {
      if (e.need > 0 && e.candidates.length > 0 && e.candidates.length <= e.need) {
        e.candidates.forEach((c) => forcedSet.add(c));
      }
    }
    const scarcity = new Map(pool.map((cid) => [cid,
      forcedSet.has(cid) ? 1 : allEntries.filter((e) => e.candidates.includes(cid)).length]));
    const gating = new Map(pool.map((cid) => [cid,
      pool.filter((other) => other !== cid &&
        (data.courses[other]?.prereqs || []).some((g) => g.includes(cid))).length]));
    const depthCache = new Map();
    const depthOf = (cid) => {
      if (!depthCache.has(cid)) depthCache.set(cid, chainDepth(cid, data));
      return depthCache.get(cid);
    };
    const heightCache = new Map();
    const heightOf = (cid) => {
      if (!heightCache.has(cid)) heightCache.set(cid, heightAbove(cid, pool, data));
      return heightCache.get(cid);
    };

    const placedBefore = new Set([
      ...p.transfer.map((t) => t.courseId),
      ...p.semesters.slice(0, s).flatMap((x) => x.courseIds),
    ]);
    const credits = () => p.semesters[s].courseIds
      .reduce((a, cid) => a + (data.courses[cid]?.credits ?? 4), 0);

    // (c) PWR first, in the first scoped semester
    const pwrEntry = allEntries.find((e) => e.kind === 'pwr');
    if (pwrEntry && s === startIdx && !placedAll.has('WRTG 105') &&
        credits() + (data.courses['WRTG 105']?.credits ?? 4) <= maxLoad) {
      place('WRTG 105', s, 'Primary Writing Requirement — placed first', true);
      pwrEntry.need = 0;
    }

    // greedy fill toward target load
    let safety = 60;
    while (credits() < targetLoad && safety-- > 0) {
      const placedNow = new Set(plannedCourseIds(p));
      let best = null;
      for (const e of allEntries) {
        if (e.need <= 0) continue;
        for (const cid of e.candidates) {
          if (placedNow.has(cid) || bans.has(cid)) continue;
          const c = data.courses[cid];
          if (!c) continue;
          if (!offeredOk(c, term(s))) continue;
          if (credits() + c.credits > maxLoad) continue;
          if (!eligibleByEquiv(cid, placedNow)) continue;
          if ((c.prereqs || []).some((g) => !orGroupSatisfied(g, placedBefore, eqGroups))) continue;
          // HARD constraint (same tier as offering/prerequisites): never
          // place a course where it would break same-department ascending-
          // number order against anything already in the plan - including
          // locked/kept courses in later semesters. Plan-level overrides
          // (plan.sequencingOverrides) are honored via the guard.
          if (!relaxDeptOrder && placementViolatesDeptOrder(p, cid, s)) continue;
          // Strand-guard: placing cid must leave every requirement group
          // future-satisfiable. Once cid (dept D, number n) is placed in
          // this semester, same-department candidates numbered BELOW n can
          // only ever go in this-or-earlier semesters - so they stop
          // counting as future capacity. Block cid if that would drop any
          // group below its remaining need. (This is what makes the hard
          // ascending-number rule feasible under forward semester filling.)
          if (!relaxDeptOrder) {
            const me = parseCourseCode(cid);
            if (me) {
              let strands = false;
              for (const e2 of allEntries) {
                const needAfter = e2 === e ? e2.need - 1 : e2.need;
                if (needAfter <= 0) continue;
                let fut = 0;   // candidates still placeable AFTER cid lands here
                let avail = 0; // candidates available regardless of the ordering rule
                for (const c2 of e2.candidates) {
                  if (c2 === cid || placedNow.has(c2) || bans.has(c2)) continue;
                  avail++;
                  const p2 = parseCourseCode(c2);
                  if (!p2 || p2.dept !== me.dept || p2.number >= me.number) fut++;
                }
                // causal check: only block cid if THIS placement is what
                // pushes the entry under its need - an entry that is short
                // on candidates anyway (data gap, narrowed path) must not
                // veto unrelated placements
                if (fut < needAfter && avail >= needAfter) {
                  if (globalThis.__AUTOGEN_DEBUG) {
                    console.error(`[strand-guard] S${s + 1}: ${cid} blocked by entry "${e2.key}" (need ${needAfter}, future ${fut}, avail ${avail})`);
                  }
                  strands = true; break;
                }
              }
              if (strands) continue;
            }
          }
          const mustNow = s + heightOf(cid) >= lastIdx ? 0 : 1;
          const score = [
            mustNow,                                        // chains that must start now
            scarcity.get(cid) ?? 9,                         // (a) single-purpose first
            -(gating.get(cid) ?? 0),                        // (b) unlock prerequisites early
            -(c.offeredVerified && c.offered.length === 1 && c.offered[0] === term(s) ? 1 : 0), // scarce offerings now
            c.stub ? 1 : 0,                                 // verified data first
            // lower course numbers first: keeps the department-ascending
            // hard rule feasible under forward semester filling (placing a
            // high number early would strand its lower-numbered siblings)
            parseCourseCode(cid)?.number ?? 999,
            depthOf(cid),                                   // shallow chains as final nudge
            cid,
          ];
          if (!best || cmp(score, best.score) < 0) best = { cid, e, score };
        }
      }
      if (!best) break;
      const c = data.courses[best.cid];
      // mandatory if ANY non-flexible entry lists it - not just the entry it
      // scored under, since one course can serve a flexible elective and an
      // all_of core group at the same time
      const mandatory = allEntries.some((e) => !e.flexible && e.candidates.includes(best.cid));
      place(best.cid, s, best.e.reason + equivReasonSuffix(best.cid) + offeringCaveat(c), mandatory);
      best.e.need -= best.e.unit === 'credits' ? c.credits : 1;
      for (const e of allEntries) {
        if (e !== best.e) e.candidates = e.candidates.filter((x) => x !== best.cid);
      }
    }
  }

  // diagnostics for anything still unmet
  const { entries: leftover, notes } = buildLedger(p, data, scope);
  const infeasible = [];
  const placedSet = new Set(plannedCourseIds(p));
  for (const e of leftover) {
    const sample = e.candidates.filter((cid) => !bans.has(cid)).slice(0, 4);
    let why = 'no eligible course fit within the remaining semesters and credit caps';
    const creditsInSem = (i) => p.semesters[i].courseIds
      .reduce((a, x) => a + (data.courses[x]?.credits ?? 4), 0);
    for (const cid of sample) {
      // blocked everywhere by the department-ascending rule (a semester
      // that is ordering-legal but already at the credit cap is just as
      // unavailable, so count it as blocked for this diagnosis)?
      const cCredits = data.courses[cid]?.credits ?? 4;
      const openSems = p.semesters.map((_, i) => i).filter((i) => i >= startIdx);
      const orderBlockedSomewhere = openSems.some((i) => placementViolatesDeptOrder(p, cid, i));
      if (openSems.length && orderBlockedSomewhere &&
          openSems.every((i) => placementViolatesDeptOrder(p, cid, i) ||
                                creditsInSem(i) + cCredits > maxLoad)) {
        const me = parseCourseCode(cid);
        const blocker = p.semesters.flatMap((sem) => sem.courseIds)
          .find((o) => { const x = parseCourseCode(o); return x && me && x.dept === me.dept && x.number > me.number; });
        why = `${cid} is blocked by the same-department ordering rule` +
          (blocker ? ` (${blocker} is already placed earlier)` : '') +
          ` - add a sequencing override for the pair or adjust placements`;
        break;
      }
      const levelBlocked = (data.courses[cid]?.prereqs || [])
        .find((g) => g.some(isLevelEntry) && !orGroupSatisfied(g, placedSet, data.equivalencyGroups || []));
      if (levelBlocked) {
        why = `${cid} requires ${levelBlocked.map((x) => describePrereqEntry(x, data.equivalencyGroups || [])).join(' or ')}, which the plan does not yet complete`;
        break;
      }
      const depth = chainDepth(cid, data);
      if (startIdx + depth > lastIdx) {
        why = `${cid} requires ${depth} sequential prerequisite course${depth > 1 ? 's' : ''} ` +
          `(${chainString(cid, data, placedSet)}); that chain no longer fits — start it by semester ${lastIdx - depth + 1}`;
        break;
      }
      const c = data.courses[cid];
      if (c?.offeredVerified) {
        const remainingTerms = new Set(p.semesters.slice(startIdx).map((x) => x.term));
        if (![...remainingTerms].some((t) => c.offered.includes(t))) {
          why = `${cid} is only offered in ${c.offered.join('/')} and no such semester remains in scope`;
          break;
        }
      }
    }
    infeasible.push({
      requirement: e.reason,
      remaining: e.need,
      unit: e.unit || 'courses',
      message: `${e.reason}: ${e.need} ${e.unit === 'credits' ? 'credits' : `course${e.need > 1 ? 's' : ''}`} still unmet — ${why}.`,
    });
  }
  warnings.push(...notes, ...ledgerNotes.filter((n) => !notes.includes(n)));

  return {
    plan: p, placements, warnings: [...new Set(warnings)], infeasible,
    pathChoices: Object.fromEntries(pathChoice),
  };
}

function cmp(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}


// Longest chain of pool courses stacked above cid (how many sequential
// semesters must follow it).
function heightAbove(cid, pool, data, seen = new Set()) {
  if (seen.has(cid)) return 0;
  seen.add(cid);
  let h = 0;
  for (const other of pool) {
    if (other === cid) continue;
    if ((data.courses[other]?.prereqs || []).some((g) => g.includes(cid))) {
      h = Math.max(h, 1 + heightAbove(other, pool, data, seen));
    }
  }
  return h;
}

// Every requirement group's full option set, so the retry loop can tell a
// swap from a self-inflicted dead end. Banning is meant to try a DIFFERENT
// combination; banning a group's last viable option instead makes that
// requirement impossible, and the generator can never recover.
function requirementOptionSets(plan, data) {
  const out = [];
  const progress = computeProgress(plan, data);
  for (const r of progress.programs) {
    if (r.needsData) continue;
    const program = data.programs.find((p) => p.id === r.programId);
    if (!program) continue;
    for (const g of r.groups) {
      const def = g.isULW
        ? { rule: program.upperLevelWriting?.rule }
        : (program.requirementGroups || []).find((x) => x.id === g.id);
      if (!def?.rule) continue;
      const options = groupCandidates(def, data, { program, chosenTrack: g.chosenTrack || r.chosenTrack })
        .filter((c) => data.courses[c]);
      if (options.length) out.push({ options: new Set(options), need: g.need });
    }
  }
  for (const r of progress.clusters) {
    const cluster = data.clusters.find((c) => c.id === r.clusterId);
    if (!cluster) continue;
    r.groups.forEach((g, gi) => {
      if (!cluster.groups[gi]) return;
      const options = clusterGroupCandidates(cluster.groups[gi], data.policy)
        .filter((c) => data.courses[c]);
      // credit-unit groups: needing at least one surviving option is the
      // conservative floor (a credit total can't be compared to a count)
      if (options.length) out.push({ options: new Set(options), need: g.unit === 'credits' ? 1 : g.need });
    });
  }
  return out;
}

function banStarvesRequirement(cid, sets, bans) {
  for (const s of sets) {
    if (!s.options.has(cid)) continue;
    let left = 0;
    for (const c of s.options) if (c !== cid && !bans.has(c)) left++;
    if (left < s.need) return true;
  }
  return false;
}

// ------------------------------------------------------------- entry point ---

export function autoGenerate(plan, data, opts = {}) {
  const {
    scope = { kind: 'all' },
    targetLoad = 16,
    maxLoad = 18,
    maxRetries = 50,
    pathPreference = 'auto', // 'auto' | 'accelerated'
  } = opts;

  const strict = runPhase(plan, data, { scope, targetLoad, maxLoad, maxRetries, pathPreference, relaxDeptOrder: false });
  if (!strict.infeasible.length) return strict;

  // The same-department ascending rule is advisory (checkDepartmentSequencing
  // emits warnings, not errors), but enforcing it as a hard placement
  // constraint can make a correctly-encoded degree unschedulable - e.g. the ME
  // BS core needs 16 ME courses in ascending order whose fixed fall/spring
  // offerings simply don't fit 8 semesters. Finishing the degree outranks the
  // heuristic, so retry without it and let the ordering surface as the
  // warnings it actually is.
  const relaxed = runPhase(plan, data, { scope, targetLoad, maxLoad, maxRetries, pathPreference, relaxDeptOrder: true });
  const errs = (r) => r.violations.filter((v) => v.severity === 'error').length;
  if (cmp([errs(relaxed), relaxed.infeasible.length], [errs(strict), strict.infeasible.length]) >= 0) return strict;

  relaxed.warnings = [
    ...relaxed.warnings,
    'Some requirements could not be met in ascending course-number order, so ' +
    'auto-generate relaxed the same-department ordering preference. Review the ' +
    'ordering warnings below — keep a pair with "Allow", or move courses manually.',
  ];
  relaxed.relaxedDeptOrder = true;
  return relaxed;
}

function runPhase(plan, data, { scope, targetLoad, maxLoad, maxRetries, pathPreference, relaxDeptOrder }) {
  const bans = new Set();
  const optionSets = requirementOptionSets(plan, data);
  const tryBan = (cid) => {
    if (bans.has(cid) || banStarvesRequirement(cid, optionSets, bans)) return false;
    bans.add(cid);
    return true;
  };
  let best = null;

  for (let attempt = 1; attempt <= Math.max(1, maxRetries); attempt++) {
    const result = generateOnce(plan, data, { scope, targetLoad, maxLoad, bans, pathPreference, relaxDeptOrder });
    const { violations } = checkAll(result.plan, data);
    const autoIds = new Set(result.placements.map((x) => x.courseId));
    const errors = violations.filter((v) => v.severity === 'error');
    const autoErrors = errors.filter((v) =>
      (v.courseId && autoIds.has(v.courseId)) ||
      (v.courseIds && v.courseIds.some((c) => autoIds.has(c))));

    const scoreOf = (r, errs) => [errs.length, r.infeasible.length, -r.placements.length];
    const candidate = { ...result, violations, attempts: attempt };
    if (!best || cmp(scoreOf(candidate, errors), scoreOf(best, best.violations.filter((v) => v.severity === 'error'))) < 0) {
      best = candidate;
    }

    if (autoErrors.length === 0 && result.infeasible.length === 0) {
      return best === candidate ? candidate : { ...candidate };
    }

    // ban the flexible choices implicated by the failures, then retry
    let bannedSomething = false;
    for (const v of autoErrors) {
      const implicated = [
        ...(v.courseId ? [v.courseId] : []),
        ...(v.courseIds || []),
      ].filter((c) => autoIds.has(c) && !bans.has(c));
      for (const cid of implicated) {
        const pl = result.placements.find((x) => x.courseId === cid);
        if (pl && !pl.mandatory && tryBan(cid)) bannedSomething = true;
      }
    }
    // infeasibilities caused by the department-ordering rule: ban the
    // flexible auto-placed blocker (the higher-numbered same-dept course
    // that got in first) and try a different combination
    for (const inf of result.infeasible) {
      const m = inf.message.match(/\(([A-Z]{2,5} \d{2,3}[A-Z]{0,2}) is already placed earlier\)/);
      const blocker = m?.[1];
      if (!blocker || bans.has(blocker) || !autoIds.has(blocker)) continue;
      const pl = result.placements.find((x) => x.courseId === blocker);
      if (pl && !pl.mandatory && tryBan(blocker)) bannedSomething = true;
    }
    if (globalThis.__AUTOGEN_DEBUG) {
      // opt-in dev trace: set globalThis.__AUTOGEN_DEBUG = true before calling
      console.error(`[autogen] attempt ${attempt}: errors=${errors.length} infeasible=${result.infeasible.length}` +
        ` bans=[${[...bans].join(', ')}]` +
        (result.infeasible[0] ? ` | ${result.infeasible[0].message.slice(0, 140)}` : ''));
    }
    if (autoErrors.length === 0 && result.infeasible.length > 0 && !bannedSomething) {
      // infeasible but nothing attributable to swap - return the best attempt
      break;
    }
    if (autoErrors.length > 0 && !bannedSomething) break; // not attributable to a swappable choice
  }

  best.warnings = [
    ...best.warnings,
    ...(best.violations.some((v) => v.severity === 'error')
      ? ['Auto-generate could not produce a fully valid plan; the best attempt is shown with its remaining rule violations.']
      : []),
  ];
  return best;
}
