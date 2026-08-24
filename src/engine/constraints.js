// Constraint checks. Every function takes (plan, data [, progress]) and returns
// an array of violations: { ruleId, severity, message, courseId?, semesterId?,
// programId?, clusterId? }. Pure functions; no UI or storage imports.

import { buildContext, isTransfer, transferKind, isWrtgPwr } from './model.js';
import { computeProgress } from './progress.js';
import {
  checkEquivalencyConflicts, levelSatisfied, isLevelEntry, levelTag, describePrereqEntry,
} from './equivalency.js';
import { checkDepartmentSequencing } from './deptSequencing.js';
import { coversCourse, expandPlacedSet, familyKey } from './crossList.js';

const v = (ruleId, severity, message, at = {}) => ({ ruleId, severity, message, ...at });

// -- course can't be scheduled before its prereqs ---------------------------
// Prereq CNF entries are course codes, or "level:<tag>" entries resolved
// through equivalency-group membership (terminal course of any one path).
export function checkPrerequisites(plan, data) {
  const ctx = buildContext(plan, data);
  const eqGroups = data.equivalencyGroups || [];
  const out = [];
  const earlier = new Set();
  for (const t of plan.transfer) earlier.add(t.courseId);
  const earlierFam = () => expandPlacedSet(earlier, ctx.courses);
  const seen = new Set();
  const entrySatisfied = (p, fam) => (isLevelEntry(p)
    ? levelSatisfied(levelTag(p), fam, eqGroups)
    : coversCourse(fam, p, ctx.courses));

  plan.semesters.forEach((sem) => {
    const fam = earlierFam();
    for (const cid of sem.courseIds) {
      const c = ctx.course(cid);
      if (!c || seen.has(cid)) continue;
      seen.add(cid);
      for (const orGroup of c.prereqs || []) {
        if (orGroup.some((p) => entrySatisfied(p, fam))) continue;
        const semSet = new Set(sem.courseIds);
        const inSame = orGroup.some((p) => !isLevelEntry(p) && coversCourse(semSet, p, ctx.courses));
        const names = orGroup.map((p) => describePrereqEntry(p, eqGroups)).join(' or ');
        const sev = c.prereqsVerified ? 'error' : 'warning';
        out.push(v(
          c.prereqsVerified ? 'PREREQ_ORDER' : 'PREREQ_UNVERIFIED', sev,
          inSame
            ? `${cid}: prerequisite (${names}) is scheduled in the same semester - it must come earlier.`
            : `${cid}: prerequisite (${names}) is not scheduled in any earlier semester.` +
              (c.prereqNote ? ` Note: ${c.prereqNote}` : ''),
          { courseId: cid, semesterId: sem.id },
        ));
      }
    }
    for (const cid of sem.courseIds) earlier.add(cid);
  });
  return out;
}

// -- course only placed in a semester it's offered --------------------------
export function checkOfferingSemester(plan, data) {
  const ctx = buildContext(plan, data);
  const out = [];
  for (const sem of plan.semesters) {
    for (const cid of sem.courseIds) {
      const c = ctx.course(cid);
      if (!c) continue;
      if (sem.term === 'summer') {
        if (c.offeredClaim.length && !c.offeredClaim.includes('summer')) {
          out.push(v('OFFERING_TERM', 'warning',
            `${cid} is not listed as offered in summer.`, { courseId: cid, semesterId: sem.id }));
        }
        continue;
      }
      if (!c.offeredVerified) {
        out.push(v('OFFERING_UNVERIFIED', 'info',
          `${cid}: no 2025-26 schedule data sourced; cannot confirm it runs in ${sem.term}.`,
          { courseId: cid, semesterId: sem.id }));
      } else if (!c.offered.includes(sem.term)) {
        out.push(v('OFFERING_TERM', 'warning',
          `${cid} was not scheduled in ${sem.term} in 2025-26 (ran: ${c.offered.join(', ') || 'n/a'}).`,
          { courseId: cid, semesterId: sem.id }));
      }
    }
  }
  return out;
}

// -- per-semester load -------------------------------------------------------
export function checkCreditLoad(plan, data, max = 18, min = 12) {
  const ctx = buildContext(plan, data);
  const out = [];
  for (const sem of plan.semesters) {
    if (!sem.courseIds.length) continue;
    const credits = sem.courseIds.reduce((a, cid) => a + (ctx.course(cid)?.credits ?? 4), 0);
    if (credits > max) {
      out.push(v('LOAD_MAX', 'warning',
        `${sem.label}: ${credits} credit hours exceeds the ${max}-credit overload line.`,
        { semesterId: sem.id }));
    } else if (credits < min && sem.term !== 'summer') {
      out.push(v('LOAD_MIN', 'warning',
        `${sem.label}: ${credits} credit hours is below full-time (${min}).`,
        { semesterId: sem.id }));
    }
  }
  return out;
}

// -- duplicates --------------------------------------------------------------
export function checkDuplicates(plan, data = {}) {
  const courses = data.courses || {};
  const seen = new Map();
  const out = [];
  const spots = [];
  plan.semesters.forEach((s) => s.courseIds.forEach((c) => spots.push([c, s])));
  plan.transfer.forEach((t) => spots.push([t.courseId, null]));
  for (const [cid, sem] of spots) {
    const key = familyKey(courses, cid);
    if (seen.has(key)) {
      const first = seen.get(key);
      const sameCode = first === cid;
      out.push(v('DUPLICATE_COURSE', 'error',
        sameCode
          ? `${cid} appears more than once in the plan.`
          : `${cid} is the same cross-listed course as ${first} — count it once.`,
        { courseId: cid, semesterId: sem?.id }));
    } else {
      seen.set(key, cid);
    }
  }
  return out;
}

// -- overlap caps ------------------------------------------------------------
export function checkOverlap(plan, data, progress) {
  const ctx = buildContext(plan, data);
  const prog = progress || computeProgress(plan, data);
  const out = [];
  const exempt = new Set(data.policy.overlapExemptCourses);

  const entries = prog.programs
    .filter((r) => !r.needsData)
    .map((r) => ({
      r,
      p: ctx.programById.get(r.programId),
      used: new Set([...r.usedCourseIds]),
    }));

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j];
      const shared = [...a.used].filter((c) => b.used.has(c) && !exempt.has(c));
      let cap, ruleId;
      if (a.p.type === 'major' && b.p.type === 'major') {
        ruleId = 'OVERLAP_MAJOR_MAJOR';
        cap = Math.min(a.p.overlapCapOverride ?? data.policy.overlapCaps.majorMajor,
                       b.p.overlapCapOverride ?? data.policy.overlapCaps.majorMajor);
      } else if (a.p.type === 'minor' && b.p.type === 'minor') {
        ruleId = 'OVERLAP_MINOR_MINOR';
        cap = data.policy.overlapCaps.minorMinor;
      } else {
        ruleId = 'OVERLAP_MAJOR_MINOR';
        cap = data.policy.overlapCaps.majorMinor;
      }
      if (shared.length > cap) {
        out.push(v(ruleId, 'error',
          `${a.p.name} ${a.p.degree} and ${b.p.name} ${b.p.degree} share ${shared.length} non-exempt courses (${shared.join(', ')}); the cap is ${cap}.`,
          { programId: a.p.id, programId2: b.p.id, courseIds: shared }));
      }
    }
  }

  // cluster vs program overlap cap (assignment already tries to respect it,
  // so a violation here means the plan structurally exceeds the cap)
  for (const cr of prog.clusters) {
    const cl = ctx.clusterById.get(cr.clusterId);
    for (const e of entries) {
      const shared = cr.sharedWithPrograms.filter((c) => e.used.has(c));
      if (shared.length > data.policy.overlapCaps.clusterProgram) {
        out.push(v('OVERLAP_CLUSTER_PROGRAM', 'error',
          `Cluster "${cl.name}" shares ${shared.length} courses with ${e.p.name} (${shared.join(', ')}); at most 1 is allowed.`,
          { clusterId: cl.id, programId: e.p.id, courseIds: shared }));
      }
    }
  }
  return out;
}

// -- cluster rules -----------------------------------------------------------
export function checkClusterRules(plan, data, progress) {
  const ctx = buildContext(plan, data);
  const prog = progress || computeProgress(plan, data);
  const out = [];
  const majors = ctx.majors;

  // division exclusivity vs each ACTIVE-or-placeholder major (division is
  // known even for NEEDS_DATA_ENTRY programs)
  for (const cl of ctx.selClusters) {
    for (const m of majors) {
      const allowed = m.allowedClusterDivisions
        || data.policy.divisions.filter((d) => d !== m.division && d !== 'engineering');
      if (!allowed.includes(cl.division)) {
        out.push(v('CLUSTER_DIVISION', 'error',
          `Cluster "${cl.name}" is in ${cl.division.replace('-', ' ')}, which is not allowed with the ${m.name} ${m.degree} major (allowed: ${allowed.join(', ').replace(/-/g, ' ')}).`,
          { clusterId: cl.id, programId: m.id }));
      }
      const clDepts = cl.homeDeptCourseDepts || [cl.homeDept];
      if (m.departments?.some((d) => clDepts.includes(d))) {
        out.push(v('CLUSTER_OWN_DEPT', 'error',
          `Cluster "${cl.name}" is homed in ${cl.homeDept}, the department of your ${m.name} major.`,
          { clusterId: cl.id, programId: m.id }));
      }
    }
  }

  // two clusters: distinct divisions, no shared home department
  for (let i = 0; i < ctx.selClusters.length; i++) {
    for (let j = i + 1; j < ctx.selClusters.length; j++) {
      const a = ctx.selClusters[i], b = ctx.selClusters[j];
      if (a.division === b.division) {
        out.push(v('CLUSTER_DIVISION_DISTINCT', 'error',
          `Clusters "${a.name}" and "${b.name}" are both in ${a.division.replace('-', ' ')}; they must cover different divisions.`,
          { clusterId: a.id, clusterId2: b.id }));
      }
      if (a.homeDept && a.homeDept === b.homeDept) {
        out.push(v('CLUSTER_SHARED_DEPT', 'error',
          `Clusters "${a.name}" and "${b.name}" share the home department ${a.homeDept}.`,
          { clusterId: a.id, clusterId2: b.id }));
      }
    }
  }

  // uniqueness: at least 2 of the 3 courses unique (not used by any program
  // or other cluster). Assignment prefers unique courses, so flag only when
  // the completed portion can't reach 2 unique.
  for (const cr of prog.clusters) {
    const cl = ctx.clusterById.get(cr.clusterId);
    const assignedCount = cr.usedCourseIds.size;
    if (assignedCount >= data.policy.clusterMinCourses &&
        cr.uniqueCount < data.policy.clusterUniqueCoursesMin) {
      out.push(v('CLUSTER_UNIQUE_TWO', 'error',
        `Cluster "${cl.name}": only ${cr.uniqueCount} of its courses are unique (not shared with a major/minor/other cluster); at least 2 must be.`,
        { clusterId: cl.id }));
    }
    if (cr.status === 'PARTIAL_PARSE') {
      out.push(v('CLUSTER_PARTIAL_PARSE', 'info',
        `Cluster "${cl.name}" uses a non-standard completion rule; verify against the official listing.`,
        { clusterId: cl.id }));
    }
  }

  // structural exclusions, surfaced for transparency when relevant courses are placed
  const placedWrtg = ctx.placed.filter((c) => isWrtgPwr(data.policy, c));
  if (ctx.selClusters.length && placedWrtg.length) {
    out.push(v('CLUSTER_WRTG', 'info',
      `${placedWrtg.join(', ')} satisfies the Primary Writing Requirement and is never counted toward clusters.`, {}));
  }
  for (const t of plan.transfer) {
    if (ctx.selClusters.length) {
      const kind = t.kind === 'transfer' ? 'Transfer' : t.kind.toUpperCase();
      out.push(v(t.kind === 'transfer' ? 'CLUSTER_TRANSFER' : 'CLUSTER_APIB', 'info',
        `${t.courseId} (${kind} credit) is excluded from cluster requirements.`,
        { courseId: t.courseId }));
    }
  }
  return out;
}

// -- 20-courses-per-department cap -------------------------------------------
export function checkDepartmentCap(plan, data) {
  const ctx = buildContext(plan, data);
  const byDept = new Map();
  for (const cid of new Set(ctx.placed)) {
    const c = ctx.course(cid);
    if (!c) continue;
    byDept.set(c.dept, (byDept.get(c.dept) || 0) + 1);
  }
  const out = [];
  for (const [dept, n] of byDept) {
    if (n > data.policy.maxCoursesPerDepartment) {
      out.push(v('DEPT_20_CAP', 'error',
        `${n} ${dept} courses planned; at most ${data.policy.maxCoursesPerDepartment} from one department count toward the degree.`, {}));
    }
  }
  return out;
}

// -- total credits ------------------------------------------------------------
export function resolveRequiredCredits(plan, data) {
  const ctx = buildContext(plan, data);
  let req = data.policy.standardTotalCredits;
  if (plan.doubleDegree) req = Math.max(req, data.policy.doubleDegreeTotalCredits);
  for (const m of ctx.majors) {
    if (m.totalCreditsOverride) req = Math.max(req, m.totalCreditsOverride);
  }
  return req;
}

export function checkTotalCredits(plan, data) {
  const ctx = buildContext(plan, data);
  const required = resolveRequiredCredits(plan, data);
  let planned = 0;
  for (const cid of new Set(ctx.placed)) planned += ctx.course(cid)?.credits ?? 4;
  const out = [];
  if (planned < required) {
    out.push(v('TOTAL_CREDITS', 'info',
      `${planned} of ${required} required credit hours planned.`, {}));
  }
  const meNote = ctx.majors.find((m) => m.totalCreditsNote);
  if (meNote) out.push(v('TOTAL_CREDITS', 'warning', meNote.totalCreditsNote, { programId: meNote.id }));
  return out;
}

// -- program-level checks (PSC-style) + PWR + needs-data ------------------------
export function checkCompletion(plan, data, progress) {
  const ctx = buildContext(plan, data);
  const prog = progress || computeProgress(plan, data);
  const out = [];

  for (const r of prog.programs) {
    const p = ctx.programById.get(r.programId);
    if (r.needsData) {
      out.push(v('PROGRAM_NEEDS_DATA', 'warning',
        `Full requirements for ${p.name} (${p.degree}) are not yet loaded; progress cannot be checked. Source: ${p.sourceUrl}`,
        { programId: p.id }));
      continue;
    }
    const checks = p.programChecks;
    if (checks) {
      const used = [...r.usedCourseIds];
      if (checks.totalCourses && used.length < checks.totalCourses) {
        out.push(v('PROGRAM_TOTAL_COURSES', 'info',
          `${p.name}: ${used.length} of ${checks.totalCourses} required courses planned.`,
          { programId: p.id }));
      }
      if (checks.minFromDepts) {
        const n = used.filter((cid) => checks.minFromDepts.depts.includes(ctx.course(cid)?.dept)).length;
        if (used.length >= checks.totalCourses && n < checks.minFromDepts.n) {
          out.push(v('PROGRAM_MIN_DEPT', 'error',
            `${p.name}: only ${n} of the required ${checks.minFromDepts.n} courses carry ${checks.minFromDepts.depts.join('/')} designation.`,
            { programId: p.id }));
        }
      }
      if (checks.max100Level) {
        const low = used.filter((cid) => (ctx.course(cid)?.number ?? 999) < 200);
        if (low.length > checks.max100Level) {
          out.push(v('PROGRAM_MAX_100', 'error',
            `${p.name}: ${low.length} 100-level courses counted; at most ${checks.max100Level} allowed.`,
            { programId: p.id, courseIds: low }));
        }
      }
    }
  }

  if (!prog.pwr.satisfied) {
    if (prog.pwr.transferOnly) {
      out.push(v('PWR_TRANSFER', 'warning',
        'WRTG 105 appears only as AP/IB/transfer credit; confirm PWR satisfaction with the College.', {}));
    } else {
      out.push(v('PWR_REQUIRED', 'info',
        'Primary Writing Requirement not yet planned (WRTG 105 / 105E / 105A+105B).', {}));
    }
  }

  for (const r of prog.programs) {
    if (r.needsData) continue;
    const ulw = (r.groups || []).find((g) => g.isULW);
    if (ulw && !ulw.complete) {
      const p = ctx.programById.get(r.programId);
      out.push(v('ULW_REQUIRED', 'info',
        `${p.name}: upper-level writing ${ulw.have}/${ulw.need} planned.`, { programId: p.id }));
    }
  }

  // AP/IB general-credit-only programs: surface why AP/IB-bucket courses are
  // not counting toward them (the assignment already excludes them).
  for (const r of prog.programs) {
    if (r.needsData) continue;
    const p = ctx.programById.get(r.programId);
    if (!p.apIbCreditExcluded) continue;
    const apIb = plan.transfer.filter((t) => t.kind === 'ap' || t.kind === 'ib');
    if (apIb.length) {
      out.push(v('AP_IB_MAJOR_EXCLUDED', 'info',
        `${p.name} (${p.degree}): ${apIb.map((t) => t.courseId).join(', ')} (AP/IB) earns general credit only and is not counted toward this program's requirements.`,
        { programId: p.id }));
    }
  }

  // Home-institution share: UR courses must fulfill at least the program's
  // minimum share of requirements; groups flagged ancillary:true are exempt.
  for (const r of prog.programs) {
    if (r.needsData) continue;
    const p = ctx.programById.get(r.programId);
    const minPct = p.minPctFromHomeInstitution;
    if (!minPct) continue;
    const ancillaryIds = new Set((p.requirementGroups || [])
      .filter((g) => g.ancillary).map((g) => g.id));
    const counted = new Set();
    for (const g of r.groups || []) {
      if (g.isULW || ancillaryIds.has(g.id)) continue;
      for (const cid of g.satisfiedBy) counted.add(cid);
    }
    if (!counted.size) continue;
    const transferred = [...counted].filter((cid) => transferKind(plan, cid) === 'transfer');
    const urShare = 1 - transferred.length / counted.size;
    if (urShare < minPct / 100) {
      out.push(v('HOME_INSTITUTION_MIN', 'warning',
        `${p.name} (${p.degree}): ${transferred.length} of ${counted.size} non-ancillary requirement courses are transfer credit (${transferred.join(', ')}); at least ${minPct}% must be UR courses.`,
        { programId: p.id, courseIds: transferred }));
    }
  }
  return out;
}

// -- everything ----------------------------------------------------------------
export function checkAll(plan, data) {
  const progress = computeProgress(plan, data);
  return {
    progress,
    violations: [
      ...checkDuplicates(plan, data),
      ...checkEquivalencyConflicts(plan, data.equivalencyGroups || []),
      ...checkDepartmentSequencing(plan),
      ...checkPrerequisites(plan, data),
      ...checkOfferingSemester(plan, data),
      ...checkCreditLoad(plan, data, data.policy.creditLoad.max, data.policy.creditLoad.min),
      ...checkOverlap(plan, data, progress),
      ...checkClusterRules(plan, data, progress),
      ...checkDepartmentCap(plan, data),
      ...checkTotalCredits(plan, data),
      ...checkCompletion(plan, data, progress),
    ],
  };
}
