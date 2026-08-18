import React, { useState } from 'react';
import { Icon } from './icons.jsx';
import { CourseCard } from './CourseCard.jsx';
import { Button, SevChip, Select, TextInput, IconButton, Panel } from './bits.jsx';
import { ruleInfo } from '../engine/rules.js';

function SemesterCard({ sem, data, plan, onDropCourse, onRemoveCourse, onToggleLock, violationsByCourse, semViolations, courseUses, active, onSetActive, onRemoveSemester }) {
  const [over, setOver] = useState(false);
  const credits = sem.courseIds.reduce((a, cid) => a + (data.courses[cid]?.credits ?? 4), 0);

  return (
    <section
      aria-label={sem.label}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setOver(false);
        const cid = e.dataTransfer.getData('text/course');
        const origin = e.dataTransfer.getData('text/origin');
        if (cid) onDropCourse(cid, sem.id, origin);
      }}
      className={`group flex min-w-0 flex-col gap-1.5 rounded-lg border p-2 transition ${
        over
          ? 'border-accent bg-accent-soft ring-2 ring-accent/30'
          : active
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
                e.dataTransfer.setData('text/course', cid);
                e.dataTransfer.setData('text/origin', sem.id);
              }}
              onRemove={() => onRemoveCourse(cid, sem.id)}
            />
          );
        })}
        {sem.courseIds.length === 0 && (
          <div className="rounded-md border border-dashed border-line px-2 py-1.5 text-center text-[11px] text-ink-3">
            Drop a course here
          </div>
        )}
      </div>
    </section>
  );
}

function TransferBucket({ data, plan, onAddTransfer, onRemoveTransfer, violationsByCourse, courseUses }) {
  const [code, setCode] = useState('');
  const [kind, setKind] = useState('ap');
  const norm = code.trim().toUpperCase();
  const valid = !!data.courses[norm];
  return (
    <section aria-label="AP / IB / transfer credit" className="rounded-lg border border-line bg-surface p-2.5 shadow-sm">
      <header className="mb-2 flex flex-wrap items-baseline gap-x-2">
        <h3 className="display text-[15px] text-ink">AP · IB · Transfer credit</h3>
        <span className="text-[11px] text-ink-3">counts for prerequisites &amp; credits; never for clusters</span>
      </header>
      <div className="mb-2 flex gap-2">
        <TextInput
          list="all-course-codes"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Course code, e.g. MATH 161"
          aria-label="Course code for transfer credit"
          className="flex-1"
        />
        <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Credit type" className="w-auto! min-w-32">
          <option value="ap">AP</option>
          <option value="ib">IB</option>
          <option value="transfer">Transfer</option>
        </Select>
        <Button kind="primary" disabled={!valid} onClick={() => { onAddTransfer(norm, kind); setCode(''); }}
          className={valid ? '' : 'opacity-40'}>Add</Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {plan.transfer.map((t) => {
          const c = data.courses[t.courseId];
          return (
            <span key={t.courseId} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-sm">
              <span className="code">{t.courseId}</span>
              <span className="text-[11px] uppercase text-ink-3">{t.kind}</span>
              {c && <span className="tnum text-xs text-ink-2">{c.credits}cr</span>}
              <button type="button" onClick={() => onRemoveTransfer(t.courseId)} aria-label={`Remove ${t.courseId}`}
                className="text-ink-3 hover:text-bad">{<Icon name="close" size="sm" />}</button>
            </span>
          );
        })}
        {plan.transfer.length === 0 && <span className="text-xs text-ink-3">None yet.</span>}
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

export function SemesterGrid({ data, plan, activeSemesterId, onSetActive, onDropCourse, onRemoveCourse, onToggleLock, onAddSemester, onRemoveSemester, violationsByCourse, violationsBySemester, courseUses, onAddTransfer, onRemoveTransfer, auditOpen, onToggleAudit }) {
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
                  onDropCourse={onDropCourse}
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
        onRemoveTransfer={onRemoveTransfer}
        violationsByCourse={violationsByCourse}
        courseUses={courseUses}
      />
      <datalist id="all-course-codes">
        {Object.keys(data.courses).map((id) => <option key={id} value={id} />)}
      </datalist>
      </div>
    </Panel>
  );
}
