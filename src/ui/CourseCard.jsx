import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SevChip, Tag, IconButton } from './bits.jsx';
import { Icon } from './icons.jsx';
import { ruleInfo } from '../engine/rules.js';
import { groupsForCourse } from '../engine/equivalency.js';
import { getEquivalencyGroups, getMeta, getRmp } from '../storage/dataStore.js';
import { notRecentlyOfferedMessage, termLabel } from '../engine/offering.js';
import {
  rmpAriaSummary, rmpCompactLine, rmpDetailLines, rmpForInstructor, rmpLinkForInstructor,
} from '../engine/rmp.js';
import { coursiclePageUrl } from '../engine/coursicle.js';
import { COURSE_STATUSES, GRADE_OPTIONS, GRADE_POINTS, NON_GPA_MARKS, STATUS_LABEL } from '../engine/grades.js';

const equivalencyGroupsData = getEquivalencyGroups();
const rmpDirectory = getRmp();
const offeringWindow = getMeta().offeringWindow?.label;
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
  if (c.notRecentlyOffered) return 'not offered recently';
  if (!c.offeredVerified) return 'terms unverified';
  const names = { fall: 'Fall', spring: 'Spring', summer: 'Summer' };
  const seasons = c.offered.map((t) => names[t] || t).join(' · ') || '—';
  return c.lastOffered ? `${seasons} (last ${termLabel(c.lastOffered)})` : seasons;
}

// Flag for a course with no sections in the harvested CDCS window. Shown on
// catalog results and placed cards alike, so nobody plans around it unawares.
function NotOfferedTag({ course }) {
  return (
    <Tag tone="warn" icon="warning" title={notRecentlyOfferedMessage(course, offeringWindow)}>
      Not offered recently
    </Tag>
  );
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
  if (c.notRecentlyOffered) parts.push(notRecentlyOfferedMessage(c, offeringWindow));
  if (c.stub) parts.push('Stub entry: known only from the cluster listing; credits/terms not yet sourced.');
  return parts.join('\n');
}

// Link out to the course's Coursicle page for student reviews. Stops the
// mouse/click events so it never starts a drag or triggers the card.
function ReviewsLink({ courseId, href, iconOnly }) {
  const stop = (e) => e.stopPropagation();
  const label = `Read reviews of ${courseId} on Coursicle (opens in a new tab)`;
  if (iconOnly) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        draggable={false}
        aria-label={label}
        title={label}
        onMouseDown={stop}
        onClick={stop}
        style={{ transitionDuration: 'var(--dur)' }}
        className="hit-area inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <Icon name="external" size="md" />
      </a>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      draggable={false}
      aria-label={label}
      title={label}
      onMouseDown={stop}
      onClick={stop}
      className="chip-line gap-1 py-0.5 text-xs font-semibold text-ink-2 hover:text-ink hover:underline"
    >
      <Icon name="external" size="sm" />
      <span className="chip-text">Reviews</span>
    </a>
  );
}

// Show every instructor inline up to this many; past it, the first few
// (most-rated first) stay inline and the rest sit behind a "+N more" list.
const INLINE_INSTRUCTORS = 3;

function instructorTitle(name, rec, exact) {
  if (!exact) return `No RateMyProfessors match for ${name}. Opens a RateMyProfessors search (new tab).`;
  return `${name}\n${rmpDetailLines(rec).join('\n')}\nOpens RateMyProfessors (new tab).`;
}

// One instructor's name, linked to their RateMyProfessors page (or a search
// for the name when the directory has no single match), with the rating.
function InstructorLink({ name, icon = false, fill = false }) {
  const { rec, href, exact } = rmpLinkForInstructor(name, rmpDirectory);
  const line = exact ? rmpCompactLine(rec) : '';
  const stop = (e) => e.stopPropagation();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      draggable={false}
      onMouseDown={stop}
      onClick={stop}
      title={instructorTitle(name, rec, exact)}
      aria-label={`${exact ? rmpAriaSummary(name, rec) : `Search RateMyProfessors for ${name}`} (opens in a new tab)`}
      className={`chip-line gap-1 py-0.5 text-xs font-semibold text-ink-2 hover:text-ink hover:underline${fill ? ' w-full' : ''}`}
    >
      {icon && <Icon name="user" size="sm" />}
      <span className={fill ? 'chip-text flex-1' : 'chip-text'}>{name}</span>
      {line && <span className="tnum shrink-0 font-semibold text-ink-3">{line}</span>}
    </a>
  );
}

// Rank instructors with RateMyProfessors ratings first (most-rated first),
// keeping CDCS order otherwise.
function rankInstructors(names) {
  return names
    .map((name, i) => ({ name, i, n: rmpForInstructor(name, rmpDirectory)?.numRatings || 0 }))
    .sort((x, y) => y.n - x.n || x.i - y.i)
    .map((x) => x.name);
}

function InstructorLinks({ courseId, names }) {
  const ranked = rankInstructors(names);
  const overflow = ranked.length > INLINE_INSTRUCTORS;
  const inline = overflow ? ranked.slice(0, INLINE_INSTRUCTORS - 1) : ranked;
  return (
    <>
      {inline.map((name, i) => <InstructorLink key={name} name={name} icon={i === 0} />)}
      {overflow && <MoreInstructors courseId={courseId} names={ranked} hidden={ranked.length - inline.length} />}
    </>
  );
}

function MoreInstructors({ courseId, names, hidden }) {
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
    const width = 280;
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const openUp = spaceBelow < 160 && r.top > spaceBelow;
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

  const panel = open && pos && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={panelRef}
        id={listId}
        role="dialog"
        aria-label={`All ${names.length} instructors for ${courseId}`}
        tabIndex={-1}
        className="fixed z-[70] max-h-72 overflow-auto rounded-md border border-line bg-surface p-2 shadow-lg outline-none"
        style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom }}
      >
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {names.map((name) => (
            <li key={name} className="flex rounded px-1.5 py-0.5 hover:bg-surface-2">
              <InstructorLink name={name} fill />
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
        aria-label={`${hidden} more instructors for ${courseId}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={listId}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="chip-line min-h-6 cursor-pointer rounded py-0.5 text-xs font-semibold text-ink-3 hover:text-ink hover:underline"
      >
        <span className="chip-text">{`+${hidden} more`}</span>
      </button>
      {panel}
    </>
  );
}

// Majors, minors and clusters each get their own color on the card, so it's
// clear at a glance what a course is being taken for.
const USE_TONE = { major: 'major', minor: 'minor', cluster: 'gold' };

const STATUS_TONE = { planned: 'text-ink-3', in_progress: 'text-accent', completed: 'text-good' };

function gradeOptionLabel(g) {
  if (g in GRADE_POINTS) return g;
  return `${g} (${NON_GPA_MARKS[g].label})`;
}

// Status + grade, as two compact selects on the card's chip row. Picking a
// grade marks the course completed; the grade select only shows once the
// course is completed.
function StatusControl({ courseId, status, grade, onSetStatus, onSetGrade }) {
  const stop = (e) => e.stopPropagation();
  return (
    <span className="chip-line gap-1.5 py-0.5" onMouseDown={stop} onClick={stop}>
      <select
        aria-label={`Status of ${courseId}`}
        value={status}
        onChange={(e) => onSetStatus(e.target.value)}
        className={`status-select text-xs font-semibold ${STATUS_TONE[status]}`}
      >
        {COURSE_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
      </select>
      {status === 'completed' && (
        <select
          aria-label={`Grade in ${courseId}`}
          value={grade || ''}
          onChange={(e) => onSetGrade(e.target.value || null)}
          className={`status-select text-xs font-semibold ${grade ? 'text-ink' : 'text-ink-3'}`}
        >
          <option value="">Grade…</option>
          {GRADE_OPTIONS.map((g) => <option key={g} value={g}>{gradeOptionLabel(g)}</option>)}
        </select>
      )}
    </span>
  );
}

// One course, either in search results (compact) or placed in a semester.
export function CourseCard({ course: c, placed, uses = [], shortUses = false, violations: allViolations = [], meta, status = 'planned', grade = null, onSetStatus, onSetGrade, onToggleLock, onRemove, onAdd, draggable, onDragStart, onDropOnCourse }) {
  const [dropOver, setDropOver] = useState(false);
  // The "Not offered recently" tag already says this; don't repeat it as a rule chip.
  const violations = allViolations.filter((v) => v.ruleId !== 'OFFERING_INACTIVE');
  const instructors = namedInstructors(c);
  const title = detailsTitle(c)
    + (EQUIV_BADGES.has(c.id) ? `\n\n${EQUIV_BADGES.get(c.id).title}` : '')
    + (meta?.reason ? `\n\nAuto-placed: ${meta.reason}` : '');
  const swapTarget = placed && typeof onDropOnCourse === 'function';
  const crossListings = (c.crossListings || []).filter(Boolean);
  const hasStatus = placed && typeof onSetStatus === 'function';
  const reviewsHref = coursiclePageUrl(c.id);
  const showTopTags = placed && (uses.length > 0 || violations.length > 0 || c.stub
    || c.notRecentlyOffered || crossListings.length > 0);
  const showBottom = placed && (instructors.length > 0 || !!reviewsHref);
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
      data-status={placed ? status : undefined}
      className={`group/course course-card rounded-md px-2 py-1.5 text-sm transition-colors ${
        dropOver
          ? 'bg-accent-soft outline-2 outline-accent'
          : 'bg-surface hover:bg-surface-2'
      } ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <div className="flex items-center gap-2">
        <span className="code min-w-[4.75rem] shrink-0 whitespace-nowrap text-ink">{c.id}</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className={`min-w-0 text-[13px] leading-snug text-ink-2 ${placed ? 'max-w-full truncate' : 'line-clamp-2 flex-1'}`}>{c.title}</span>
          {/* What the course counts toward, and anything wrong with it, sits
              beside the title; the bottom row is kept for instructors and
              reviews. Tags stay on one scrollable line rather than wrapping. */}
          {showTopTags && (
            <div className="chip-row flex min-w-0 max-w-full gap-3 overflow-x-auto">
              {uses.slice(0, 2).map((u, i) => (
                <Tag key={i} tone={USE_TONE[u.kind] || 'major'}
                  icon={u.kind === 'cluster' ? 'hexagon' : undefined} title={u.label}>
                  {u.kind === 'cluster'
                    ? u.label.replace(/^Cluster:\s*/, '')
                    : (shortUses ? u.label.replace(/^[^:]+:\s*/, '') : u.label)}
                </Tag>
              ))}
              {uses.length > 2 && <Tag title={uses.map((u) => u.label).join(' · ')}>+{uses.length - 2}</Tag>}
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
              {c.notRecentlyOffered && <NotOfferedTag course={c} />}
              {c.stub && <Tag tone="warn" title="Known only from the cluster listing; credits and terms not yet sourced.">unsourced</Tag>}
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
          {/* Inside the wrapping block so on a narrow card it drops below the
              title instead of squeezing it. */}
          {hasStatus && (
            <span className="ml-auto flex shrink-0">
              <StatusControl courseId={c.id} status={status} grade={grade}
                onSetStatus={onSetStatus} onSetGrade={onSetGrade} />
            </span>
          )}
        </div>
        <span className="tnum shrink-0 text-xs text-ink-3">{c.credits} cr</span>
        {placed && onToggleLock && (
          <IconButton
            icon={meta?.locked ? 'lock' : 'unlock'}
            label={meta?.locked
              ? `${c.id} is locked — regenerate will not touch it. Unlock.`
              : `${c.id} is unlocked — regenerate may replace it. Lock.`}
            onClick={onToggleLock}
            aria-pressed={!!meta?.locked}
            className={meta?.locked ? 'text-accent' : 'reveal-on-hover group-hover/course:opacity-100 group-focus-within/course:opacity-100 text-ink-3'}
          />
        )}
        {dropOver && (
          <span className="shrink-0 text-xs font-semibold text-accent">Swap</span>
        )}
        {!placed && reviewsHref && <ReviewsLink courseId={c.id} href={reviewsHref} iconOnly />}
        {onAdd && <IconButton icon="plus" label={`Add ${c.id}`} tone="accent" onClick={onAdd} />}
        {onRemove && (
          <IconButton
            icon="close"
            label={`Remove ${c.id}`}
            tone="danger"
            onClick={onRemove}
            className="reveal-on-hover group-hover/course:opacity-100 group-focus-within/course:opacity-100"
          />
        )}
      </div>
      {!placed && c.notRecentlyOffered && (
        <div className="chip-row mt-0.5 flex gap-3"><NotOfferedTag course={c} /></div>
      )}
      {/* Bottom row: instructors (each linked to RateMyProfessors, with their
          rating) and the course's reviews. One scrollable line, no wrapping. */}
      {showBottom && (
        <div className="chip-row mt-0.5 flex gap-3 overflow-x-auto">
          <InstructorLinks courseId={c.id} names={instructors} />
          {reviewsHref && <ReviewsLink courseId={c.id} href={reviewsHref} />}
        </div>
      )}
    </div>
  );
}
