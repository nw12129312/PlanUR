import React, { useEffect, useMemo, useRef, useState } from 'react';

import { newPlan, addSemester, addSummerSemester, withCourseMeta, getCourseMeta } from './engine/model.js';
import { cumulativeGpa, earnsNoCredit, formatGpa, withCourseGrade, withCourseStatus } from './engine/grades.js';
import { withScheduleStyle } from './engine/scheduleStyle.js';
import { switchTrackChoice, withProgramSwap } from './engine/pathways.js';
import { checkAll, resolveRequiredCredits } from './engine/constraints.js';
import { autoGenerate } from './engine/autogen.js';
import { conflictForAdd } from './engine/equivalency.js';
import { applyRequirementOption, placeCourseWithPrereqs } from './engine/swapRequirement.js';
import { swapPlacedCourses, moveCourseToSemester, placementWarnings } from './engine/courseMove.js';
import { applyRecordedExams, previewExamAdd, removeExamsFromPlan, upsertRecordedExam } from './engine/examCredit.js';
import { divisionalCoverageForPlan } from './engine/coverage.js';
import { listingOnPlan } from './engine/crossList.js';
// dataStore is the ONLY module that touches browser storage (and the only
// place App reads bundled data from); see src/storage/dataStore.js.
// account.js layers optional sign-in sync on top of it.
import * as store from './storage/dataStore.js';
import * as account from './storage/account.js';
import { getCloud } from './storage/cloud/index.js';

import { SetupPanel } from './ui/SetupPanel.jsx';
import { CourseSearch } from './ui/CourseSearch.jsx';
import { SemesterGrid } from './ui/SemesterGrid.jsx';
import { Checklist } from './ui/Checklist.jsx';
import { PlansModal } from './ui/PlansModal.jsx';
import { AccountMenu, SaveStatus } from './ui/AccountMenu.jsx';
import { GenerateBar, DiffModal, CoverageModal } from './ui/AutoGen.jsx';
import { AdvisorPacket, exportAdvisorPdf } from './ui/AdvisorPacket.jsx';
import { Button, Panel } from './ui/bits.jsx';
import { Icon } from './ui/icons.jsx';

const DATA = {
  courses: store.getCourses(),
  programs: store.getPrograms(),
  clusters: store.getClusters(),
  policy: store.getPolicy(),
  equivalencyGroups: store.getEquivalencyGroups(),
  examCredit: store.getExamCredit(),
};
const LOCAL = store.LOCAL_USER;
// Account backend (Firebase), or null when sign-in isn't configured.
const CLOUD = getCloud();
const AUTOSAVE_MS = 700;

export default function App() {
  const [plan, setPlan] = useState(() => newPlan('My first plan'));
  const [savedJson, setSavedJson] = useState(null);
  const [planIndex, setPlanIndex] = useState([]);
  const [storageState, setStorageState] = useState(store.storageStatus());
  const [userId, setUserId] = useState(LOCAL);          // LOCAL, or the signed-in uid
  const [user, setUser] = useState(null);               // signed-in account details
  const [saveState, setSaveState] = useState('saved');  // 'saving' | 'saved' | 'error'
  const [syncState, setSyncState] = useState(null);     // null | 'syncing' | 'synced' | 'offline'
  const [authBusy, setAuthBusy] = useState(false);
  const [accountNotice, setAccountNotice] = useState(null);
  const [ready, setReady] = useState(false);            // first load finished
  const [modalOpen, setModalOpen] = useState(false);
  const [activeSemesterId, setActiveSemesterId] = useState(null);
  const [genResult, setGenResult] = useState(null); // {base, result} pending diff review
  const [genBusy, setGenBusy] = useState(false);
  const [blockNotice, setBlockNotice] = useState(null); // blocked-add explanation
  const [moveNotice, setMoveNotice] = useState(null);   // post-drop placement warnings
  const [setupOpen, setSetupOpen] = useState(true);      // setup band expanded?
  const [auditOpen, setAuditOpen] = useState(true);      // right rail visible?
  const blockTimer = useRef(null);
  const moveTimer = useRef(null);

  const showBlock = (message) => {
    setBlockNotice(message);
    clearTimeout(blockTimer.current);
    blockTimer.current = setTimeout(() => setBlockNotice(null), 8000);
  };

  const showMoveWarning = (message) => {
    setMoveNotice(message);
    clearTimeout(moveTimer.current);
    moveTimer.current = setTimeout(() => setMoveNotice(null), 10000);
  };

  const warnPlacement = (next, courseIds, semesterIds) => {
    const hits = placementWarnings(next, DATA, courseIds, semesterIds);
    if (!hits.length) { setMoveNotice(null); return; }
    showMoveWarning(hits.map((v) => v.message).join(' '));
  };

  // Blocks an add that would mix equivalency-group paths, with an explanation.
  const blockedByEquivalency = (cid) => {
    const conflict = conflictForAdd(planRef.current, cid, DATA.equivalencyGroups);
    if (conflict) { showBlock(conflict.message); return true; }
    return false;
  };
  const planRef = useRef(plan);
  planRef.current = plan;

  const dirty = savedJson !== JSON.stringify(plan);
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const savedJsonRef = useRef(savedJson);
  savedJsonRef.current = savedJson;
  const signingOut = useRef(false);
  const enteredUid = useRef(null);   // account the app has switched to
  const announceSignIn = useRef(false);

  useEffect(() => store.subscribeStorageStatus(setStorageState), []);

  const showPlan = (p) => { setPlan(p); setSavedJson(JSON.stringify(p)); setActiveSemesterId(null); };

  // Open the plan last open on this device for this user, else the most
  // recently edited one, else a fresh plan (not saved until it's edited).
  async function openLatest(uid) {
    const idx = await store.listPlans(uid);
    setPlanIndex(idx);
    const last = await store.getSetting(`last-open:${uid}`);
    const pick = idx.find((e) => e.id === last)
      || [...idx].sort((a, b) => (b.last_edited || 0) - (a.last_edited || 0))[0];
    const p = pick && await store.loadPlan(uid, pick.id);
    showPlan(p || newPlan('My first plan'));
  }

  // Load on mount: the remembered account's cached plans (so a signed-in
  // user sees their plan straight away), otherwise this browser's plans.
  useEffect(() => {
    (async () => {
      const remembered = CLOUD ? await store.getSetting('account') : null;
      if (remembered) { setUserId(remembered); setSyncState('syncing'); }
      await openLatest(remembered || LOCAL);
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (ready) store.setSetting(`last-open:${userId}`, plan.id);
  }, [ready, userId, plan.id]);

  // Save to this device (and the account when signed in).
  async function persist(p, uid) {
    const t = touch(p);
    setSaveState('saving');
    const res = await account.savePlan(CLOUD, uid, t);
    if (userIdRef.current !== uid) return res;
    setPlanIndex(res.index);
    // Only adopt the stamped copy if nothing changed while saving.
    setPlan((cur) => (cur === p ? t : cur));
    if (planRef.current === p) setSavedJson(JSON.stringify(t));
    setSaveState(res.ok ? 'saved' : 'error');
    if (res.synced != null) setSyncState(res.synced ? 'synced' : 'offline');
    return res;
  }

  // Save pending edits right away (before switching plans or accounts).
  async function flushSave() {
    if (savedJsonRef.current !== JSON.stringify(planRef.current)) {
      await persist(planRef.current, userIdRef.current);
    }
  }

  // Autosave shortly after each edit.
  useEffect(() => {
    if (!ready || !dirty) return undefined;
    const uid = userId;
    const t = setTimeout(() => persist(planRef.current, uid), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [plan, ready, userId, dirty]);

  // Last-chance save when the tab closes (local only; it has to be quick).
  useEffect(() => {
    const onHide = () => {
      if (savedJsonRef.current !== JSON.stringify(planRef.current)) {
        store.savePlan(userIdRef.current, touch(planRef.current));
      }
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  // ---- optional account (Google sign-in) ----
  async function enterAccount(u) {
    enteredUid.current = u.uid;
    const announce = announceSignIn.current;
    announceSignIn.current = false;
    setUser(u);
    setSyncState('syncing');
    await flushSave();
    const openId = planRef.current.id;
    try {
      const res = await account.mergeIntoAccount(CLOUD, u.uid);
      await store.setSetting('account', u.uid);
      setUserId(u.uid);
      userIdRef.current = u.uid;
      setPlanIndex(res.index);
      const p = res.index.some((e) => e.id === openId) && await store.loadPlan(u.uid, openId);
      if (p) showPlan(p); else await openLatest(u.uid);
      setSyncState(res.ok ? 'synced' : 'offline');
      if (announce) {
        setAccountNotice(res.added
          ? `Signed in as ${u.email || u.name}. ${res.added === 1 ? 'The plan' : `${res.added} plans`} from this browser ${res.added === 1 ? 'was' : 'were'} added to your account.`
          : `Signed in as ${u.email || u.name}. Your plans now sync across devices.`);
      }
    } catch {
      // Account unreachable: keep working from the device cache.
      await store.setSetting('account', u.uid);
      setUserId(u.uid);
      userIdRef.current = u.uid;
      await openLatest(u.uid);
      setSyncState('offline');
    }
  }

  async function leaveAccount() {
    enteredUid.current = null;
    await store.setSetting('account', null);
    setUser(null);
    setUserId(LOCAL);
    userIdRef.current = LOCAL;
    setSyncState(null);
    await openLatest(LOCAL);
  }

  // Follow the sign-in state (restored sessions, sign-ins, expiry).
  useEffect(() => {
    if (!CLOUD || !ready) return undefined;
    return CLOUD.onAuthChange((u) => {
      if (u) {
        if (enteredUid.current !== u.uid) enterAccount(u);
      } else if (userIdRef.current !== LOCAL && !signingOut.current) {
        leaveAccount();
      }
    });
  }, [ready]);

  // Pick up changes made on other devices.
  useEffect(() => {
    if (!CLOUD || userId === LOCAL) return undefined;
    return CLOUD.subscribe(userId, async (records) => {
      const { changed, index } = await account.applyRemote(userId, records);
      if (userIdRef.current !== userId) return;
      setPlanIndex(index);
      const openId = planRef.current.id;
      if (changed.includes(openId) && savedJsonRef.current === JSON.stringify(planRef.current)) {
        const p = await store.loadPlan(userId, openId);
        if (p) showPlan(p); else await openLatest(userId);
      }
    });
  }, [userId]);

  async function signInAction() {
    setAuthBusy(true);
    announceSignIn.current = true;
    try {
      await CLOUD.signIn(); // the auth listener above switches into the account
    } catch (e) {
      announceSignIn.current = false;
      const code = e?.code || '';
      if (!/popup-closed|cancelled-popup/.test(code)) {
        setAccountNotice(`Couldn't sign in${code ? ` (${code.replace('auth/', '')})` : ''}. Your plans are still saved in this browser.`);
      }
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOutAction() {
    setAuthBusy(true);
    signingOut.current = true;
    try {
      await flushSave();
      setSyncState('syncing');
      const { ok } = await account.forgetAccountOnDevice(CLOUD, userIdRef.current);
      await CLOUD.signOut();
      await leaveAccount();
      setAccountNotice(ok
        ? 'Signed out. Your plans are saved in your account; sign in on any device to see them.'
        : "Signed out. Some changes hadn't reached your account yet, so they were kept on this device and will sync next time you sign in.");
    } finally {
      signingOut.current = false;
      setAuthBusy(false);
    }
  }

  const { progress, violations } = useMemo(() => checkAll(plan, DATA), [plan]);

  const violationsByCourse = useMemo(() => {
    const m = new Map();
    for (const x of violations) {
      if (x.courseId) {
        if (!m.has(x.courseId)) m.set(x.courseId, []);
        m.get(x.courseId).push(x);
      }
    }
    return m;
  }, [violations]);

  const violationsBySemester = useMemo(() => {
    const m = new Map();
    for (const x of violations) {
      if (x.semesterId && !x.courseId) {
        if (!m.has(x.semesterId)) m.set(x.semesterId, []);
        m.get(x.semesterId).push(x);
      }
    }
    return m;
  }, [violations]);

  const placedSet = useMemo(() => new Set([
    ...plan.semesters.flatMap((s) => s.courseIds),
    ...plan.transfer.map((t) => t.courseId),
  ]), [plan]);

  const selectedPrograms = [...plan.majorIds, ...plan.minorIds]
    .map((id) => DATA.programs.find((p) => p.id === id)).filter(Boolean);
  const selectedClusters = plan.clusterIds
    .map((id) => DATA.clusters.find((c) => c.id === id)).filter(Boolean);

  // Headline progress, lifted out of the audit rail so it survives collapsing it.
  const requiredCredits = useMemo(() => resolveRequiredCredits(plan, DATA), [plan]);
  const plannedCredits = useMemo(
    () => [...placedSet].filter((cid) => !earnsNoCredit(plan, cid))
      .reduce((a, cid) => a + (DATA.courses[cid]?.credits ?? 4), 0),
    [placedSet, plan],
  );
  const overallGpa = useMemo(() => cumulativeGpa(plan, DATA), [plan]);
  const errorCount = violations.filter((v) => v.severity === 'error').length;

  const clustersNeeded = useMemo(() => {
    const majors = plan.majorIds.map((id) => DATA.programs.find((p) => p.id === id)).filter(Boolean);
    const base = majors.length ? Math.max(...majors.map((m) => m.clustersRequired ?? 2)) : 2;
    const substitutions = plan.minorIds.length + Math.max(0, plan.majorIds.length - 1);
    return Math.max(0, base - substitutions);
  }, [plan.majorIds, plan.minorIds]);

  // ---- plan mutations ----
  const touch = (p) => ({ ...p, lastEdited: Date.now() });

  const addCourse = (cid, semId) => {
    if (blockedByEquivalency(cid)) return;
    const p = planRef.current;
    const already = listingOnPlan(p, cid, DATA.courses);
    if (already) {
      if (already !== cid) showBlock(`${cid} is already on the plan as ${already} (cross-listed).`);
      return;
    }
    const target = semId || activeSemesterId || p.semesters.find((s) => s.courseIds.length < 5)?.id || p.semesters[0]?.id;
    const result = placeCourseWithPrereqs(p, DATA, cid, { preferSemesterId: target });
    if (result.error) { showBlock(result.error); return; }
    setPlan(touch(result.plan));
  };

  const pickRequirementOption = ({ programId, groupId, courseId }) => {
    const result = applyRequirementOption(planRef.current, DATA, { programId, groupId, courseId });
    if (result.error) { showBlock(result.error); return; }
    if (result.kind !== 'swap') {
      addCourse(courseId);
      return;
    }
    setPlan(touch(result.plan));
  };

  const chooseTrack = ({ programId, groupId, trackName }) => {
    setPlan((p) => touch(switchTrackChoice(p, DATA, programId, groupId, trackName || null)));
  };

  const swapProgram = ({ fromId, toId }) => {
    setPlan((p) => touch(withProgramSwap(p, fromId, toId, DATA)));
  };

  const removeCourse = (cid, semId) => {
    setPlan((p) => touch(withCourseMeta({
      ...p,
      semesters: p.semesters.map((s) => (s.id === semId ? { ...s, courseIds: s.courseIds.filter((x) => x !== cid) } : s)),
    }, cid, null)));
  };

  const dropOnCourse = (cid, targetCid, origin) => {
    if (cid === targetCid) return;
    const p = planRef.current;
    const placed = p.semesters.some((s) => s.courseIds.includes(cid));
    if (origin === 'search' && !placed) {
      if (blockedByEquivalency(cid)) return;
      if (p.transfer.some((t) => t.courseId === cid)) return;
      const targetSem = p.semesters.find((s) => s.courseIds.includes(targetCid));
      if (!targetSem) return;
      const next = moveCourseToSemester(p, cid, targetSem.id);
      setPlan(touch(next));
      warnPlacement(next, [cid], [targetSem.id]);
      return;
    }
    const next = swapPlacedCourses(p, cid, targetCid);
    const destA = next.semesters.find((s) => s.courseIds.includes(cid))?.id;
    const destB = next.semesters.find((s) => s.courseIds.includes(targetCid))?.id;
    setPlan(touch(next));
    warnPlacement(next, [cid, targetCid], [destA, destB]);
  };

  const moveToSemester = (cid, semId, origin) => {
    const p = planRef.current;
    const placed = p.semesters.some((s) => s.courseIds.includes(cid));
    if (origin === 'search' && !placed && blockedByEquivalency(cid)) return;
    if (origin === 'search' && p.transfer.some((t) => t.courseId === cid)) return;
    const next = moveCourseToSemester(p, cid, semId);
    setPlan(touch(next));
    warnPlacement(next, [cid], [semId]);
  };

  const toggleLock = (cid) => {
    setPlan((p) => touch(withCourseMeta(p, cid, { locked: !getCourseMeta(p, cid).locked })));
  };

  const setCourseStatus = (cid, status) => {
    setPlan((p) => touch(withCourseStatus(p, cid, status)));
  };

  const setCourseGrade = (cid, grade) => {
    setPlan((p) => touch(withCourseGrade(p, cid, grade)));
  };

  const setSemesterStatus = (semId, status) => {
    setPlan((p) => {
      const sem = p.semesters.find((s) => s.id === semId);
      if (!sem) return p;
      let next = p;
      for (const cid of sem.courseIds) {
        // Don't wipe a grade already entered on a completed course.
        if (status === 'completed' && next.courseMeta?.[cid]?.status === 'completed') continue;
        next = withCourseStatus(next, cid, status);
      }
      return touch(next);
    });
  };

  // What-if "switch" replaces the current majors (or minors); "add" appends.
  const applyWhatIf = (programId, mode) => {
    const program = DATA.programs.find((p) => p.id === programId);
    if (!program) return;
    const key = program.type === 'minor' ? 'minorIds' : 'majorIds';
    setPlan((p) => {
      const list = (p[key] || []).filter((id) => id !== programId);
      const next = mode === 'replace' ? [programId, ...list.slice(1)] : [...list, programId];
      return touch({ ...p, [key]: next });
    });
  };

  const addMinor = (programId) => {
    setPlan((p) => (p.minorIds.includes(programId) ? p : touch({ ...p, minorIds: [...p.minorIds, programId] })));
  };

  const addCluster = (clusterId) => {
    setPlan((p) => (p.clusterIds.includes(clusterId) ? p : touch({ ...p, clusterIds: [...p.clusterIds, clusterId] })));
  };

  const lockAll = (locked) => {
    setPlan((p) => {
      let next = p;
      for (const s of p.semesters) for (const cid of s.courseIds) next = withCourseMeta(next, cid, { locked });
      return touch(next);
    });
  };

  // ---- divisional coverage (selection-level, advisory) ----
  const coverage = useMemo(() => divisionalCoverageForPlan(plan, DATA),
    [plan.majorIds, plan.minorIds, plan.clusterIds]);
  // session-scoped "proceed anyway" acknowledgments, keyed by the exact
  // selection combination; changing any selection creates a new key and
  // re-arms the modal. Deliberately NOT persisted to storage.
  const coverageAcks = useRef(new Set());
  const [coveragePrompt, setCoveragePrompt] = useState(null); // pending generate args

  // ---- auto-generate ----
  function reallyGenerate(scope, targetLoad, pathPreference) {
    setGenBusy(true);
    // let the busy state paint before the (fast, but synchronous) solve
    setTimeout(() => {
      try {
        const base = planRef.current;
        const result = autoGenerate(base, DATA, {
          scope, targetLoad, pathPreference,
          scheduleStyle: base.preferences?.scheduleStyle,
        });
        setGenResult({ base, result });
      } finally {
        setGenBusy(false);
      }
    }, 20);
  }

  function runGenerate(scope, targetLoad, pathPreference = 'auto') {
    // advisory gate: warn (once per combination) when the selected programs
    // don't collectively cover all three divisions
    if (coverage.applicable && !coverage.satisfied && !coverageAcks.current.has(coverage.comboKey)) {
      setCoveragePrompt({ scope, targetLoad, pathPreference });
      return;
    }
    reallyGenerate(scope, targetLoad, pathPreference);
  }

  const autoFillGroup = (programId, groupId) =>
    runGenerate({ kind: 'group', programId, groupId }, 18);

  const applyGenerated = (nextPlan) => {
    setPlan(touch(nextPlan));
    setGenResult(null);
  };

  const addTransfer = (cid, kind) => {
    if (blockedByEquivalency(cid)) return;
    setPlan((p) => {
      if (listingOnPlan(p, cid, DATA.courses)) return p;
      return touch({ ...p, transfer: [...p.transfer, { courseId: cid, kind }] });
    });
  };
  const addExamCredit = (examId, score, choice) => {
    const p = planRef.current;
    const recorded = p.transferExams || [];
    const preview = previewExamAdd(DATA.examCredit, recorded, examId, score, choice);
    if (preview.needsChoice) {
      showBlock('Choose which UR course this exam should list.');
      return;
    }
    for (const c of preview.newCourses) {
      if (p.semesters.some((s) => s.courseIds.includes(c.courseId))) {
        showBlock(`${c.courseId} is already on your schedule. Remove it from a semester first to list it as exam credit.`);
        return;
      }
      if (blockedByEquivalency(c.courseId)) return;
    }
    setPlan((cur) => touch(applyRecordedExams(cur, DATA.examCredit, upsertRecordedExam(cur.transferExams || [], { examId, score, choice }))));
  };
  const removeExamCredit = (examIds) => setPlan((p) => touch(removeExamsFromPlan(p, DATA.examCredit, examIds)));
  const removeTransfer = (cid) => setPlan((p) => {
    const row = (p.transfer || []).find((t) => t.courseId === cid);
    const examIds = row?.examIds || (row?.examId ? [row.examId] : []);
    if (examIds.length) return touch(removeExamsFromPlan(p, DATA.examCredit, examIds));
    return touch({ ...p, transfer: p.transfer.filter((t) => t.courseId !== cid) });
  });

  const onAddSemester = () => setPlan((p) => touch(addSemester(p)));
  const onAddSummer = (year) => setPlan((p) => touch(addSummerSemester(p, year)));
  const onRemoveSemester = (semId) => setPlan((p) => {
    const s = p.semesters.find((x) => x.id === semId);
    if (!s || s.courseIds.length) return p;
    return touch({ ...p, semesters: p.semesters.filter((x) => x.id !== semId) });
  });

  // ---- plan list actions (all saving goes through dataStore/account) ----
  async function loadPlanAction(id) {
    await flushSave();
    const p = await store.loadPlan(userId, id);
    if (p) { showPlan(p); setModalOpen(false); }
  }

  async function newPlanAction() {
    await flushSave();
    showPlan(newPlan(`Plan ${planIndex.length + 1}`));
    setModalOpen(false);
  }

  async function renamePlanAction(id, name) {
    if (id === plan.id) { setPlan((x) => ({ ...x, name })); return; } // autosaves
    const p = await store.loadPlan(userId, id);
    if (!p) return;
    const { index } = await account.savePlan(CLOUD, userId, touch({ ...p, name }));
    setPlanIndex(index);
  }

  async function duplicatePlanAction(id) {
    const src = id === plan.id ? planRef.current : await store.loadPlan(userId, id);
    if (!src) return;
    const copy = { ...src, id: newPlan().id, name: `${src.name} (copy)`, lastEdited: Date.now() };
    const { index } = await account.savePlan(CLOUD, userId, copy);
    setPlanIndex(index);
  }

  async function deletePlanAction(id) {
    if (!window.confirm('Delete this plan permanently?')) return;
    const { index } = await account.deletePlan(CLOUD, userId, id);
    setPlanIndex(index);
    if (id === plan.id) {
      const next = [...index].sort((a, b) => (b.last_edited || 0) - (a.last_edited || 0))[0];
      const p = next && await store.loadPlan(userId, next.id);
      showPlan(p || newPlan('My first plan'));
    }
  }

  const storageBroken = storageState.available === false;

  const setupSummary = [
    ...selectedPrograms.map((p) => `${p.name}${p.type === 'minor' ? ' minor' : ` (${p.degree})`}`),
    plan.clusterIds.length ? `${plan.clusterIds.length} of ${clustersNeeded} clusters` : null,
  ].filter(Boolean);

  return (
    <>
    <div className="no-print flex flex-col bg-ground">
      <header className="site-header">
        <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 lg:px-4">
          <div className="flex shrink-0 items-center">
            <h1 className="wordmark" aria-label="PlanUR — UR Schedule Builder">
              Plan<span className="wordmark-u">U</span><span className="wordmark-r">R</span>
            </h1>
          </div>

          <input
            value={plan.name}
            onChange={(e) => setPlan((p) => ({ ...p, name: e.target.value }))}
            aria-label="Plan name"
            className="input-flat min-h-9 min-w-[10rem] flex-1 rounded-md border border-transparent bg-transparent px-2 text-[15px] font-semibold text-ink transition hover:border-line focus:border-accent focus:bg-surface sm:max-w-sm"
          />

          <div className="ml-auto flex shrink-0 items-center gap-3">
            <div className="flex items-center gap-2" title={`${plannedCredits} of ${requiredCredits} credit hours planned`}>
              <span className="tnum text-[13px] font-semibold text-ink">
                {plannedCredits}<span className="font-normal text-ink-3"> / {requiredCredits} cr</span>
                {overallGpa.gpa != null && (
                  <span className="ml-2" title={`Cumulative GPA over ${overallGpa.credits} letter-graded credit hours (student-entered, unofficial)`}>
                    <span className="font-normal text-ink-3">GPA </span>{formatGpa(overallGpa.gpa)}
                  </span>
                )}
                {errorCount > 0 && (
                  <span className="block text-xs font-semibold text-bad">{errorCount} {errorCount === 1 ? 'error' : 'errors'}</span>
                )}
              </span>
            </div>

            <div className="flex items-center gap-1">
              <SaveStatus status={dirty && saveState === 'saved' ? 'saving' : saveState} sync={syncState} backend={store.storageBackendKind()} />
              <Button kind="quiet" onClick={() => exportAdvisorPdf(plan.name)}
                title="Opens the print dialog — choose Save as PDF to email your adviser">
                Export PDF
              </Button>
              <Button kind="quiet" onClick={() => setModalOpen(true)}>My plans</Button>
              {CLOUD && <AccountMenu user={user} busy={authBusy} onSignIn={signInAction} onSignOut={signOutAction} />}
            </div>
          </div>
        </div>
      </header>

      {storageBroken && (
        <div className="banner banner-warn" role="status">
          This browser isn't allowing saves ({storageState.lastError}). Your changes last until you close this tab{CLOUD && userId === LOCAL ? ', or sign in to save them to an account' : ''}.
        </div>
      )}

      {accountNotice && (
        <div className="banner banner-info" role="status">
          {accountNotice}
          <button type="button" className="ml-2 underline hover:no-underline" onClick={() => setAccountNotice(null)}>Dismiss</button>
        </div>
      )}

      {blockNotice && (
        <div className="banner banner-bad" role="alert">
          <span className="font-semibold">Not added: </span>{blockNotice}
          <button type="button" className="ml-2 underline hover:no-underline" onClick={() => setBlockNotice(null)}>Dismiss</button>
        </div>
      )}
      {moveNotice && (
        <div className="banner banner-warn" role="status">
          <span className="font-semibold">Placement warning: </span>{moveNotice}
          <button type="button" className="ml-2 underline hover:no-underline" onClick={() => setMoveNotice(null)}>Dismiss</button>
        </div>
      )}

      <div className="mx-auto w-full max-w-[1600px] px-3 pt-3 lg:px-4">
        {setupOpen ? (
          <Panel
            title="Programs & clusters"
            className="mb-3"
            headerRight={plan.majorIds.length > 0 && (
              <Button kind="quiet" onClick={() => setSetupOpen(false)}>Done <Icon name="chevronUp" size="sm" /></Button>
            )}
            bodyClassName="!p-0"
          >
            <div className="p-3">
              <SetupPanel data={DATA} plan={plan} clustersNeeded={clustersNeeded} coverage={coverage}
                onChange={(p) => setPlan(touch(p))} />
            </div>
          </Panel>
        ) : (
          <button
            type="button"
            onClick={() => setSetupOpen(true)}
            className="mb-3 flex min-h-10 w-full items-center gap-2.5 rounded-lg bg-surface px-3 py-2 text-left transition hover:bg-surface-2"
          >
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">
              {setupSummary.length
                ? setupSummary.map((s, i) => (
                    <span key={i}>
                      {i > 0 && <span className="text-ink-3"> · </span>}
                      <span className="font-medium text-ink">{s}</span>
                    </span>
                  ))
                : 'No programs yet. Set up your degree'}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-ink-2">Edit <Icon name="chevronDown" size="sm" /></span>
          </button>
        )}
      </div>

      <main className={`mx-auto grid w-full max-w-[1600px] items-start grid-cols-1 gap-3 px-3 pb-4 lg:px-4 ${
        auditOpen
          ? 'lg:grid-cols-[minmax(0,1fr)_minmax(260px,300px)] xl:grid-cols-[minmax(0,1fr)_minmax(280px,320px)]'
          : ''
      }`}>
          {/* Schedule first, catalog under it: pick programs, auto-generate,
              then browse the catalog to adjust. */}
          <div className="@container flex min-w-0 flex-col gap-3">
            <SemesterGrid
              toolbar={(
                <GenerateBar plan={plan} data={DATA} onGenerate={runGenerate} onLockAll={lockAll}
                  onScheduleStyle={(id) => setPlan((p) => touch(withScheduleStyle(p, id)))}
                  busy={genBusy} />
              )}
              data={DATA}
              plan={plan}
              activeSemesterId={activeSemesterId}
              onSetActive={(id) => setActiveSemesterId((x) => (x === id ? null : id))}
              onDropOnCourse={dropOnCourse}
              onMoveToSemester={moveToSemester}
              onRemoveCourse={removeCourse}
              onToggleLock={toggleLock}
              onSetStatus={setCourseStatus}
              onSetGrade={setCourseGrade}
              onSetSemesterStatus={setSemesterStatus}
              onAddSemester={onAddSemester}
              onAddSummer={onAddSummer}
              onRemoveSemester={onRemoveSemester}
              violationsByCourse={violationsByCourse}
              violationsBySemester={violationsBySemester}
              courseUses={progress.courseUses}
              onAddTransfer={addTransfer}
              onAddExamCredit={addExamCredit}
              onRemoveExamCredit={removeExamCredit}
              onRemoveTransfer={removeTransfer}
              auditOpen={auditOpen}
              onToggleAudit={() => setAuditOpen((x) => !x)}
            />
            <CourseSearch
              data={DATA}
              plan={plan}
              selectedPrograms={selectedPrograms}
              selectedClusters={selectedClusters}
              placedSet={placedSet}
              onAdd={(cid) => addCourse(cid)}
              targetLabel={plan.semesters.find((s) => s.id === activeSemesterId)?.label || 'first open semester'}
            />
          </div>

          {auditOpen && (
            <aside className="w-full overflow-hidden">
              <Checklist data={DATA} plan={plan} progress={progress} violations={violations} clustersNeeded={clustersNeeded}
                onAutoFill={autoFillGroup}
                placedSet={placedSet}
                onPickOption={pickRequirementOption} onChooseTrack={chooseTrack} onSwapProgram={swapProgram}
                onWhatIfApply={applyWhatIf} onAddMinor={addMinor} onAddCluster={addCluster} />
            </aside>
          )}
      </main>

      <footer className="site-footer">
        <div className="mx-auto w-full max-w-[1600px] px-3 py-3 text-xs text-ink-3 lg:px-4">
          <span>Not an official degree audit. Confirm your plan with your adviser.</span>
        </div>
      </footer>

      {coveragePrompt && (
        <CoverageModal
          coverage={coverage}
          onAdjust={() => setCoveragePrompt(null)}
          onProceed={() => {
            coverageAcks.current.add(coverage.comboKey);
            const { scope, targetLoad, pathPreference } = coveragePrompt;
            setCoveragePrompt(null);
            reallyGenerate(scope, targetLoad, pathPreference);
          }}
        />
      )}

      {genResult && (
        <DiffModal
          base={genResult.base}
          result={genResult.result}
          data={DATA}
          onApply={applyGenerated}
          onClose={() => setGenResult(null)}
        />
      )}

      {modalOpen && (
        <PlansModal
          index={[...planIndex].sort((a, b) => (b.last_edited || 0) - (a.last_edited || 0))}
          currentId={plan.id}
          onLoad={loadPlanAction}
          onRename={renamePlanAction}
          onDuplicate={duplicatePlanAction}
          onDelete={deletePlanAction}
          onNew={newPlanAction}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
    <AdvisorPacket
      data={DATA}
      plan={plan}
      progress={progress}
      violations={violations}
      clustersNeeded={clustersNeeded}
      requiredCredits={requiredCredits}
      plannedCredits={plannedCredits}
    />
    </>
  );
}
