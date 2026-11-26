import React, { useEffect } from 'react';
import { Icon } from './icons.jsx';
import { Button } from './bits.jsx';

// "Are you sure?" step before wiping the open plan. Cancel is the default
// action (focused, and what Escape or a click outside does).
export function ClearPlanModal({ planName, onCancel, onConfirm }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
      role="alertdialog" aria-modal="true" aria-labelledby="clear-plan-title" aria-describedby="clear-plan-body"
      onClick={onCancel}>
      <div className="w-full max-w-md rounded-lg bg-surface p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 id="clear-plan-title" className="display mb-1 flex items-center gap-2 text-xl text-ink">
          <Icon name="warning" size="md" className="text-bad" /> Are you sure?
        </h2>
        <p id="clear-plan-body" className="text-sm leading-snug text-ink-2">
          This clears everything in <span className="font-semibold text-ink">{planName || 'this plan'}</span>:
          your majors, minors and clusters, every course in every semester, AP and transfer credit, and grades.
        </p>
        <p className="mt-2 text-xs leading-snug text-ink-3">
          This can't be undone. Your other saved plans aren't affected.
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button autoFocus onClick={onCancel}>Cancel</Button>
          <Button className="!border-bad !bg-bad !text-surface hover:brightness-110" onClick={onConfirm}>Clear plan</Button>
        </div>
      </div>
    </div>
  );
}
