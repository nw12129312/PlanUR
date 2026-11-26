// Match CDCS instructor names to the RateMyProfessors directory.
// Never invent a rating: unmatched or ambiguous names return null.

const NICKNAMES = new Map([
  ['al', 'albert'], ['andy', 'andrew'], ['ben', 'benjamin'], ['bill', 'william'],
  ['bob', 'robert'], ['chris', 'christopher'], ['dan', 'daniel'], ['dave', 'david'],
  ['dick', 'richard'], ['ed', 'edward'], ['jim', 'james'], ['joe', 'joseph'],
  ['john', 'jonathan'], ['kate', 'katherine'], ['liz', 'elizabeth'],
  ['matt', 'matthew'], ['mike', 'michael'], ['nick', 'nicholas'], ['pat', 'patricia'],
  ['rich', 'richard'], ['rick', 'richard'], ['rob', 'robert'], ['ron', 'ronald'],
  ['sam', 'samuel'], ['steve', 'steven'], ['ted', 'theodore'], ['tim', 'timothy'],
  ['tom', 'thomas'], ['tony', 'anthony'], ['will', 'william'],
]);

function foldNick(first) {
  return NICKNAMES.get(first) || first;
}

export function normalizePersonName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(dr|prof|professor|mr|ms|mrs)\.?\b/g, ' ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensOf(name) {
  const n = normalizePersonName(name);
  if (!n) return null;
  const parts = n.replace(/-/g, ' ').split(' ').filter(Boolean);
  if (!parts.length) return null;
  return { full: n, first: parts[0], last: parts[parts.length - 1], parts };
}

function firstNamesMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return foldNick(a) === foldNick(b);
}

function indexDirectory(directory) {
  const professors = directory?.professors || [];
  const byFull = new Map();
  const byFirstLast = new Map();
  const byLast = new Map();
  const add = (map, key, rec) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(rec);
  };
  for (const p of professors) {
    const t = tokensOf(`${p.first || ''} ${p.last || ''}`);
    if (!t) continue;
    const rec = { ...p, _tokens: t };
    add(byFull, t.full, rec);
    add(byFirstLast, `${t.first}|${t.last}`, rec);
    add(byLast, t.last, rec);
  }
  return { byFull, byFirstLast, byLast };
}

let cachedDir = null;
let cachedIndex = null;

function getIndex(directory) {
  if (directory !== cachedDir) {
    cachedDir = directory;
    cachedIndex = indexDirectory(directory);
  }
  return cachedIndex;
}

function unique(list) {
  if (!list || list.length !== 1) return null;
  return list[0];
}

export function rmpForInstructor(name, directory) {
  const t = tokensOf(name);
  if (!t || !directory) return null;
  const idx = getIndex(directory);

  const full = unique(idx.byFull.get(t.full));
  if (full) return full;

  const fl = unique(idx.byFirstLast.get(`${t.first}|${t.last}`));
  if (fl) return fl;

  const lastHits = idx.byLast.get(t.last) || [];
  const firstHits = lastHits.filter((p) => firstNamesMatch(t.first, p._tokens.first));
  return unique(firstHits);
}

export function rmpPageUrl(rec) {
  if (!rec?.id) return null;
  return `https://www.ratemyprofessors.com/professor/${rec.id}`;
}

// University of Rochester's RateMyProfessors school id.
export const RMP_SCHOOL_ID = 1331;

// A RateMyProfessors search for this name at the school, for instructors
// with no single directory match.
export function rmpSearchUrl(name, schoolId = RMP_SCHOOL_ID) {
  const q = String(name || '').trim();
  if (!q) return null;
  return `https://www.ratemyprofessors.com/search/professors/${schoolId}?q=${encodeURIComponent(q)}`;
}

// Where an instructor's name should link: their own page when matched,
// otherwise a search for the name at the school.
export function rmpLinkForInstructor(name, directory) {
  const rec = rmpForInstructor(name, directory);
  const page = rmpPageUrl(rec);
  if (page) return { rec, href: page, exact: true };
  return { rec, href: rmpSearchUrl(name, directory?.schoolId || RMP_SCHOOL_ID), exact: false };
}

function num(n, digits = 1) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Number(n).toFixed(digits);
}

export function rmpCompactLine(rec) {
  if (!rec) return '';
  const n = rec.numRatings || 0;
  if (!n || rec.rating == null) return n ? `${n} rating${n === 1 ? '' : 's'}` : '';
  return `${num(rec.rating)}/5 · ${n}`;
}

export function rmpDetailLines(rec) {
  if (!rec) return ['No RateMyProfessors listing for this instructor.'];
  const n = rec.numRatings || 0;
  if (!n) return ['Listed on RateMyProfessors with no student ratings yet.'];
  const lines = [];
  if (rec.rating != null) lines.push(`Quality ${num(rec.rating)} / 5`);
  if (rec.difficulty != null) lines.push(`Difficulty ${num(rec.difficulty)} / 5`);
  if (rec.wouldTakeAgain != null) {
    lines.push(`Would take again ${Math.round(rec.wouldTakeAgain)}%`);
  }
  lines.push(`${n} rating${n === 1 ? '' : 's'} on RateMyProfessors`);
  return lines;
}

export function rmpAriaSummary(name, rec) {
  const line = rmpCompactLine(rec);
  return line ? `${name}, RateMyProfessors ${line}` : name;
}
