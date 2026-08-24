import React, { useMemo, useState } from 'react';
import { Icon } from './icons.jsx';
import { Button, Select, SevChip, Tag } from './bits.jsx';
import { ruleInfo } from '../engine/rules.js';
import { SCHEDULE_STYLES, styleOf } from '../engine/scheduleStyle.js';

// Toolbar: scope + target load + generate + lock controls.
export function GenerateBar({ plan, data, onGenerate, onLockAll, busy, onScheduleStyle }) {
  const [scopeKey, setScopeKey] = useState('all');
  const [target, setTarget] = useState('16');
  const [accelerated, setAccelerated] = useState(false);
  const scheduleStyle = styleOf(plan);
  const styleMeta = SCHEDULE_STYLES.find((s) => s.id === scheduleStyle) || SCHEDULE_STYLES[0];

  const scopeOptions = useMemo(() => {
    const opts = [{ key: 'all', label: 'Everything unlocked' }];
    plan.semesters.forEach((s, i) => {
      if (i > 0) opts.push({ key: `from:${i}`, label: `From ${s.label} onward` });
    });
    for (const id of [...plan.majorIds, ...plan.minorIds]) {
      const p = data.programs.find((x) => x.id === id);
      if (p?.status === 'ACTIVE') opts.push({ key: `prog:${id}`, label: `Only ${p.name} ${p.degree}` });
    }
    return opts;
  }, [plan.semesters, plan.majorIds, plan.minorIds, data.programs]);

  const scopeFromKey = (k) => {
    if (k.startsWith('from:')) return { kind: 'fromSemester', index: Number(k.slice(5)) };
    if (k.startsWith('prog:')) return { kind: 'program', programId: k.slice(5) };
    return { kind: 'all' };
  };

  const canGenerate = plan.majorIds.length > 0 && !busy;

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 shadow-sm">
      <Button kind="primary" disabled={!canGenerate} className={canGenerate ? '' : 'opacity-40'}
        onClick={() => onGenerate(scopeFromKey(scopeKey), Number(target), accelerated ? 'accelerated' : 'auto')}>
        {busy ? 'Generating…' : <><Icon name="bolt" size="sm" /> Auto-generate</>}
      </Button>
      <Select value={scopeKey} onChange={(e) => setScopeKey(e.target.value)} aria-label="Regeneration scope"
        className="w-auto! min-w-48">
        {scopeOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </Select>
      <Select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Target credits per semester"
        className="w-auto! min-w-28">
        {[14, 15, 16, 17, 18].map((n) => <option key={n} value={n}>{n} cr / sem</option>)}
      </Select>
      <label className="flex min-w-0 items-center gap-1.5 text-xs text-ink-2">
        <span className="shrink-0 font-medium text-ink">Schedule style</span>
        <Select
          value={scheduleStyle}
          onChange={(e) => onScheduleStyle?.(e.target.value)}
          aria-label="Schedule style"
          title={styleMeta.blurb}
          className="w-auto! min-w-40"
        >
          {SCHEDULE_STYLES.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </Select>
      </label>
      <label className="flex items-center gap-1.5 text-xs text-ink-2"
        title="When alternative course sequences exist (e.g. honors calculus), prefer the accelerated path.">
        <input type="checkbox" checked={accelerated} onChange={(e) => setAccelerated(e.target.checked)} />
        Prefer accelerated paths
      </label>
      <span className="flex-1" />
      <Button kind="quiet" onClick={() => onLockAll(true)} title="Lock every placed course (regenerate touches nothing)">Lock all</Button>
      <Button kind="quiet" onClick={() => onLockAll(false)} title="Unlock every placed course (full clean regenerate)">Unlock all</Button>
      <p className="basis-full m-0 text-[11px] leading-snug text-ink-3">{styleMeta.blurb}</p>
    </div>
  );
}

// Blocking-but-overridable warning shown when Auto-generate is requested
// while the selected combination doesn't cover all three divisions.
// "Go back" is the primary/default action; proceeding requires a deliberate
// click on the secondary button.
export function CoverageModal({ coverage, onAdjust, onProceed }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Divisional coverage warning" onClick={onAdjust}>
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-ink">
          <Icon name="warning" size="md" className="text-warn" /> Check your divisional coverage
        </h2>
        <p className="text-sm leading-snug text-ink-2">{coverage.message}</p>
        <p className="mt-2 text-xs leading-snug text-ink-3">
          You can still generate a plan — this is advisory, and you can add a cluster or minor later.
        </p>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button kind="quiet" onClick={onProceed}>Proceed anyway</Button>
          <Button kind="primary" autoFocus onClick={onAdjust}>Go back and adjust selections</Button>
        </div>
      </div>
    </div>
  );
}

// Compute added / removed / moved between two plans.
export function diffPlans(base, next) {
  const at = (plan) => {
    const m = new Map();
    plan.semesters.forEach((s) => s.courseIds.forEach((c) => m.set(c, s)));
    return m;
  };
  const a = at(base), b = at(next);
  const ops = [];
  for (const [cid, sem] of b) {
    if (!a.has(cid)) {
      ops.push({ type: 'add', cid, to: sem.id, toLabel: sem.label,
                 reason: next.courseMeta?.[cid]?.reason || null });
    } else if (a.get(cid).id !== sem.id) {
      ops.push({ type: 'move', cid, from: a.get(cid).id, fromLabel: a.get(cid).label,
                 to: sem.id, toLabel: sem.label, reason: next.courseMeta?.[cid]?.reason || null });
    }
  }
  for (const [cid, sem] of a) {
    if (!b.has(cid)) ops.push({ type: 'remove', cid, from: sem.id, fromLabel: sem.label });
  }
  const order = { add: 0, move: 1, remove: 2 };
  return ops.sort((x, y) => order[x.type] - order[y.type] || x.cid.localeCompare(y.cid));
}

// Apply the selected subset of ops to the base plan.
export function applyOps(base, next, ops, selected) {
  let sems = base.semesters.map((s) => ({ ...s, courseIds: [...s.courseIds] }));
  const meta = { ...(base.courseMeta || {}) };
  const semById = (id) => sems.find((s) => s.id === id);
  for (const op of ops) {
    if (!selected.has(opKey(op))) continue;
    if (op.type === 'remove' || op.type === 'move') {
      for (const s of sems) s.courseIds = s.courseIds.filter((c) => c !== op.cid);
      if (op.type === 'remove') delete meta[op.cid];
    }
    if (op.type === 'add' || op.type === 'move') {
      const target = semById(op.to);
      if (target && !target.courseIds.includes(op.cid)) target.courseIds.push(op.cid);
      if (next.courseMeta?.[op.cid]) meta[op.cid] = next.courseMeta[op.cid];
    }
  }
  return { ...base, semesters: sems, courseMeta: meta, lastEdited: Date.now() };
}

export const opKey = (op) => `${op.type}:${op.cid}`;

const OP_STYLE = {
  add: { tone: 'good', sign: '+', verb: 'Add' },
  move: { tone: 'accent', sign: '⇄', verb: 'Move' },
  remove: { tone: 'bad', sign: '－', verb: 'Remove' },
};

export function DiffModal({ base, result, data, onApply, onClose }) {
  const ops = useMemo(() => diffPlans(base, result.plan), [base, result.plan]);
  const [selected, setSelected] = useState(() => new Set(ops.map(opKey)));
  const errors = result.violations.filter((v) => v.severity === 'error');

  const toggle = (k) => setSelected((old) => {
    const s = new Set(old);
    if (s.has(k)) s.delete(k); else s.add(k);
    return s;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Review generated changes" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-surface shadow-lg" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="text-base font-semibold text-ink">Review generated changes</h2>
          <span className="text-xs text-ink-3">{ops.length} change{ops.length === 1 ? '' : 's'} · attempt {result.attempts}</span>
          <span className="flex-1" />
          <Button kind="quiet" onClick={() => setSelected(new Set(ops.map(opKey)))}>All</Button>
          <Button kind="quiet" onClick={() => setSelected(new Set())}>None</Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {ops.length === 0 && (
            <p className="py-4 text-center text-sm text-ink-3">Nothing to change — the plan already satisfies everything in scope.</p>
          )}
          <ul className="space-y-1.5">
            {ops.map((op) => {
              const st = OP_STYLE[op.type];
              const c = data.courses[op.cid];
              return (
                <li key={opKey(op)} className="flex items-start gap-2 rounded-lg bg-surface-2 px-2.5 py-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.has(opKey(op))}
                    onChange={() => toggle(opKey(op))}
                    aria-label={`${st.verb} ${op.cid}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm">
                      <Tag tone={st.tone}>{st.sign} {st.verb}</Tag>
                      <span className="code rounded bg-surface-2 px-1 py-0.5">{op.cid}</span>
                      <span className="min-w-0 truncate text-ink-2">{c?.title}</span>
                      <span className="text-xs text-ink-3">
                        {op.type === 'add' && `→ ${op.toLabel}`}
                        {op.type === 'move' && `${op.fromLabel} → ${op.toLabel}`}
                        {op.type === 'remove' && `from ${op.fromLabel}`}
                      </span>
                    </div>
                    {op.reason && <div className="mt-0.5 text-[11px] leading-snug text-ink-3">{op.reason}</div>}
                  </div>
                </li>
              );
            })}
          </ul>

          {(result.infeasible.length > 0 || result.warnings.length > 0 || errors.length > 0) && (
            <div className="mt-3 space-y-1.5 border-t border-line pt-2">
              {result.infeasible.map((x, i) => (
                <div key={`inf${i}`} className="flex items-start gap-1.5">
                  <SevChip severity="warning" title="Auto-generate could not satisfy this within the current semesters.">infeasible</SevChip>
                  <span className="text-[11px] leading-snug text-ink-2">{x.message}</span>
                </div>
              ))}
              {result.warnings.map((w, i) => (
                <div key={`w${i}`} className="flex items-start gap-1.5">
                  <SevChip severity="info" title="Generation note">note</SevChip>
                  <span className="text-[11px] leading-snug text-ink-2">{w}</span>
                </div>
              ))}
              {errors.map((v, i) => (
                <div key={`e${i}`} className="flex items-start gap-1.5">
                  <SevChip severity="error" title={`${ruleInfo(v.ruleId).title}: ${ruleInfo(v.ruleId).text}`}>{ruleInfo(v.ruleId).title}</SevChip>
                  <span className="text-[11px] leading-snug text-ink-2">{v.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t border-line px-4 py-3">
          <span className="text-xs text-ink-3">{selected.size} of {ops.length} selected</span>
          <span className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={ops.length === 0} className={ops.length === 0 ? 'opacity-40' : ''}
            onClick={() => onApply(applyOps(base, result.plan, ops, selected))}>
            Apply selected
          </Button>
        </footer>
      </div>
    </div>
  );
}
