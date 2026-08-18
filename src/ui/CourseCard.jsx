import React from 'react';
import { SevChip, Tag, IconButton } from './bits.jsx';
import { ruleInfo } from '../engine/rules.js';
import { groupsForCourse } from '../engine/equivalency.js';
import { getEquivalencyGroups } from '../storage/dataStore.js';

const equivalencyGroupsData = getEquivalencyGroups();

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

function detailsTitle(c) {
  const parts = [`${c.id} — ${c.title}`];
  parts.push(`${c.credits} cr${c.creditsVerified ? '' : ' (assumed)'} · offered: ${offeredLabel(c)}`);
  if (c.prereqs?.length) {
    parts.push('Prereqs: ' + c.prereqs.map((g) => g.join(' or ')).join('; ') +
      (c.prereqsVerified ? '' : ' (unverified)'));
  }
  if (c.prereqNote) parts.push(`Note: ${c.prereqNote}`);
  if (c.description) parts.push(c.description);
  if (c.stub) parts.push('Stub entry: known only from the cluster listing; credits/terms not yet sourced.');
  return parts.join('\n');
}

// One course, either in search results (compact) or placed in a semester.
export function CourseCard({ course: c, placed, uses = [], violations = [], meta, onToggleLock, onRemove, onAdd, draggable, onDragStart }) {
  const title = detailsTitle(c) + (meta?.reason ? `\n\nAuto-placed: ${meta.reason}` : '');
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      title={title}
      style={{ transitionDuration: 'var(--dur)' }}
      className={`group rounded-md border border-line bg-surface px-2 py-1.5 text-sm transition-colors hover:border-accent ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
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
      {(uses.length > 0 || violations.length > 0 || c.stub || meta?.source === 'auto' || EQUIV_BADGES.has(c.id) || (placed && !c.offeredVerified)) && (
        <div className="chip-row mt-1.5 flex gap-1 overflow-x-auto">
          {EQUIV_BADGES.has(c.id) && (
            <Tag tone="neutral" icon="swap" title={EQUIV_BADGES.get(c.id).title}>
              {EQUIV_BADGES.get(c.id).name} — one path
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
