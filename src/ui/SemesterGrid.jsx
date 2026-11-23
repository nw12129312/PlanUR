import React, { useEffect, useState } from 'react';
import { Icon } from './icons.jsx';
import { CourseCard } from './CourseCard.jsx';
import { Button, SevChip, Select, TextInput, IconButton, Panel, SearchSelect, Tag } from './bits.jsx';
import { ruleInfo } from '../engine/rules.js';
import { ACADEMIC_YEAR_NAMES, availableSummerSlots, groupIntoYears } from '../engine/model.js';
import {
  KIND_LABEL, emptyExamTable, examById, previewExamAdd, transferCreditGroups,
} from '../engine/examCredit.js';

function MoveHereSlot({ empty, label, onDrop }) {
  const [over, setOver] = useState(false);
  return (
    <div
      role="group"
      aria-label={label}
      data-drag-only={empty ? undefined : ''}
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
      className={`flex min-h-10 items-center justify-center rounded-md px-2 py-1.5 text-center text-xs transition ${
        over
          ? 'bg-accent-soft font-semibold text-accent'
          : 'text-ink-3'
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
      className={`group/sem flex min-w-0 flex-col gap-1.5 rounded-lg p-2 transition-colors ${
        active ? 'bg-accent-soft' : 'bg-ground'
      }`}
    >
      <header className="flex items-baseline gap-2">
        <button
          type="button"
          onClick={onSetActive}
          title="Make this the target semester for the add button in course search"
          className={`-mx-1 rounded-md px-1 text-sm font-bold transition ${
            active ? 'text-accent' : 'text-ink hover:text-accent'
          }`}
        >
          {sem.label}
          {active && <span className="ml-1.5 align-middle text-xs font-medium text-accent">(adding here)</span>}
        </button>
        <span className="flex-1" />
        <span className={`tnum text-xs ${credits > 18 || (sem.term !== 'summer' && credits > 0 && credits < 12) ? 'text-warn' : 'text-ink-3'}`}>
          {credits} cr
        </span>
        {sem.courseIds.length === 0 && (
          <IconButton icon="close" label={`Remove ${sem.label}`} tone="danger"
            onClick={onRemoveSemester}
            className="reveal-on-hover group-hover/sem:opacity-100 group-focus-within/sem:opacity-100" />
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
              shortUses={plan.majorIds.length + plan.minorIds.length <= 1}
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
  return <span className="mb-0.5 block text-xs font-medium text-ink-2">{children}</span>;
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
    <section aria-label="AP / IB / transfer credit" className="pt-2">
      <details className="group/xfer">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <h3 className="label-caps">AP, IB and Transfer credit</h3>
        <span className="flex-1" aria-hidden="true" />
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink-2">
          <Icon name="plus" size="sm" /> Add credit
          <Icon name="chevronDown" size="sm" className="transition-transform group-open/xfer:rotate-180" />
        </span>
      </summary>
      <div className="pt-2">
      <p className="mb-2 text-xs text-ink-3">
        Counts toward prerequisites and credits, never clusters. Scores follow the{' '}
        <a className="underline decoration-ink-3/50 hover:decoration-ink" href="https://www.rochester.edu/college/ccas/handbook/ap.html" target="_blank" rel="noreferrer">
          College AP handbook
        </a>.
      </p>

      <div className="mb-2 inline-flex rounded-md bg-surface-2 p-0.5" role="tablist" aria-label="Credit entry mode">
        <button type="button" role="tab" aria-selected={mode === 'exam'}
          className={`rounded px-2.5 py-1 text-xs font-semibold ${mode === 'exam' ? 'bg-surface text-ink' : 'text-ink-3 hover:text-ink'}`}
          onClick={() => setMode('exam')}>From exam</button>
        <button type="button" role="tab" aria-selected={mode === 'code'}
          className={`rounded px-2.5 py-1 text-xs font-semibold ${mode === 'code' ? 'bg-surface text-ink' : 'text-ink-3 hover:text-ink'}`}
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
          {preview && <p className="text-xs text-ink-2">{addPreview()}</p>}
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
      </div>
      </details>

      <div className="mt-2 flex flex-col gap-1.5 empty:hidden">
        {groups.map((g) => {
          const cr = g.courses.reduce((a, t) => a + (data.courses[t.courseId]?.credits ?? 4), 0);
          const remove = () => {
            if (g.examIds?.length && onRemoveExamCredit) onRemoveExamCredit(g.examIds);
            else g.courses.forEach((t) => onRemoveTransfer(t.courseId));
          };
          return (
            <div key={g.key} className="flex items-start justify-between gap-2 rounded-md bg-ground px-2.5 py-1.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <span className="text-[13px] font-semibold text-ink">{g.manual ? <span className="code">{g.title}</span> : g.title}</span>
                  <span className="text-xs text-ink-3">{KIND_LABEL[g.kind] || g.kind}</span>
                  {g.courses.some((t) => t.conditional) && <Tag tone="warn">Conditional</Tag>}
                  {g.courses.length > 0 && <span className="tnum text-xs text-ink-2">{cr} cr</span>}
                </div>
                {g.courses.length > 0 && (
                  <div className="mt-0.5 text-xs text-ink-2">
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
                  <p className="mt-0.5 text-xs text-ink-3">{g.note}</p>
                )}
              </div>
              <IconButton icon="close" label={`Remove ${g.title}`} tone="danger" size="sm" onClick={remove} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

const YEAR_NAMES = ACADEMIC_YEAR_NAMES;

function AddSemesterControls({ onAddSemester, onAddSummer, summerSlots }) {
  return (
    <div className="inline-flex items-stretch">
      <Button kind="quiet" onClick={onAddSemester}>
        <Icon name="plus" size="sm" /> Add semester
      </Button>
      {summerSlots.length > 0 && onAddSummer && (
        <details className="relative">
          <summary
            className="inline-flex min-h-8 cursor-pointer list-none items-center rounded-md px-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 [&::-webkit-details-marker]:hidden [&::marker]:hidden"
            aria-label="Add a summer semester"
          >
            <Icon name="chevronDown" size="sm" />
          </summary>
          <div
            role="menu"
            aria-label="Summer semesters"
            className="absolute right-0 z-30 mt-1 min-w-[12.5rem] rounded-md border border-line bg-surface p-1 shadow-md"
          >
            <p className="px-2 py-1 text-xs font-medium text-ink-3">Add summer</p>
            {summerSlots.map((slot) => (
              <button
                key={slot.year}
                type="button"
                role="menuitem"
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-[13px] font-semibold text-ink hover:bg-surface-2"
                onClick={(e) => {
                  onAddSummer(slot.year);
                  const details = e.currentTarget.closest('details');
                  if (details) details.open = false;
                }}
              >
                <span>{`Summer ${slot.year}`}</span>
                <span className="text-xs font-medium text-ink-3">{slot.yearLabel}</span>
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export function SemesterGrid({ toolbar, data, plan, activeSemesterId, onSetActive, onDropOnCourse, onMoveToSemester, onRemoveCourse, onToggleLock, onAddSemester, onAddSummer, onRemoveSemester, violationsByCourse, violationsBySemester, courseUses, onAddTransfer, onAddExamCredit, onRemoveExamCredit, onRemoveTransfer, auditOpen, onToggleAudit }) {
  const years = groupIntoYears(plan.semesters);
  const summerSlots = availableSummerSlots(plan);

  // Extra drop zones in filled semesters are only useful mid-drag; a root
  // class lets CSS show them then and keep the grid quiet otherwise.
  useEffect(() => {
    const root = document.documentElement;
    const on = () => root.classList.add('is-dragging');
    const off = () => root.classList.remove('is-dragging');
    document.addEventListener('dragstart', on);
    document.addEventListener('dragend', off);
    document.addEventListener('drop', off);
    return () => {
      document.removeEventListener('dragstart', on);
      document.removeEventListener('dragend', off);
      document.removeEventListener('drop', off);
      off();
    };
  }, []);

  return (
    <Panel
      title="Schedule"
      bodyClassName="!p-0"
      headerRight={
        <div className="flex items-center gap-1">
          <AddSemesterControls
            onAddSemester={onAddSemester}
            onAddSummer={onAddSummer}
            summerSlots={summerSlots}
          />
          {onToggleAudit && (
            <Button kind="quiet" onClick={onToggleAudit} className="hidden lg:inline-flex"
              title={auditOpen ? 'Hide the degree audit panel' : 'Show the degree audit panel'}>
              {auditOpen ? <>Hide audit <Icon name="chevronRight" size="sm" /></> : <><Icon name="chevronLeft" size="sm" /> Show audit</>}
            </Button>
          )}
        </div>
      }
    >
      {toolbar && <div className="px-3 py-2">{toolbar}</div>}
      <div className="flex min-h-0 flex-col gap-5 p-3 pt-1">
      {years.map((yearSems, yi) => {
        const yearCredits = yearSems.reduce(
          (a, s) => a + s.courseIds.reduce((b, cid) => b + (data.courses[cid]?.credits ?? 4), 0), 0);
        return (
          <section key={yi} aria-label={YEAR_NAMES[yi] || `Year ${yi + 1}`}>
            <div className="mb-1.5 flex items-baseline gap-2 px-0.5">
              <h3 className="text-sm font-bold text-ink">
                {YEAR_NAMES[yi] || `Year ${yi + 1}`}
              </h3>
              <span className="tnum text-xs text-ink-3">{yearCredits} cr</span>
            </div>
            <div className={`grid grid-cols-1 gap-2 @min-[600px]:grid-cols-2${yearSems.length > 2 ? ' @min-[900px]:grid-cols-3' : ''}`}>
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
