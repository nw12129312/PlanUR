import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './icons.jsx';
import { Button } from './bits.jsx';
import { feedbackUrl } from '../feedback.js';

const ITEMS = [
  { kind: 'bug', icon: 'bug', label: 'Report a bug', note: 'Something is broken or looks wrong' },
  { kind: 'feedback', icon: 'message', label: 'Share feedback', note: 'An idea, or a missing course or major' },
];

// Header button with two links that open a prefilled GitHub issue in a new tab.
export function FeedbackMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Button kind="quiet" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        title="Report a bug or share feedback">
        <Icon name="message" size="sm" />
        Feedback
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-line bg-surface p-1.5 shadow-lg">
          {ITEMS.map((item) => (
            <a key={item.kind} role="menuitem" href={feedbackUrl(item.kind)} target="_blank" rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-start gap-2.5 rounded-md px-2.5 py-2 text-ink-2 hover:bg-surface-2 hover:text-ink">
              <Icon name={item.icon} size="md" className="mt-0.5" />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-ink">{item.label}</span>
                <span className="block text-xs text-ink-3">{item.note}</span>
              </span>
            </a>
          ))}
          <p className="px-2.5 pb-1.5 pt-1 text-xs leading-relaxed text-ink-3">
            Opens a GitHub issue with your browser details filled in. You'll need a free GitHub account to post it.
          </p>
        </div>
      )}
    </div>
  );
}
