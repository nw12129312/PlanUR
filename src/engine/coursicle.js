// Link a course to its Coursicle page, where students leave reviews.
// Nothing is fetched: the URL is built from the course code alone.
//
// Coursicle files University of Rochester courses as
//   https://www.coursicle.com/rochester/courses/<SUBJ>/<NUM>/
// and lists suffixed numbers (MATH 235W, BIOL 250PW) under the base
// number, so the letter suffix is dropped.

const BASE = 'https://www.coursicle.com/rochester/courses';

export function coursiclePageUrl(courseId) {
  const m = /^([A-Z]{2,5})\s*(\d{3})[A-Z]*$/.exec(String(courseId || '').trim().toUpperCase());
  if (!m) return null;
  const [, subj, num] = m;
  // 000 is a placeholder number (transfer or generic credit), not a real course.
  if (num === '000') return null;
  return `${BASE}/${subj}/${num}/`;
}
