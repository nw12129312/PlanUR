import React, { useState } from 'react';
import { Icon } from './icons.jsx';
import { CourseCard } from './CourseCard.jsx';
import { Button, SevChip, Select, TextInput, IconButton, Panel, SearchSelect, Tag } from './bits.jsx';
import { ruleInfo } from '../engine/rules.js';
import {
  KIND_LABEL, emptyExamTable, examById, previewExamAdd, transferCreditGroups,
} from '../engine/examCredit.js';

function MoveHereSlot({ empty, label, onDrop }) {
  const [over, setOver] = useState(false);
  return (
    <div
      role="group"
      aria-label={label}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const cid = e.dataTransfer.getData('text/course');
        const origin = e.dataTransfer.getData('text/origin');
        if (cid) onDrop(cid, origin);
      }}
      className={`flex min-h-11 items-center justify-center rounded-md border border-dashed px-2 py-1.5 text-center text-[11px] transition ${
        over
          ? 'border-accent bg-accent-soft text-accent ring-2 ring-accent/30'
          : 'border-line text-ink-3'
      }`}
    >
      {over
        ? (empty ? 'Drop to add here' : 'Drop to move here (no swap)')
        : (empty ? 'Drop a course here' : 'Drop here to move without swapping')}
    </div>
  );
}

function SemesterCard({ sem, data, plan, onDropOnCourse, onMoveToSemester, onRemoveCourse, onToggleLock, violationsByCourse, semViolations, courseUses, active, onSetActive, onRemoveSemester }) {
  const credits = sem.courseIds.reduce((a, cid) => a + (data.courses[cid]?.credits ?? 4), 0);

  return (
    <section
      aria-label={sem.label}
      className={`group flex min-w-0 flex-col gap-1.5 rounded-lg border p-2 transition ${
        active
          ? 'border-accent bg-surface shadow-md'
          : 'border-line bg-surface shadow-sm hover:border-ink-3/30 hover:shadow-md'
      }`}
    >
      <header className="flex items-baseline gap-2">
        <button
          type="button"
          onClick={onSetActive}
          title="Make this the target semester for the add button in course search"
          className={`-mx-1 rounded-md px-1 text-[13px] font-semibold transition ${
            active ? 'text-accent' : 'text-ink hover:text-accent'
          }`}
        >
          {sem.label}
          {active && <span className="ml-1.5 align-middle text-[10px] font-medium uppercase tracking-wider text-accent">target</span>}
        </button>
        <span className="flex-1" />
        <span className={`tnum text-xs ${credits > 18 || (credits > 0 && credits < 12) ? 'text-warn' : 'text-ink-3'}`}>
          {credits} cr
        </span>
        {sem.courseIds.length === 0 && (
          <IconButton icon="close" label={`Remove ${sem.label}`} tone="danger"
            onClick={onRemoveSemester}
            className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100" />
        )}
      </header>
      {semViolations.map((v, i) => (
        <SevChip key={i} severity={v.severity} title={`${ruleInfo(v.ruleId).title}: ${ruleInfo(v.ruleId).text}`}>
          {v.message}
        </SevChip>
      ))}
      <div className="space-y-1">
        {sem.courseIds.map((cid) => {
          const c = data.courses[cid];
          if (!c) return null;
          return (
            <CourseCard
              key={cid}
              course={c}
              placed
              meta={(plan.courseMeta || {})[cid]}
              onToggleLock={() => onToggleLock(cid)}
              uses={courseUses.get(cid) || []}
              violations={(violationsByCourse.get(cid) || []).filter((v) => v.semesterId === sem.id || !v.semesterId)}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/course', cid);
                e.dataTransfer.setData('text/origin', sem.id);
              }}
              onDropOnCourse={onDropOnCourse}
              onRemove={() => onRemoveCourse(cid, sem.id)}
            />
          );
        })}
        <MoveHereSlot
          empty={sem.courseIds.length === 0}
          label={sem.courseIds.length === 0
            ? `Drop a course onto ${sem.label}`
            : `Drop a course onto ${sem.label} without swapping`}
          onDrop={(cid, origin) => onMoveToSemester(cid, sem.id, origin)}
        />
      </div>
    </section>
  );
}

function FieldLabel({ children }) {
  return <span className="mb-0.5 block text-[11px] font-medium text-ink-2">{children}</span>;
}

function TransferBucket({
  data, plan, onAddTransfer, onRemoveTransfer, onAddExamCredit, onRemoveExamCredit,
}) {
  const table = data.examCredit || emptyExamTable();
  const [mode, setMode] = useState('exam');
  const [examId, setExamId] = useState('');
  const [score, setScore] = useState('');
  const [choice, setChoice] = useState('');
  const [code, setCode] = useState('');
  const [kind, setKind] = useState('transfer');

  const exam = examById(table, examId);
  const scoreValue = exam?.system === 'alevel' ? score : (score === '' ? '' : Number(score));
  const preview = examId !== '' && score !== ''
    ? previewExamAdd(table, plan.transferExams || [], examId, scoreValue, choice)
    : null;
  const chooseOne = preview?.award?.chooseOne || [];

  const examOptions = (table.exams || []).map((e) => ({
    value: e.id,
    label: `${e.system === 'alevel' ? 'A-Level' : e.system.toUpperCase()} ${e.label}`,
    keywords: `${e.keywords || ''} ${(e.awards || []).flatMap((a) => a.courses || a.chooseOne || []).join(' ')}`,
    group: e.group,
  }));

  const pickExam = (id) => {
    setExamId(id);
    if (!id) { setScore(''); setChoice(''); return; }
    const next = examById(table, id);
    const first = next?.scores?.[0];
    setScore(first == null ? '' : String(first));
    const firstAward = next?.awards?.[0];
    setChoice(firstAward?.chooseOne?.[0] || '');
  };

  const pickScore = (raw) => {
    setScore(raw);
    const val = exam?.system === 'alevel' ? raw : Number(raw);
    const nextAward = exam ? previewExamAdd(table, plan.transferExams || [], exam.id, val, '').award : null;
    if (nextAward?.chooseOne?.length && !nextAward.chooseOne.includes(choice)) {
      setChoice(nextAward.chooseOne[0]);
    }
    if (!nextAward?.chooseOne?.length) setChoice('');
  };

  const norm = code.trim().toUpperCase();
  const codeValid = !!data.courses[norm];
  const examValid = Boolean(exam && score !== '' && preview && !preview.needsChoice);
  const groups = transferCreditGroups(plan, table);

  const addPreview = () => {
    const parts = (preview?.newCourses || []).map((c) => c.courseId);
    if (parts.length) {
      const extra = preview.newCourses.some((c) => c.conditional) ? ' (conditional)' : '';
      return `Adds ${parts.join(' + ')}${extra}`;
    }
    if (preview?.pendingCombo) {
      return `${preview.pendingCombo.combo.courses.join(', ')} also needs ${preview.pendingCombo.missing.map((e) => e.label).join(' and ')}.`;
    }
    if (preview?.needsChoice) return 'Choose which UR course to list.';
    return preview?.note || '';
  };

  return (
    <section aria-label="AP / IB / transfer credit" className="rounded-lg border border-line bg-surface p-2.5 shadow-sm">
      <header className="mb-2 flex flex-wrap items-baseline gap-x-2">
        <h3 className="display text-[15px] text-ink">AP · IB · Transfer credit</h3>
        <span className="text-[11px] text-ink-3">counts for prerequisites &amp; credits; never for clusters</span>
      </header>
      <p className="mb-2 text-[12px] text-ink-3">
        Pick the exam and score from the{' '}
        <a className="underline decoration-ink-3/50 hover:decoration-ink" href="https://www.rochester.edu/college/ccas/handbook/ap.html" target="_blank" rel="noreferrer">
          College AP handbook
        </a>
        . Planur lists the named UR course it satisfies. Course-code entry is for other transfer credit.
      </p>

      <div className="mb-2 inline-flex rounded-md border border-line p-0.5" role="tablist" aria-label="Credit entry mode">
        <button type="button" role="tab" aria-selected={mode === 'exam'}
          className={`rounded px-2.5 py-1 text-[12px] font-semibold ${mode === 'exam' ? 'bg-accent-soft text-ink' : 'text-ink-3 hover:text-ink'}`}
          onClick={() => setMode('exam')}>From exam</button>
        <button type="button" role="tab" aria-selected={mode === 'code'}
          className={`rounded px-2.5 py-1 text-[12px] font-semibold ${mode === 'code' ? 'bg-accent-soft text-ink' : 'text-ink-3 hover:text-ink'}`}
          onClick={() => setMode('code')}>Course code</button>
      </div>

      {mode === 'exam' ? (
        <div className="mb-2 space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="block min-w-0 flex-1">
              <FieldLabel>Exam</FieldLabel>
              <SearchSelect
                value={examId}
                onChange={pickExam}
                options={examOptions}
                placeholder="Search AP, IB, or A-Level exams…"
                allowClear={Boolean(examId)}
                aria-label="Exam"
              />
            </label>
            <label className="block w-full sm:w-28">
              <FieldLabel>Score</FieldLabel>
              <Select value={score} onChange={(e) => pickScore(e.target.value)} aria-label="Exam score" disabled={!exam}>
                <option value="">{exam ? 'Score' : '—'}</option>
                {(exam?.scores || []).map((s) => (
                  <option key={String(s)} value={String(s)}>{exam.system === 'alevel' ? `Grade ${s}` : s}</option>
                ))}
              </Select>
            </label>
            {chooseOne.length > 0 && (
              <label className="block w-full sm:w-36">
                <FieldLabel>UR course</FieldLabel>
                <Select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Equivalent UR course">
                  {chooseOne.map((cid) => <option key={cid} value={cid}>{cid}</option>)}
                </Select>
              </label>
            )}
            <Button kind="primary" disabled={!examValid || !onAddExamCredit}
              onClick={() => { onAddExamCredit(examId, scoreValue, choice || undefined); setExamId(''); setScore(''); setChoice(''); }}>
              Add
            </Button>
          </div>
          {preview && <p className="text-[12px] text-ink-2">{addPreview()}</p>}
        </div>
      ) : (
        <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="block min-w-0 flex-1">
            <FieldLabel>Course code</FieldLabel>
            <TextInput
              list="all-course-codes"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. MATH 161"
              aria-label="Course code for transfer credit"
            />
          </label>
          <label className="block w-full sm:w-32">
            <FieldLabel>Type</FieldLabel>
            <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Credit type">
              <option value="transfer">Transfer</option>
              <option value="ap">AP</option>
              <option value="ib">IB</option>
            </Select>
          </label>
          <Button kind="primary" disabled={!codeValid} onClick={() => { onAddTransfer(norm, kind); setCode(''); }}>
            Add
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {groups.map((g) => {
          const cr = g.courses.reduce((a, t) => a + (data.courses[t.courseId]?.credits ?? 4), 0);
          const remove = () => {
            if (g.examIds?.length && onRemoveExamCredit) onRemoveExamCredit(g.examIds);
            else g.courses.forEach((t) => onRemoveTransfer(t.courseId));
          };
          return (
            <div key={g.key} className="flex items-start justify-between gap-2 rounded-md bg-surface-2 px-2.5 py-1.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <span className="text-[13px] font-semibold text-ink">{g.manual ? <span className="code">{g.title}</span> : g.title}</span>
                  <span className="text-[11px] uppercase text-ink-3">{KIND_LABEL[g.kind] || g.kind}</span>
                  {g.courses.some((t) => t.conditional) && <Tag tone="warn">Conditional</Tag>}
                  {g.courses.length > 0 && <span className="tnum text-xs text-ink-2">{cr} cr</span>}
                </div>
                {g.courses.length > 0 && (
                  <div className="mt-0.5 text-[12px] text-ink-2">
                    {g.courses.map((t, i) => (
                      <span key={t.courseId}>
                        {i > 0 && ' · '}
                        <span className="code">{t.courseId}</span>
                        {data.courses[t.courseId] ? ` ${data.courses[t.courseId].title}` : ''}
                      </span>
                    ))}
                  </div>
                )}
                {g.courses.length === 0 && g.note && (
                  <p className="mt-0.5 text-[12px] text-ink-3">{g.note}</p>
                )}
              </div>
              <button type="button" onClick={remove} aria-label={`Remove ${g.title}`}
                className="mt-0.5 text-ink-3 hover:text-bad">{<Icon name="close" size="sm" />}</button>
            </div>
          );
        })}
        {groups.length === 0 && <span className="text-xs text-ink-3">None yet.</span>}
      </div>
    </section>
  );
}

const YEAR_NAMES = ['First year', 'Sophomore year', 'Junior year', 'Senior year', 'Fifth year', 'Sixth year'];

// Semesters arrive as a flat fall/spring list; group them into academic years
// so the plan reads the way a student thinks about it.
function groupIntoYears(semesters) {
  const years = [];
  for (const sem of semesters) {
    const last = years[years.length - 1];
    if (last && last.length < 2) last.push(sem);
    else years.push([sem]);
  }
  return years;
}

export function SemesterGrid({ data, plan, activeSemesterId, onSetActive, onDropOnCourse, onMoveToSemester, onRemoveCourse, onToggleLock, onAddSemester, onRemoveSemester, violationsByCourse, violationsBySemester, courseUses, onAddTransfer, onAddExamCredit, onRemoveExamCredit, onRemoveTransfer, auditOpen, onToggleAudit }) {
  const years = groupIntoYears(plan.semesters);
  return (
    <Panel
      title="Schedule"
      icon="calendar"
      bodyClassName="!p-0"
      headerRight={
        <div className="flex items-center gap-1">
          <Button kind="quiet" onClick={onAddSemester}><Icon name="plus" size="sm" /> Add semester</Button>
          {onToggleAudit && (
            <Button kind="quiet" onClick={onToggleAudit} className="hidden lg:inline-flex"
              title={auditOpen ? 'Hide the degree audit panel' : 'Show the degree audit panel'}>
              {auditOpen ? <>Hide audit <Icon name="chevronRight" size="sm" /></> : <><Icon name="chevronLeft" size="sm" /> Show audit</>}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex min-h-0 flex-col gap-2.5 p-2.5">
      {years.map((yearSems, yi) => {
        const yearCredits = yearSems.reduce(
          (a, s) => a + s.courseIds.reduce((b, cid) => b + (data.courses[cid]?.credits ?? 4), 0), 0);
        return (
          <section key={yi} aria-label={YEAR_NAMES[yi] || `Year ${yi + 1}`}>
            <div className="mb-1.5 flex items-baseline gap-2 px-0.5">
              <h3 className="text-[13px] font-semibold text-ink-2">
                {YEAR_NAMES[yi] || `Year ${yi + 1}`}
              </h3>
              <span className="h-px flex-1 bg-line" aria-hidden="true" />
              <span className="tnum text-[11px] text-ink-3">{yearCredits} cr</span>
            </div>
            <div className="grid grid-cols-1 gap-2 @min-[600px]:grid-cols-2">
              {yearSems.map((sem) => (
                <SemesterCard
                  key={sem.id}
                  sem={sem}
                  data={data}
                  plan={plan}
                  active={activeSemesterId === sem.id}
                  onSetActive={() => onSetActive(sem.id)}
                  onDropOnCourse={onDropOnCourse}
                  onMoveToSemester={onMoveToSemester}
                  onRemoveCourse={onRemoveCourse}
                  onToggleLock={onToggleLock}
                  onRemoveSemester={() => onRemoveSemester(sem.id)}
                  violationsByCourse={violationsByCourse}
                  semViolations={violationsBySemester.get(sem.id) || []}
                  courseUses={courseUses}
                />
              ))}
            </div>
          </section>
        );
      })}

      <TransferBucket
        data={data}
        plan={plan}
        onAddTransfer={onAddTransfer}
        onAddExamCredit={onAddExamCredit}
        onRemoveExamCredit={onRemoveExamCredit}
        onRemoveTransfer={onRemoveTransfer}
      />
      <datalist id="all-course-codes">
        {Object.keys(data.courses).map((id) => <option key={id} value={id} />)}
      </datalist>
      </div>
    </Panel>
  );
}
