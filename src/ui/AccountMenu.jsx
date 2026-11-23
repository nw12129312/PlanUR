import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './icons.jsx';
import { Button } from './bits.jsx';

// Where the open plan is saved, shown in the header in place of a Save button.
// status: 'saving' | 'saved' | 'error'; sync: null (signed out) | 'syncing' | 'synced' | 'offline'
export function SaveStatus({ status, sync, backend }) {
  let text;
  let tone = 'text-ink-3';
  let icon = 'check';
  let title;
  if (status === 'saving' || sync === 'syncing') {
    text = sync ? 'Syncing…' : 'Saving…';
    icon = null;
  } else if (status === 'error') {
    text = 'Not saved';
    tone = 'text-bad';
    icon = 'warning';
    title = 'This browser blocked saving. Changes last until you close the tab.';
  } else if (sync === 'offline') {
    text = 'Saved here, will sync';
    tone = 'text-warn';
    icon = 'warning';
    title = "Your account couldn't be reached. Changes are saved on this device and sync when you're back online.";
  } else if (sync === 'synced') {
    text = 'Saved to account';
    title = 'Saved to your account and available on any device you sign in on.';
  } else {
    text = backend === 'browser' ? 'Saved in this browser' : 'Saved';
    title = 'Saved automatically on this device. No account needed.';
  }
  return (
    <span className={`inline-flex min-h-9 items-center gap-1 px-1 text-xs font-medium ${tone}`} title={title} role="status" aria-live="polite">
      {icon && <Icon name={icon} size="sm" />}
      <span className="hidden sm:inline">{text}</span>
    </span>
  );
}

function Avatar({ user, size = 28 }) {
  const [broken, setBroken] = useState(false);
  if (user.photoURL && !broken) {
    return (
      <img src={user.photoURL} alt="" width={size} height={size} referrerPolicy="no-referrer"
        className="rounded-full" onError={() => setBroken(true)} />
    );
  }
  return (
    <span className="inline-flex items-center justify-center rounded-full bg-accent text-[12px] font-bold text-accent-ink"
      style={{ width: size, height: size }} aria-hidden="true">
      {(user.name || '?').trim().charAt(0).toUpperCase()}
    </span>
  );
}

// Sign-in button, or the signed-in user's avatar with a small menu.
export function AccountMenu({ user, busy, onSignIn, onSignOut }) {
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

  if (!user) {
    return (
      <Button kind="ghost" onClick={onSignIn} disabled={busy}
        title="Optional. Keeps your plans in sync across devices.">
        <Icon name="user" size="sm" />
        {busy ? 'Signing in…' : <><span className="sm:hidden">Sign in</span><span className="hidden sm:inline">Sign in with Google</span></>}
      </Button>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button type="button" className="flex min-h-9 items-center rounded-full px-1 hover:bg-surface-2"
        aria-haspopup="menu" aria-expanded={open} aria-label={`Account: ${user.name}`}
        onClick={() => setOpen((o) => !o)}>
        <Avatar user={user} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-line bg-surface p-3 shadow-lg">
          <div className="flex items-center gap-2.5">
            <Avatar user={user} size={36} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink">{user.name}</div>
              {user.email && <div className="truncate text-xs text-ink-3">{user.email}</div>}
            </div>
          </div>
          <p className="mt-2.5 text-xs leading-relaxed text-ink-2">
            Your plans are saved to this account and stay in sync on every device you sign in on.
          </p>
          <Button kind="ghost" className="mt-2.5 w-full" role="menuitem" disabled={busy}
            onClick={() => { setOpen(false); onSignOut(); }}>
            Sign out
          </Button>
        </div>
      )}
    </div>
  );
}
