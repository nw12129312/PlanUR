// Links for the Feedback menu. PlanUR is a static site with no backend, so
// feedback goes to a new GitHub issue in the repo, using the issue forms in
// .github/ISSUE_TEMPLATE. Field ids in the query string prefill the form.
import meta from './data/meta.json';

export const ISSUES_URL = 'https://github.com/nw12129312/PlanUR/issues/new';

// A Google Form for visitors without a GitHub account. Leave empty to hide
// the option in the Feedback menu.
export const FEEDBACK_FORM_URL = '';

export const FEEDBACK_KINDS = {
  bug: { template: 'bug_report.yml', title: 'Bug: ' },
  feedback: { template: 'feedback.yml', title: 'Feedback: ' },
};

// Plain facts that help reproduce a problem. Nothing from the user's plan.
export function environmentInfo(win = globalThis.window) {
  const nav = win?.navigator;
  const lines = [
    `Browser: ${nav?.userAgent || 'unknown'}`,
    `Language: ${nav?.language || 'unknown'}`,
  ];
  if (win?.innerWidth) lines.push(`Window: ${win.innerWidth} x ${win.innerHeight}`);
  if (win?.screen?.width) lines.push(`Screen: ${win.screen.width} x ${win.screen.height} @${win.devicePixelRatio || 1}x`);
  lines.push(`Catalog data: ${meta.builtOn}`);
  if (win?.location?.href) lines.push(`Page: ${win.location.origin}${win.location.pathname}`);
  return lines.join('\n');
}

export function feedbackUrl(kind, win = globalThis.window) {
  const k = FEEDBACK_KINDS[kind] || FEEDBACK_KINDS.feedback;
  const params = new URLSearchParams({
    template: k.template,
    title: k.title,
    environment: environmentInfo(win),
  });
  return `${ISSUES_URL}?${params}`;
}
