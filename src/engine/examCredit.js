// Exam → UR course credit from the CCAS Advanced Placement handbook.
// Only named catalog codes from that table are awarded. Placement-only,
// general-credit, consultation, and "credit after a later course" rows
// stay notes. Pure functions; no UI or storage imports.

export const SYSTEM_LABEL = { ap: 'AP', ib: 'IB', alevel: 'A-Level' };
export const KIND_LABEL = { ap: 'AP', ib: 'IB', transfer: 'Transfer' };

export const emptyExamTable = () => ({ exams: [], combos: [] });

export function examById(table, id) {
  return (table?.exams || []).find((e) => e.id === id) || null;
}

export function scoreInRange(score, minScore, maxScore) {
  if (minScore == null) return false;
  if (typeof minScore === 'string' || typeof score === 'string') {
    return String(score) === String(minScore)
      && (maxScore == null || String(score) === String(maxScore));
  }
  const n = Number(score);
  if (!Number.isFinite(n)) return false;
  if (n < minScore) return false;
  if (maxScore != null && n > maxScore) return false;
  return true;
}

export function awardForExamScore(exam, score) {
  if (!exam) return null;
  const hits = (exam.awards || []).filter((a) => scoreInRange(score, a.minScore, a.maxScore));
  if (!hits.length) return null;
  hits.sort((a, b) => (a.maxScore != null ? 0 : 1) - (b.maxScore != null ? 0 : 1));
  return hits[0];
}

export function formatScore(exam, score) {
  if (exam?.system === 'alevel') return `grade ${score}`;
  return String(score);
}

export function examDisplayName(exam, score) {
  if (!exam) return '';
  const sys = SYSTEM_LABEL[exam.system] || exam.system;
  const base = `${sys} ${exam.label}`;
  return score == null || score === '' ? base : `${base} (${formatScore(exam, score)})`;
}

export function upsertRecordedExam(recorded, entry) {
  const prev = (recorded || []).find((e) => e.examId === entry.examId);
  const next = { examId: entry.examId, score: entry.score };
  const choice = entry.choice || prev?.choice;
  if (choice) next.choice = choice;
  return [...(recorded || []).filter((e) => e.examId !== entry.examId), next];
}

function pushCourse(list, row) {
  const existing = list.find((c) => c.courseId === row.courseId);
  if (existing) {
    existing.examIds = [...new Set([...existing.examIds, ...row.examIds])];
    existing.conditional = existing.conditional || row.conditional;
    return;
  }
  list.push({ ...row, examIds: [...row.examIds] });
}

function comboSatisfied(combo, recorded) {
  return (combo.allOf || []).every((req) => {
    const rec = (recorded || []).find((r) => r.examId === req.examId);
    return rec && scoreInRange(rec.score, req.minScore, req.maxScore);
  });
}

export function resolveExamCredit(table, recorded) {
  const courses = [];
  for (const rec of recorded || []) {
    const exam = examById(table, rec.examId);
    if (!exam) continue;
    const award = awardForExamScore(exam, rec.score);
    if (!award) continue;
    if (award.chooseOne?.length) {
      if (!rec.choice || !award.chooseOne.includes(rec.choice)) continue;
      pushCourse(courses, {
        courseId: rec.choice,
        kind: exam.kind,
        examIds: [exam.id],
        conditional: !!award.conditional,
      });
      continue;
    }
    for (const cid of award.courses || []) {
      pushCourse(courses, {
        courseId: cid,
        kind: exam.kind,
        examIds: [exam.id],
        conditional: !!award.conditional,
      });
    }
  }
  for (const combo of table?.combos || []) {
    if (!comboSatisfied(combo, recorded)) continue;
    for (const cid of combo.courses || []) {
      pushCourse(courses, {
        courseId: cid,
        kind: combo.kind,
        examIds: (combo.allOf || []).map((r) => r.examId),
        conditional: false,
      });
    }
  }
  return { courses };
}

export function isExamSourced(row) {
  return Boolean(row?.examId || (row?.examIds && row.examIds.length));
}

export function applyRecordedExams(plan, table, recorded) {
  const { courses } = resolveExamCredit(table, recorded);
  const awardedIds = new Set(courses.map((c) => c.courseId));
  const manual = (plan.transfer || []).filter((t) => !isExamSourced(t) && !awardedIds.has(t.courseId));
  const fromExams = courses.map((c) => ({
    courseId: c.courseId,
    kind: c.kind,
    examIds: c.examIds,
    ...(c.examIds.length === 1 ? { examId: c.examIds[0] } : {}),
    ...(c.conditional ? { conditional: true } : {}),
  }));
  return {
    ...plan,
    transferExams: recorded,
    transfer: [...fromExams, ...manual],
  };
}

export function removeExamsFromPlan(plan, table, examIds) {
  const drop = new Set(examIds || []);
  const recorded = (plan.transferExams || []).filter((e) => !drop.has(e.examId));
  return applyRecordedExams(plan, table, recorded);
}

function pendingComboFor(table, recorded, examId) {
  for (const combo of table?.combos || []) {
    if (!(combo.allOf || []).some((r) => r.examId === examId)) continue;
    if (comboSatisfied(combo, recorded)) continue;
    const missing = (combo.allOf || [])
      .filter((req) => {
        const rec = (recorded || []).find((r) => r.examId === req.examId);
        return !rec || !scoreInRange(rec.score, req.minScore, req.maxScore);
      })
      .map((req) => examById(table, req.examId))
      .filter(Boolean);
    return { combo, missing };
  }
  return null;
}

export function previewExamAdd(table, recorded, examId, score, choice) {
  const exam = examById(table, examId);
  const award = awardForExamScore(exam, score);
  const needsChoice = Boolean(award?.chooseOne?.length) && !(choice && award.chooseOne.includes(choice));
  const next = upsertRecordedExam(recorded, { examId, score, choice });
  const before = new Set(resolveExamCredit(table, recorded).courses.map((c) => c.courseId));
  const after = resolveExamCredit(table, next);
  const newCourses = after.courses.filter((c) => !before.has(c.courseId));
  const pendingCombo = pendingComboFor(table, next, examId);
  const note = award?.note || exam?.note || '';
  return { exam, award, needsChoice, newCourses, pendingCombo, note };
}

export function transferCreditGroups(plan, table) {
  const recorded = plan.transferExams || [];
  const usedCourses = new Set();
  const usedExams = new Set();
  const groups = [];

  for (const combo of table?.combos || []) {
    if (!comboSatisfied(combo, recorded)) continue;
    const examIds = (combo.allOf || []).map((r) => r.examId);
    const courses = (plan.transfer || []).filter((t) =>
      (t.examIds || (t.examId ? [t.examId] : [])).some((id) => examIds.includes(id))
      && combo.courses.includes(t.courseId));
    const labels = examIds.map((id) => {
      const exam = examById(table, id);
      const rec = recorded.find((r) => r.examId === id);
      return examDisplayName(exam, rec?.score);
    });
    groups.push({
      key: combo.id,
      title: labels.join(' + '),
      courses,
      examIds,
      note: combo.note,
      kind: combo.kind,
    });
    courses.forEach((c) => usedCourses.add(c.courseId));
    examIds.forEach((id) => usedExams.add(id));
  }

  for (const rec of recorded) {
    if (usedExams.has(rec.examId)) continue;
    const exam = examById(table, rec.examId);
    const courses = (plan.transfer || []).filter((t) => {
      const ids = t.examIds || (t.examId ? [t.examId] : []);
      return ids.includes(rec.examId) && !usedCourses.has(t.courseId);
    });
    const pending = pendingComboFor(table, recorded, rec.examId);
    groups.push({
      key: rec.examId,
      title: examDisplayName(exam, rec.score),
      courses,
      examIds: [rec.examId],
      note: pending
        ? `${pending.combo.courses.join(', ')} also needs ${pending.missing.map((e) => examDisplayName(e)).join(' and ')}.`
        : exam?.note,
      kind: exam?.kind,
    });
    courses.forEach((c) => usedCourses.add(c.courseId));
  }

  for (const t of plan.transfer || []) {
    if (usedCourses.has(t.courseId)) continue;
    groups.push({
      key: t.courseId,
      title: t.courseId,
      courses: [t],
      examIds: [],
      kind: t.kind,
      manual: true,
    });
    usedCourses.add(t.courseId);
  }
  return groups;
}
