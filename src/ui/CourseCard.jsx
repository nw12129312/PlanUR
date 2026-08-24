import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SevChip, Tag, IconButton } from './bits.jsx';
import { Icon } from './icons.jsx';
import { ruleInfo } from '../engine/rules.js';
import { groupsForCourse } from '../engine/equivalency.js';
import { getEquivalencyGroups } from '../storage/dataStore.js';

const equivalencyGroupsData = getEquivalencyGroups();
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// courseId -> {name, pathNames, title} for equivalency badge (built once).
const EQUIV_BADGES = (() => {
  const m = new Map();
  const codes = new Set(
    equivalencyGroupsData.flatMap((g) => g.paths.flatMap((p) => p.courses)),
  );
  for (const cid of codes) {
    const hits = groupsForCourse(equivalencyGroupsData, cid);
    if (!hits.length) continue;
    const { group, paths } = hits[0];
    m.set(cid, {
      name: group.name,
      title: `Part of: ${group.name} — choose one path.\nThis course is on the ` +
        `${paths.map((p) => p.name).join(' / ')} path.\nAll paths: ` +
        group.paths.map((p) => p.name).join(' · '),
    });
  }
  return m;
})();

function offeredLabel(c) {
  if (!c.offeredVerified) return 'terms unverified';
  return c.offered.map((t) => (t === 'fall' ? 'Fall' : 'Spring')).join(' · ') || '—';
}

export function namedInstructors(c) {
  return (c?.instructors || []).map((n) => String(n).trim()).filter(Boolean);
}

function detailsTitle(c) {
  const parts = [`${c.id} — ${c.title}`];
  parts.push(`${c.credits} cr${c.creditsVerified ? '' : ' (assumed)'} · offered: ${offeredLabel(c)}`);
  const instructors = namedInstructors(c);
  if (instructors.length) parts.push('Instructors: ' + instructors.join('; '));
  if (c.crossListings?.length) {
    parts.push('Cross-listed as ' + c.crossListings.join(', ') +
      (c.crossListingSource ? ` (${c.crossListingSource})` : ''));
  }
  if (c.prereqs?.length) {
    parts.push('Prereqs: ' + c.prereqs.map((g) => g.join(' or ')).join('; ') +
      (c.prereqsVerified ? '' : ' (unverified)'));
  }
  if (c.prereqNote) parts.push(`Note: ${c.prereqNote}`);
  if (c.description) parts.push(c.description);
  if (c.stub) parts.push('Stub entry: known only from the cluster listing; credits/terms not yet sourced.');
  return parts.join('\n');
}

function InstructorChip({ courseId, names }) {
  const uid = useId();
  const listId = `${uid}-instructors`;
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);

  const updatePos = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 4;
    const width = Math.max(r.width, 176);
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const openUp = spaceBelow < 120 && r.top > spaceBelow;
    let left = Math.round(r.left);
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - width - 8);
    }
    setPos({
      left,
      width,
      top: openUp ? undefined : Math.round(r.bottom + gap),
      bottom: openUp ? Math.round(window.innerHeight - r.top + gap) : undefined,
    });
  };

  useIsoLayoutEffect(() => {
    if (!open) return;
    updatePos();
    panelRef.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        btnRef.current?.focus({ preventScroll: true });
      }
    };
    const onReposition = () => updatePos();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open]);

  if (!names.length) return null;
  if (names.length === 1) {
    return (
      <Tag tone="neutral" icon="user" title={names[0]}>
        {names[0]}
      </Tag>
    );
  }

  const panel = open && pos && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={panelRef}
        id={listId}
        role="dialog"
        aria-label={`Instructors for ${courseId}`}
        tabIndex={-1}
        className="fixed z-[70] max-h-60 overflow-auto rounded-md border border-line bg-surface p-2 shadow-lg outline-none"
        style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom }}
      >
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {names.map((name) => (
            <li key={name} className="flex items-center gap-1.5 rounded px-1.5 py-1 text-[12px] font-medium text-ink">
              <Icon name="user" size="sm" />
              <span>{name}</span>
            </li>
          ))}
        </ul>
      </div>,
      document.body,
    )
    : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={listId}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="chip-line min-h-6 cursor-pointer gap-1 rounded-full bg-surface-2 px-2.5 py-0.5 text-[11px] font-medium text-ink-2 hover:bg-line active:brightness-95"
      >
        <Icon name="user" size="sm" />
        <span className="chip-text">Multiple Instructors</span>
      </button>
      {panel}
    </>
  );
}

// One course, either in search results (compact) or placed in a semester.
export function CourseCard({ course: c, placed, uses = [], violations = [], meta, onToggleLock, onRemove, onAdd, draggable, onDragStart, onDropOnCourse }) {
  const [dropOver, setDropOver] = useState(false);
  const instructors = namedInstructors(c);
  const crossListings = (c.crossListings || []).filter(Boolean);
  const title = detailsTitle(c) + (meta?.reason ? `\n\nAuto-placed: ${meta.reason}` : '');
  const swapTarget = placed && typeof onDropOnCourse === 'function';
  const showChips = uses.length > 0 || violations.length > 0 || c.stub || meta?.source === 'auto'
    || EQUIV_BADGES.has(c.id) || (placed && !c.offeredVerified) || instructors.length > 0
    || crossListings.length > 0;
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={swapTarget ? (e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; setDropOver(true); } : undefined}
      onDragLeave={swapTarget ? () => setDropOver(false) : undefined}
      onDrop={swapTarget ? (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDropOver(false);
        const cid = e.dataTransfer.getData('text/course');
        const origin = e.dataTransfer.getData('text/origin');
        if (cid && cid !== c.id) onDropOnCourse(cid, c.id, origin);
      } : undefined}
      title={title}
      style={{ transitionDuration: 'var(--dur)' }}
      className={`group rounded-md border bg-surface px-2 py-1.5 text-sm transition-colors ${
        dropOver
          ? 'border-accent bg-accent-soft ring-2 ring-accent/30'
          : 'border-line hover:border-accent'
      } ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <div className="flex items-center gap-2">
        <span className="code shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-ink">{c.id}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{c.title}</span>
        <span className="tnum shrink-0 text-xs font-semibold text-ink-3">{c.credits}cr</span>
        {placed && onToggleLock && (
          <IconButton
            icon={meta?.locked ? 'lock' : 'unlock'}
            label={meta?.locked
              ? `${c.id} is locked — regenerate will not touch it. Unlock.`
              : `${c.id} is unlocked — regenerate may replace it. Lock.`}
            onClick={onToggleLock}
            aria-pressed={!!meta?.locked}
            className={meta?.locked ? 'text-accent' : 'text-ink-3 opacity-45 group-hover:opacity-100'}
          />
        )}
        {dropOver && (
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-accent">Swap</span>
        )}
        {onAdd && <IconButton icon="plus" label={`Add ${c.id}`} tone="accent" onClick={onAdd} />}
        {onRemove && (
          <IconButton
            icon="close"
            label={`Remove ${c.id}`}
            tone="danger"
            onClick={onRemove}
            className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          />
        )}
      </div>
      {/* Chips sit on one scrollable row rather than wrapping: the skill flags a
          compact label wrapping to a second line as a High-severity defect. Each
          truncates via CSS and carries its full text for assistive tech, so
          nothing is hover-only. */}
      {showChips && (
        <div className="chip-row mt-1.5 flex gap-1 overflow-x-auto">
          {EQUIV_BADGES.has(c.id) && (
            <Tag tone="neutral" icon="swap" title={EQUIV_BADGES.get(c.id).title}>
              {EQUIV_BADGES.get(c.id).name} — one path
            </Tag>
          )}
          <InstructorChip courseId={c.id} names={instructors} />
          {crossListings.length > 0 && (
            <Tag
              tone="neutral"
              icon="link"
              title={`Same class as ${crossListings.join(', ')}${c.crossListingSource ? ` — ${c.crossListingSource}` : ''}`}
            >
              {crossListings.length <= 3
                ? `Cross-listed ${crossListings.join(' · ')}`
                : `Cross-listed (${crossListings.length})`}
            </Tag>
          )}
          {meta?.source === 'auto' && (
            <Tag tone="cta" icon="bolt" title={meta.reason || 'Placed by auto-generate'}>
              {meta.reason || 'auto'}
            </Tag>
          )}
          {uses.slice(0, 2).map((u, i) => (
            <Tag key={i} tone={u.kind === 'cluster' ? 'gold' : 'accent'}
              icon={u.kind === 'cluster' ? 'hexagon' : undefined} title={u.label}>
              {u.label}
            </Tag>
          ))}
          {uses.length > 2 && <Tag title={uses.map((u) => u.label).join(' · ')}>+{uses.length - 2} more</Tag>}
          {c.stub && placed && <Tag tone="warn" title="Known only from the cluster listing; credits and terms not yet sourced.">unsourced</Tag>}
          {/* One chip per distinct rule. Department-ordering fires once per
              course pair, so an unfiltered map stacked four identical amber
              chips on a single card. */}
          {[...new Map(violations.map((v) => [v.ruleId, v])).values()].map((v, i) => {
            const dupes = violations.filter((x) => x.ruleId === v.ruleId);
            return (
              <SevChip key={i} severity={v.severity}
                title={`${ruleInfo(v.ruleId).title}: ${ruleInfo(v.ruleId).text}\n\n${dupes.map((d) => d.message).join('\n')}`}>
                {ruleInfo(v.ruleId).title}{dupes.length > 1 ? ` ×${dupes.length}` : ''}
              </SevChip>
            );
          })}
        </div>
      )}
    </div>
  );
}
