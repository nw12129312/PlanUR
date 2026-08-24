// Inline SVG icon set.
//
// The ui-ux-pro-max pre-delivery checklist bans emoji as structural icons
// ("font-dependent, inconsistent across platforms, and cannot be controlled via
// design tokens"), and its pro-rules require one consistent stroke width per
// visual layer plus tokenised sizes. So: a single 24-box, 1.75 stroke, three
// size tokens, currentColor throughout.
import React from 'react';

const SIZES = { sm: 14, md: 16, lg: 20 };

const PATHS = {
  // requirement / auto-placement
  bolt: <path d="M13 2 4.5 13.2h6L11 22l8.5-11.2h-6L13 2Z" />,
  // lock state on a placed course
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </>
  ),
  unlock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
      <path d="M8 10.5V7a4 4 0 0 1 7.6-1.8" />
    </>
  ),
  // cluster marker (was a hexagon glyph)
  hexagon: <path d="M12 2.6 20 7.3v9.4L12 21.4 4 16.7V7.3l8-4.7Z" />,
  // equivalency group — "choose one path"
  swap: (
    <>
      <path d="M4 8h13m-3.5-3.5L17 8l-3.5 3.5" />
      <path d="M20 16H7m3.5-3.5L7 16l3.5 3.5" />
    </>
  ),
  // CDCS instructor chip on course cards
  user: (
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  // cross-listed course (same class, two department codes)
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l1.96-1.96a5 5 0 0 0-7.07-7.07L11.2 5.74" />
      <path d="M14 11a5 5 0 0 0-7.54-.54L4.5 12.42a5 5 0 0 0 7.07 7.07L13 18.06" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  warning: (
    <>
      <path d="M12 3.8 1.8 20.2h20.4L12 3.8Z" />
      <path d="M12 10v4.2M12 17.3v.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.7v.01" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  chevronUp: <path d="m6 14.5 6-6 6 6" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  chevronLeft: <path d="m14.5 6-6 6 6 6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5.5" width="17" height="15" rx="2" />
      <path d="M8 3.5v4M16 3.5v4M3.5 10.5h17" />
    </>
  ),
  clipboard: (
    <>
      <rect x="5.5" y="4.5" width="13" height="16" rx="2" />
      <path d="M9 4.5h6a2 2 0 0 1 2 2v1H7v-1a2 2 0 0 1 2-2Z" />
      <path d="M9 12h6M9 15.5h4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
    </>
  ),
  document: (
    <>
      <path d="M7 3.5h7.5L19.5 9v11.5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2Z" />
      <path d="M14.5 3.5V9h5.5" />
      <path d="M8.5 13h7M8.5 16.5h5" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10" />
    </>
  ),
};

// `label` gives an icon a name for assistive tech. Without it the icon is
// decorative and hidden from the accessibility tree — the skill's "Contextual
// Semantics" rule: semantics come from use, not from the glyph.
export function Icon({ name, size = 'md', label, className = '', filled = false }) {
  const px = SIZES[size] || SIZES.md;
  const body = PATHS[name];
  if (!body) return null;
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block shrink-0 ${className}`}
      aria-hidden={label ? undefined : 'true'}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
    >
      {body}
    </svg>
  );
}
