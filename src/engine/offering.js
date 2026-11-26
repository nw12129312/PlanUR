// Recency of a course's offerings, from the CDCS harvest window
// (tools/cdcs_harvest_all.py collects about three academic years of
// schedules). build_data.py sets notRecentlyOffered on any course with no
// section in that window, such as an old requirement-list course that UR no
// longer runs, and lastOffered to the newest term it was seen in.
//
// Pure functions; no UI or storage imports.

const SEASON = { fall: 'Fall', spring: 'Spring', summer: 'Summer' };

// "2025-fall" -> "Fall 2025"
export function termLabel(key) {
  if (!key) return '';
  const [year, season] = String(key).split('-');
  return SEASON[season] ? `${SEASON[season]} ${year}` : String(key);
}

export function isNotRecentlyOffered(course) {
  return !!course?.notRecentlyOffered;
}

// One sentence on why the course is flagged, or null when it isn't.
// `windowLabel` (e.g. "Fall 2023 to Spring 2027") comes from meta.json.
export function notRecentlyOfferedMessage(course, windowLabel) {
  if (!isNotRecentlyOffered(course)) return null;
  const span = windowLabel ? ` (${windowLabel})` : ' from the last few years';
  const last = course.lastOffered ? ` It last ran in ${termLabel(course.lastOffered)}.` : '';
  return `${course.id} has no sections in any UR course schedule${span}.${last} ` +
    'It may have been discontinued or renumbered, so check with the department before planning on it.';
}
