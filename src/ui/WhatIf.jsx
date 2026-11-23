import React, { useMemo, useState } from 'react';
import { Icon } from './icons.jsx';
import { Button, SearchSelect } from './bits.jsx';
import { closestClusters, closestPrograms, whatIfProgress } from '../engine/whatIf.js';

const DIV_LABEL = {
  humanities: 'Humanities',
  'social-sciences': 'Social Sciences',
  'natural-sciences': 'Natural Sciences',
  engineering: 'Engineering',
};

function left(n) {
  if (n === 0) return 'all requirements met';
  return `about ${n} course${n === 1 ? '' : 's'} left`;
}

// "What if I switched to / added X?" Runs the audit on a copy of the plan, so
// nothing changes until the student presses a button.
export function WhatIfPanel({ data, plan, onApply }) {
  const [programId, setProgramId] = useState('');
  const [mode, setMode] = useState('replace');
  const taken = new Set([...(plan.majorIds || []), ...(plan.minorIds || [])]);

  const options = useMemo(() => data.programs
    .filter((p) => p.status === 'ACTIVE')
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'major' ? -1 : 1))
    .map((p) => ({
      value: p.id,
      label: `${p.name} (${p.type === 'minor' ? 'minor' : p.degree})`,
      keywords: `${p.name} ${p.degree} ${p.id} ${(p.departments || []).join(' ')}`,
      group: p.type === 'minor' ? 'Minors' : 'Majors',
    })), [data.programs]);

  const program = data.programs.find((p) => p.id === programId);
  const hasCurrent = program
    && (program.type === 'minor' ? plan.minorIds.length > 0 : plan.majorIds.length > 0);
  const effectiveMode = hasCurrent ? mode : 'add';
  const r = useMemo(
    () => (programId ? whatIfProgress(plan, data, programId, effectiveMode) : null),
    [plan, data, programId, effectiveMode],
  );
  const noun = program?.type === 'minor' ? 'minor' : 'major';

  return (
    <div>
      <h3 className="label-caps mb-2">What if</h3>
      <SearchSelect
        value={programId}
        onChange={(v) => setProgramId(v || '')}
        options={options}
        placeholder="Try another major or minor…"
        allowClear={Boolean(programId)}
        aria-label="Pick a major or minor to see your progress in it"
      />
      {program && hasCurrent && (
        <div className="mt-2 flex gap-1" role="radiogroup" aria-label="What-if mode">
          {[['replace', `Instead of my ${noun}`], ['add', `As another ${noun}`]].map(([m, label]) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={`rounded-md px-2 py-1 text-xs font-medium transition ${
                mode === m ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:text-ink'}`}>
              {label}
            </button>
          ))}
        </div>
      )}
      {r && !r.needsData && (
        <div className="mt-2 rounded-md bg-surface-2 p-2">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{program.name}</span>
            <span className="tnum text-xs font-semibold text-ink-2">{r.percent}%</span>
          </div>
          <p className="mt-0.5 text-xs text-ink-2">
            {r.groupsDone} of {r.groupsTotal} requirements done · {left(r.remaining)}
          </p>
          <ul className="mt-1.5 space-y-1">
            {r.result.groups.filter((g) => !g.isULW).map((g) => (
              <li key={g.id}>
                <div className="flex items-center gap-1.5 text-xs">
                  {g.complete
                    ? <Icon name="check" size="sm" className="text-good" />
                    : <span className="inline-block w-4" aria-hidden="true" />}
                  <span className={`min-w-0 flex-1 truncate ${g.complete ? 'text-ink-3' : 'text-ink'}`} title={g.label}>{g.label}</span>
                  <span className="tnum shrink-0 text-ink-3">{Math.min(g.have, g.need)}/{g.need}</span>
                </div>
                {g.satisfiedBy.length > 0 && (
                  <p className="ml-5.5 truncate text-[11px] text-ink-3" title={g.satisfiedBy.join(', ')}>
                    {g.satisfiedBy.join(', ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-snug text-ink-3">
            Your plan hasn't changed. Courses already counted for your other programs may not count here because of overlap limits.
          </p>
          {!taken.has(program.id) && onApply && (
            <div className="mt-2 flex justify-end">
              <Button kind="quiet" onClick={() => { onApply(program.id, effectiveMode); setProgramId(''); }}>
                {effectiveMode === 'replace' ? `Switch to this ${noun}` : `Add this ${noun}`}
              </Button>
            </div>
          )}
        </div>
      )}
      {r && r.needsData && (
        <p className="mt-2 text-xs text-ink-3">This program's requirements aren't loaded yet, so progress can't be checked.</p>
      )}
    </div>
  );
}

function SuggestionRow({ name, sub, remaining, percent, onAdd, addLabel }) {
  return (
    <li className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-ink" title={name}>{name}</div>
        <div className="truncate text-xs text-ink-3">{sub}</div>
      </div>
      <span className="tnum shrink-0 text-right text-xs">
        <span className="font-semibold text-ink">{remaining === 0 ? 'Done' : `${remaining} left`}</span>
        <span className="block text-ink-3">{percent}%</span>
      </span>
      {onAdd && (
        <button type="button" onClick={onAdd} aria-label={addLabel} title={addLabel}
          className="shrink-0 rounded p-1 text-accent hover:bg-accent-soft">
          <Icon name="plus" size="sm" />
        </button>
      )}
    </li>
  );
}

// Minors and clusters the plan is already closest to finishing.
export function ClosestPanel({ data, plan, clustersNeeded, onAddMinor, onAddCluster }) {
  const [tab, setTab] = useState(plan.clusterIds.length < clustersNeeded ? 'clusters' : 'minors');
  const minors = useMemo(() => (tab === 'minors' ? closestPrograms(plan, data, { type: 'minor' }) : []), [plan, data, tab]);
  const clusters = useMemo(() => (tab === 'clusters' ? closestClusters(plan, data) : []), [plan, data, tab]);
  const placed = plan.semesters.some((s) => s.courseIds.length > 0);

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="label-caps flex-1">Closest to finishing</h3>
        <div className="flex gap-1" role="tablist" aria-label="Suggestion type">
          {[['clusters', 'Clusters'], ['minors', 'Minors']].map(([t, label]) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`rounded-md px-2 py-0.5 text-xs font-medium transition ${
                tab === t ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:text-ink'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {!placed && <p className="text-xs text-ink-3">Add courses to see what you're close to.</p>}
      {placed && tab === 'minors' && (
        minors.length === 0
          ? <p className="text-xs text-ink-3">None of your courses count toward a minor yet.</p>
          : (
            <ul className="space-y-1.5">
              {minors.map((m) => (
                <SuggestionRow key={m.program.id} name={m.program.name}
                  sub={`${m.countedCourseIds.length} of your courses count`}
                  remaining={m.remaining} percent={m.percent}
                  onAdd={onAddMinor && (() => onAddMinor(m.program.id))}
                  addLabel={`Add the ${m.program.name} minor to your plan`} />
              ))}
            </ul>
          )
      )}
      {placed && tab === 'clusters' && (
        clusters.length === 0
          ? <p className="text-xs text-ink-3">None of your courses count toward an eligible cluster yet.</p>
          : (
            <ul className="space-y-1.5">
              {clusters.map((c) => (
                <SuggestionRow key={c.cluster.id} name={c.cluster.name}
                  sub={`${DIV_LABEL[c.cluster.division] || c.cluster.division} · ${c.countedCourseIds.length} of your courses count`}
                  remaining={c.remaining} percent={c.percent}
                  onAdd={onAddCluster && (() => onAddCluster(c.cluster.id))}
                  addLabel={`Add the ${c.cluster.name} cluster to your plan`} />
              ))}
            </ul>
          )
      )}
      {placed && (
        <p className="mt-2 text-[11px] leading-snug text-ink-3">
          Counts use the same overlap and cluster rules as your audit. Clusters your major makes ineligible, and minors in your major's department, are left out.
        </p>
      )}
    </div>
  );
}

