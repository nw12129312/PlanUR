// Small shared UI primitives.
import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons.jsx';

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

function optionMatches(option, query) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const hay = `${option.label} ${option.keywords || ''} ${option.group || ''}`.toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

export function Meter({ have, need, complete }) {
  const pct = need ? Math.min(100, Math.round((100 * have) / need)) : 0;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="h-1.5 flex-1 rounded-full bg-surface-2 overflow-hidden" role="presentation">
        <div
          className={`h-full rounded-full transition-all ${complete ? 'bg-good' : 'bg-accent'}`}
          style={{ width: `${pct}%`, transitionDuration: 'var(--dur)' }}
        />
      </div>
      <span className="tnum shrink-0 text-xs font-medium text-ink-3">{have}/{need}</span>
    </div>
  );
}

const SEV = {
  error: { cls: 'bg-bad-soft text-bad', icon: 'error', label: 'Error' },
  warning: { cls: 'bg-warn-soft text-warn', icon: 'warning', label: 'Warning' },
  info: { cls: 'bg-info-soft text-info', icon: 'info', label: 'Note' },
};

export function SevChip({ severity, children, title }) {
  const s = SEV[severity] || SEV.info;
  return (
    <span
      className={`chip-line gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium ${s.cls}`}
      title={title}
    >
      <Icon name={s.icon} size="sm" />
      <span className="sr-only">{s.label}: </span>
      <span className="chip-text">{children}</span>
    </span>
  );
}

export function Tag({ tone = 'neutral', children, title, icon }) {
  const tones = {
    neutral: 'bg-surface-2 text-ink-2',
    accent: 'bg-accent-soft text-accent',
    cta: 'bg-cta-soft text-cta-strong',
    gold: 'bg-gold-soft text-gold',
    good: 'bg-good-soft text-good',
    warn: 'bg-warn-soft text-warn',
    bad: 'bg-bad-soft text-bad',
  };
  return (
    <span
      title={title}
      className={`chip-line gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {icon && <Icon name={icon} size="sm" />}
      <span className="chip-text">{children}</span>
      {title && <span className="sr-only"> — {title}</span>}
    </span>
  );
}

export function Button({ kind = 'ghost', className = '', ...props }) {
  const kinds = {
    primary: 'bg-accent text-accent-ink border border-accent hover:brightness-110 active:brightness-95 shadow-sm',
    cta: 'bg-cta text-cta-ink border border-cta hover:brightness-110 active:brightness-95 shadow-sm',
    ghost: 'bg-surface text-ink-2 border border-line hover:bg-surface-2 hover:text-ink hover:border-ink-3/30',
    quiet: 'bg-transparent text-ink-2 border border-transparent hover:bg-surface-2 hover:text-ink',
    danger: 'bg-transparent text-bad border border-transparent hover:bg-bad-soft',
  };
  return (
    <button
      type="button"
      style={{ transitionDuration: 'var(--dur)' }}
      className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-semibold transition-colors disabled:opacity-40 ${kinds[kind]} ${className}`}
      {...props}
    />
  );
}

export function IconButton({ icon, label, tone = 'quiet', className = '', size = 'md', ...props }) {
  const tones = {
    quiet: 'text-ink-3 hover:bg-surface-2 hover:text-ink',
    danger: 'text-ink-3 hover:bg-bad-soft hover:text-bad',
    accent: 'text-accent hover:bg-accent-soft',
  };
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      style={{ transitionDuration: 'var(--dur)' }}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${tones[tone]} ${className}`}
      {...props}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

export function Select({ className = '', ...props }) {
  return (
    <select
      style={{ transitionDuration: 'var(--dur)' }}
      className={`select-flat min-h-8 w-full rounded-md border border-line px-2.5 text-[13px] font-medium text-ink shadow-sm transition-colors hover:border-ink-3/40 focus:border-accent focus:ring-2 focus:ring-accent/20 ${className}`}
      {...props}
    />
  );
}

// Type-to-filter combobox used by the long major / minor / cluster lists.
// `options` is [{ value, label, keywords?, group?, disabled? }].
export function SearchSelect({
  options,
  value = '',
  onChange,
  placeholder = 'Search…',
  allowClear = false,
  className = '',
  'aria-label': ariaLabel,
}) {
  const uid = useId();
  const listId = `${uid}-list`;
  const wrapRef = useRef(null);
  const menuRef = useRef(null);
  const searchRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState(null);

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(
    () => options.filter((o) => !o.disabled && optionMatches(o, query)),
    [options, query],
  );

  const updatePos = () => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const maxH = 240;
    const gap = 4;
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const spaceAbove = r.top - 8;
    const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
    setPos({
      left: Math.round(r.left),
      width: Math.round(r.width),
      top: openUp ? undefined : Math.round(r.bottom + gap),
      bottom: openUp ? Math.round(window.innerHeight - r.top + gap) : undefined,
      maxHeight: Math.min(maxH, Math.max(120, openUp ? spaceAbove : spaceBelow)),
    });
  };

  useIsoLayoutEffect(() => {
    if (!open) return;
    updatePos();
    searchRef.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      close();
    };
    const onReposition = () => updatePos();
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const item = menuRef.current?.querySelector('[data-active="true"]');
    const list = menuRef.current?.querySelector('[role="listbox"]');
    if (!item || !list) return;
    const itemRect = item.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    if (itemRect.top < listRect.top) list.scrollTop -= listRect.top - itemRect.top;
    else if (itemRect.bottom > listRect.bottom) list.scrollTop += itemRect.bottom - listRect.bottom;
  }, [active, open, filtered]);

  const close = (restoreFocus = false) => {
    setOpen(false);
    setQuery('');
    setActive(0);
    if (restoreFocus) {
      wrapRef.current?.querySelector('button[data-trigger]')?.focus({ preventScroll: true });
    }
  };

  const pick = (opt) => {
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    close(true);
  };

  const openMenu = () => {
    setQuery('');
    const visible = options.filter((o) => !o.disabled);
    const idx = visible.findIndex((o) => o.value === value);
    setActive(idx < 0 ? 0 : idx);
    updatePos();
    setOpen(true);
  };

  const onTriggerKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!open) openMenu();
    }
  };

  const onSearchKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[active]) pick(filtered[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Tab') {
      close();
    }
  };

  const menu = open && pos && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={menuRef}
        id={listId}
        className="fixed z-[60] overflow-hidden rounded-md border border-line bg-surface shadow-lg"
        style={{
          left: pos.left,
          width: pos.width,
          top: pos.top,
          bottom: pos.bottom,
        }}
      >
        <div className="border-b border-line p-1.5">
          <div className="relative">
            <Icon name="search" size="sm" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onSearchKey}
              autoComplete="off"
              spellCheck={false}
              placeholder="Type to filter…"
              aria-label="Filter options"
              aria-autocomplete="list"
              aria-controls={listId}
              aria-activedescendant={filtered[active] ? `${uid}-opt-${filtered[active].value}` : undefined}
              className="input-flat min-h-8 w-full rounded-md border border-line py-1 pl-7 pr-2 text-[13px] font-medium text-ink shadow-none placeholder:font-normal placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
        </div>
        <ul
          role="listbox"
          className="overflow-y-auto py-1"
          style={{ maxHeight: pos.maxHeight }}
        >
          {allowClear && value && !query.trim() && (
            <li>
              <button
                type="button"
                role="option"
                aria-selected="false"
                className="flex w-full px-2.5 py-1.5 text-left text-[13px] text-ink-3 hover:bg-surface-2"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(''); close(true); }}
              >
                Clear selection
              </button>
            </li>
          )}
          {filtered.length === 0 && (
            <li className="px-2.5 py-2 text-[13px] text-ink-3">No matches</li>
          )}
          {filtered.map((opt, i) => {
            const prev = filtered[i - 1];
            const showGroup = opt.group && opt.group !== prev?.group;
            return (
              <React.Fragment key={opt.value}>
                {showGroup && (
                  <li className="px-2.5 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-3">
                    {opt.group}
                  </li>
                )}
                <li>
                  <button
                    type="button"
                    id={`${uid}-opt-${opt.value}`}
                    role="option"
                    aria-selected={opt.value === value}
                    data-active={i === active ? 'true' : undefined}
                    className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[13px] ${
                      i === active ? 'bg-accent-soft text-ink' : 'text-ink hover:bg-surface-2'
                    }`}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(opt)}
                  >
                    <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                    {opt.value === value && <Icon name="check" size="sm" className="shrink-0 text-accent" />}
                  </button>
                </li>
              </React.Fragment>
            );
          })}
        </ul>
      </div>,
      document.body,
    )
    : null;

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <div
        style={{ transitionDuration: 'var(--dur)' }}
        className="flex min-h-8 w-full items-center rounded-md border border-line bg-surface shadow-sm transition-colors hover:border-ink-3/40 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20"
      >
        <button
          type="button"
          data-trigger
          aria-label={selected ? undefined : (ariaLabel || placeholder)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => (open ? close() : openMenu())}
          onKeyDown={onTriggerKey}
          className="flex min-h-8 min-w-0 flex-1 items-center px-2.5 py-1 text-left text-[13px] font-medium text-ink"
        >
          <span className={`min-w-0 flex-1 truncate ${selected ? 'text-ink' : 'font-normal text-ink-3'}`}>
            {selected ? selected.label : placeholder}
          </span>
          <Icon name="chevronDown" size="sm" className={`ml-1 shrink-0 text-ink-3 ${open ? 'rotate-180' : ''}`} />
        </button>
        {allowClear && value ? (
          <button
            type="button"
            aria-label="Clear selection"
            className="mr-1 shrink-0 rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-ink"
            onClick={() => { onChange(''); close(); }}
          >
            <Icon name="close" size="sm" />
          </button>
        ) : null}
      </div>
      {menu}
    </div>
  );
}

export function TextInput({ className = '', ...props }) {
  return (
    <input
      style={{ transitionDuration: 'var(--dur)' }}
      className={`input-flat min-h-8 w-full rounded-md border border-line px-2.5 text-[13px] font-medium text-ink shadow-sm transition-colors placeholder:font-normal placeholder:text-ink-3 hover:border-ink-3/40 focus:border-accent focus:ring-2 focus:ring-accent/20 ${className}`}
      {...props}
    />
  );
}

export function SectionTitle({ children, right, subtitle }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h2 className="display text-[15px] text-ink">{children}</h2>
        {subtitle && <p className="mt-0.5 text-[12px] text-ink-3">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function Panel({ title, subtitle, icon, children, className = '', headerRight, bodyClassName = '' }) {
  return (
    <section className={`panel ${className}`}>
      {(title || headerRight) && (
        <header className="panel-header">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon && (
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                <Icon name={icon} size="sm" />
              </span>
            )}
            <div className="min-w-0">
              {title && <h2 className="panel-title">{title}</h2>}
              {subtitle && <p className="panel-subtitle">{subtitle}</p>}
            </div>
          </div>
          {headerRight}
        </header>
      )}
      <div className={`panel-body ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function Ring({ pct, size = 32, label }) {
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct || 0));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
      aria-label={label || `${clamped}% complete`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="3.5" />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={clamped >= 100 ? 'var(--good)' : 'var(--accent)'}
        strokeWidth="3.5" strokeLinecap="round"
        strokeDasharray={`${(circ * clamped) / 100} ${circ}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
        className="tnum" fontSize="10" fontWeight="600" fill="var(--ink)">{clamped}</text>
    </svg>
  );
}
