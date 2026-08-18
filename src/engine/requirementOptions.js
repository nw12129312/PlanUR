// Describes HOW a requirement group may be satisfied, so the UI can show the
// alternatives instead of only a progress bar.
//
// The wording matters and differs per rule type. An equivalency group really
// is "choose one path, mixing is blocked" — checkEquivalencyConflicts enforces
// it. An ordinary n_of is just "choose 2 of these 9" and mixing is fine. Using
// the stronger phrasing everywhere would tell students their degree has
// constraints it does not have, so each rule gets its own accurate summary.
//
// Pure functions; no UI or storage imports.

import { matchesFilter } from './candidates.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Human description of an n_from_filter's catch-all, e.g.
// "any BIOL or CHEM course numbered 200-399, 4+ credits".
export function describeFilter(filter = {}) {
  const parts = [];
  const depts = filter.depts || [];
  if (depts.length === 0) parts.push('any course');
  else if (depts.length <= 3) parts.push(`any ${depts.join(' or ')} course`);
  else parts.push(`any course from ${depts.length} departments`);

  const { minNumber: lo, maxNumber: hi } = filter;
  if (lo != null && hi != null) parts.push(`numbered ${lo}-${hi}`);
  else if (lo != null) parts.push(`numbered ${lo}+`);
  else if (hi != null) parts.push(`numbered up to ${hi}`);

  if (filter.minCredits != null) parts.push(`${filter.minCredits}+ credits`);
  if (filter.wOnly) parts.push('W-designated only');
  return parts.join(', ');
}

// { kind, summary, choice, sets?, options?, total? }
//   kind    all | choose | sequence | track | breadth | filter | none
//   choice  true when the student actually picks between alternatives
//   sets    named alternatives (sequences, tracks) — each {name, courses}
//   options flat course list (all_of, n_of)
export function describeRequirement(group, data, opts = {}) {
  const r = group?.rule;
  if (!r) return { kind: 'none', summary: '', choice: false };

  if (r.type === 'all_of') {
    const courses = [...r.courses];
    return { kind: 'all', choice: false, options: courses, total: courses.length,
      summary: courses.length === 1 ? 'Required' : `All ${courses.length} required` };
  }

  if (r.type === 'n_of') {
    const options = [...r.options];
    // n_of with a single option is a required course wearing a choice's clothes
    if (options.length <= r.n) {
      return { kind: 'all', choice: false, options, total: options.length,
        summary: options.length === 1 ? 'Required' : `All ${options.length} required` };
    }
    return { kind: 'choose', choice: true, options, total: options.length, need: r.n,
      summary: `Choose ${r.n} of ${options.length}` };
  }

  if (r.type === 'sequence_one_of') {
    const sets = r.sequences.map((seq, i) => ({
      name: seq.length === 1 ? seq[0] : `${seq[0]} → ${seq[seq.length - 1]}`,
      courses: [...seq],
    }));
    return { kind: 'sequence', choice: sets.length > 1, sets, total: sets.length,
      summary: sets.length > 1
        ? `Complete ONE of ${sets.length} sequences`
        : `Complete the ${plural(sets[0]?.courses.length || 0, 'course', 'courses')} in order` };
  }

  if (r.type === 'track_n_of') {
    const sets = Object.entries(r.tracks).map(([name, courses]) => ({ name, courses: [...courses] }));
    return { kind: 'track', choice: sets.length > 1, sets, total: sets.length, need: r.n,
      summary: `${plural(r.n, 'course', 'courses')} — all from ONE of ${sets.length} tracks` };
  }

  if (r.type === 'breadth_outside_track') {
    return { kind: 'breadth', choice: true, need: r.n, total: null,
      summary: `${plural(r.n, 'course', 'courses')} from tracks other than the one you chose` };
  }

  if (r.type === 'n_from_filter') {
    const count = data
      ? Object.values(data.courses).filter((c) => matchesFilter(c, r.filter)).length
      : null;
    return { kind: 'filter', choice: true, need: r.n, total: count,
      filterText: describeFilter(r.filter),
      summary: count == null
        ? `Any ${plural(r.n, 'course', 'courses')} matching a filter`
        : `Choose ${r.n} of ${count} matching courses` };
  }

  return { kind: 'none', summary: '', choice: false };
}
