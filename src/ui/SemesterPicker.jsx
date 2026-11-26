import React, { useEffect, useRef } from 'react';
import { Button } from './bits.jsx';
import { groupIntoYears } from '../engine/model.js';
import { notRecentlyOfferedMessage } from '../engine/offering.js';
import { getMeta } from '../storage/dataStore.js';

const offeringWindow = getMeta().offeringWindow?.label;

// Opened by the catalog's add button: choose which semester gets the course.
// Semesters the engine rules out (missing prerequisites, not offered that
// term) stay visible but disabled, with the reason underneath.
export function SemesterPicker({ course, plan, blocked, options, activeSemesterId, onPick, onAuto, onClose }) {
  const dialogRef = useRef(null);
  const returnFocus = useRef(typeof document !== 'undefined' ? document.activeElement : null);

  useEffect(() => {
    const first = dialogRef.current?.querySelector('button[data-semester]:not([disabled])')
      || dialogRef.current?.querySelector('button');
    first?.focus();
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    const back = returnFocus.current;
    return () => {
      document.removeEventListener('keydown', esc);
      if (back && typeof back.focus === 'function' && document.contains(back)) back.focus();
    };
  }, [onClose]);

  const byId = new Map(options.map((o) => [o.semesterId, o]));
  const years = groupIntoYears(plan.semesters);
  const anyAllowed = options.some((o) => o.allowed);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog" aria-modal="true" aria-labelledby="semester-picker-title" onClick={onClose}>
      <div ref={dialogRef}
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-lg bg-surface shadow-lg"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-4 pb-2">
          <h2 id="semester-picker-title" className="text-lg font-semibold text-ink">Add {course.id}</h2>
          <p className="text-[13px] text-ink-2">{course.title} · {course.credits} cr</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
          {blocked ? (
            <p role="alert" className="mx-2 rounded-md bg-bad-soft px-3 py-2 text-[13px] text-bad">{blocked}</p>
          ) : (
            <>
              {course.notRecentlyOffered && (
                <p role="note" className="mx-2 mb-2 rounded-md bg-warn-soft px-3 py-2 text-[13px] text-ink-2">
                  <span className="font-semibold text-warn">Not offered recently. </span>
                  {notRecentlyOfferedMessage(course, offeringWindow)}
                </p>
              )}
              <p className="px-2 pb-2 text-xs text-ink-3">Choose a semester.</p>
              {!anyAllowed && (
                <p className="mx-2 mb-2 rounded-md bg-warn-soft px-3 py-2 text-[13px] text-ink-2">
                  No semester can take {course.id} yet. Use “Pick for me” to add its prerequisites first.
                </p>
              )}
              <div className="space-y-2">
                {years.map((group) => (
                  <div key={group[0]?.id} className="rounded-lg bg-ground p-1">
                    {group.map((sem) => {
                      const o = byId.get(sem.id);
                      if (!o) return null;
                      return (
                        <button key={sem.id} type="button" data-semester={sem.id}
                          disabled={!o.allowed}
                          onClick={() => onPick(sem.id)}
                          aria-describedby={`why-${sem.id}`}
                          style={{ transitionDuration: 'var(--dur)' }}
                          className={`block w-full rounded-md px-2.5 py-1.5 text-left transition-colors ${
                            o.allowed ? 'hover:bg-accent-soft focus-visible:bg-accent-soft' : 'cursor-not-allowed'
                          }`}>
                          <span className="flex items-baseline gap-2">
                            <span className={`min-w-0 flex-1 text-sm font-medium ${o.allowed ? 'text-ink' : 'text-ink-3'}`}>
                              {sem.label}
                              {sem.id === activeSemesterId && <span className="ml-1.5 text-xs font-normal text-accent">selected</span>}
                            </span>
                            <span className="tnum shrink-0 text-xs text-ink-3">{o.credits} cr planned</span>
                          </span>
                          <span id={`why-${sem.id}`} className="block">
                            {o.reasons.map((r, i) => (
                              <span key={i} className="block text-xs text-bad">{r}</span>
                            ))}
                            {o.allowed && o.notes.map((r, i) => (
                              <span key={i} className="block text-xs text-warn">{r}</span>
                            ))}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3">
          {!blocked && onAuto ? (
            <Button kind="quiet" onClick={onAuto}
              title="Puts the course in the first semester that works and adds any missing prerequisites to earlier semesters.">
              Pick for me
            </Button>
          ) : <span />}
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
