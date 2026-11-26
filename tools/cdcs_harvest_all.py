#!/usr/bin/env python3
"""Full CDCS catalog refresh — one POST per term.

CDCS (cdcs.ur.rochester.edu) returns the ENTIRE School of Arts & Sciences +
Hajim catalog for a term when the search form is posted with school=1 and an
empty department filter (verified 2026-07: identical content to unioning all
per-department queries — ~1,800 courses / ~79 departments per term). So a
complete refresh is one POST per term, not 540.

CDCS does not expose a dedicated Prerequisites form field. Required courses
usually live in:
  - Public Notes  ("Prerequisites: CSC 172 and MATH 150")
  - Description   (a second paragraph after the blurb, previously dropped)

The term list is read from the live CDCS term dropdown, not hardcoded: every
Fall/Spring/Summer term from the fall that started --years academic years ago
through the newest term CDCS has posted. With the default of 3 that is about
three full past years plus the current one (a dozen POSTs, a few seconds
apart). Each course records which of those terms it actually ran in
(terms_offered), so the planner can flag courses that have not been scheduled
anywhere in the window.

Course text (title, description, notes, instructors, credits) comes from the
course's most recent offering plus anything within a year before it, so a
2023 prerequisite note does not outlive a newer one.

Usage: python3 tools/cdcs_harvest_all.py <workdir> [--years N] [--list-terms]
  Writes <workdir>/cdcs-full-<term-slug>.json per term (reused if present, so
  a failed run can resume) and rebuilds data-src/ur-catalog-raw.json. Courses
  in the old raw file that CDCS no longer lists are kept, with no recent
  terms, so saved plans that use them still load. Run metadata goes to
  data-src/cdcs-harvest.json.
"""
import argparse, datetime, subprocess, re, html, json, os, sys, urllib.parse, time

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, '..', 'data-src', 'ur-catalog-raw.json')
BASE = 'https://cdcs.ur.rochester.edu/'
META = os.path.join(HERE, '..', 'data-src', 'cdcs-harvest.json')
# Seconds between POSTs. Each response is the whole term (several MB), so a
# short pause keeps a full refresh gentle on the registrar's server.
PAUSE = 5
SEASON_ORDER = {'spring': 0, 'summer': 1, 'fall': 2}
SEASON_NAME = {'spring': 'Spring', 'summer': 'Summer', 'fall': 'Fall'}

TYPES = {'Lecture','Laboratory','Lab','Recitation','Workshop','Seminar','Independent Study',
         'Internship','Practicum','Studio','Discussion','Credit','Research','Blank - for MUR use'}
code_re = re.compile(r'^([A-Z0-9]{2,5})\s+(\d{3}[A-Z]{0,2})-\S+$')
num_re = re.compile(r'^\d{1,2}\.\d$')

# CDCS labeled columns. "Prerequisites:" is body text, not a column — do not
# treat it as a stop label or we drop the codes on the next line.
FIELD_LABELS = {
    'Schedule:', 'Enrollment:', 'Books:', 'Description:', 'Offered:',
    'Instructors:', 'Delivery Mode:', 'Co-Located:', 'Public Notes:',
    'Restrictions:', 'Comments:',
}

def curl(args, timeout=240):
    return subprocess.run(['curl', '-sL', '--max-time', str(timeout)] + args,
                          capture_output=True, text=True).stdout

def collect_field(lines, i, limit=40):
    buf = []
    for j in range(i + 1, min(i + limit, len(lines))):
        lj = lines[j]
        if lj in FIELD_LABELS or code_re.match(lj):
            break
        buf.append(lj)
    return re.sub(r'\s+', ' ', ' '.join(buf)).strip()

def keep_longer(old, new):
    old, new = old or '', new or ''
    return new if len(new) > len(old) else old

def merge_text(old, new):
    old, new = (old or '').strip(), (new or '').strip()
    if not new:
        return old
    if not old:
        return new
    if new in old:
        return old
    if old in new:
        return new
    return old + ' | ' + new

# CDCS uses Staff/TBA when a section has no named instructor — drop those, never invent.
_INSTRUCTOR_PLACEHOLDER = re.compile(
    r'^(staff|tba|tbd|n/?a|none|unknown|to be (announced|assigned|determined)|'
    r'see (notes|department)|the instructor|[\-\.]+)$',
    re.I,
)

def split_instructors(raw):
    """Turn a CDCS Instructors cell into unique real names.

    Cells are usually one 'First Last' name. Team-taught sections separate
    people with semicolons, slashes, or 'and'. Do not split on commas —
    CDCS also uses 'Last, First'.
    """
    if not raw:
        return []
    raw = html.unescape(raw)
    parts = re.split(r'\s*(?:;|/|\band\b|&)\s*', raw)
    names, seen = [], set()
    for part in parts:
        name = re.sub(r'\s+', ' ', part).strip(' ,')
        if not name or _INSTRUCTOR_PLACEHOLDER.match(name):
            continue
        key = name.casefold()
        if key in seen:
            continue
        seen.add(key)
        names.append(name)
    return names

def merge_instructors(old, new):
    names, seen = [], set()
    for name in (old or []) + (new or []):
        n = re.sub(r'\s+', ' ', str(name)).strip()
        if not n:
            continue
        key = n.casefold()
        if key in seen:
            continue
        seen.add(key)
        names.append(n)
    return names

def parse(src, term):
    text = re.sub(r'<script.*?</script>|<style.*?</style>', '', src, flags=re.S)
    text = re.sub(r'<[^>]+>', '\n', text)
    text = html.unescape(text)
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    catalog, cur = {}, None
    for i, l in enumerate(lines):
        m = code_re.match(l)
        if m:
            code = f'{m.group(1)} {m.group(2)}'
            title, credits = None, None
            for j in range(i + 1, min(i + 8, len(lines))):
                lj = lines[j]
                if title is None and not code_re.match(lj) and lj not in TYPES:
                    title = lj
                elif num_re.match(lj):
                    credits = float(lj); break
            e = catalog.setdefault(code, {
                'title': title or '', 'credits': None, 'desc': '',
                'public_notes': '', 'restrictions': '', 'colocated': '',
                'offered_field': [], 'terms_seen': [term], 'dept': m.group(1),
                'instructors': [],
            })
            e.setdefault('instructors', [])
            if credits and (e['credits'] is None or credits > e['credits']): e['credits'] = credits
            if title and len(title) > len(e['title']): e['title'] = title
            cur = e
        elif l == 'Description:' and cur:
            cur['desc'] = keep_longer(cur['desc'], collect_field(lines, i))
        elif l == 'Offered:' and cur and i + 1 < len(lines):
            if lines[i+1] not in FIELD_LABELS and lines[i+1] not in cur['offered_field']:
                cur['offered_field'].append(lines[i+1])
        elif l == 'Public Notes:' and cur:
            cur['public_notes'] = merge_text(cur['public_notes'], collect_field(lines, i))
        elif l == 'Co-Located:' and cur:
            loc = collect_field(lines, i)
            cur['colocated'] = merge_text(cur.get('colocated', ''), loc)
        elif l == 'Restrictions:' and cur:
            cur['restrictions'] = merge_text(cur['restrictions'], collect_field(lines, i))
        elif l == 'Instructors:' and cur:
            cur['instructors'] = merge_instructors(
                cur.get('instructors'), split_instructors(collect_field(lines, i)),
            )
    return catalog

def merge(into, add):
    for code, e in add.items():
        t = into.setdefault(code, {
            'title': '', 'credits': None, 'desc': '',
            'public_notes': '', 'restrictions': '', 'colocated': '',
            'offered_field': [], 'terms_seen': [], 'dept': e['dept'],
            'instructors': [],
        })
        t.setdefault('public_notes', '')
        t.setdefault('restrictions', '')
        t.setdefault('colocated', '')
        t.setdefault('instructors', [])
        if e.get('credits') and (t['credits'] is None or e['credits'] > t['credits']):
            t['credits'] = e['credits']
        if len(e.get('title', '')) > len(t['title']): t['title'] = e['title']
        t['desc'] = keep_longer(t.get('desc', ''), e.get('desc', ''))
        t['public_notes'] = merge_text(t.get('public_notes', ''), e.get('public_notes', ''))
        t['restrictions'] = merge_text(t.get('restrictions', ''), e.get('restrictions', ''))
        t['colocated'] = merge_text(t.get('colocated', ''), e.get('colocated', ''))
        t['instructors'] = merge_instructors(t.get('instructors'), e.get('instructors'))
        for x in e.get('offered_field', []):
            if x not in t['offered_field']: t['offered_field'].append(x)
        for x in e.get('terms_seen', []):
            if x not in t['terms_seen']: t['terms_seen'].append(x)
    return into

# ------------------------------------------------------------------ terms ---

_TERM_RE = re.compile(r'\b(Fall|Spring|Summer)\s+(\d{4})\b', re.I)

def term_key(season, year):
    return f'{int(year)}-{season.lower()}'

def term_ord(key):
    year, season = key.split('-')
    return int(year) * 3 + SEASON_ORDER[season]

def term_label(key):
    year, season = key.split('-')
    return f'{SEASON_NAME[season]} {year}'

def season_of(key):
    return key.split('-')[1]

def term_starts(key):
    """Approximate first day of classes, only used to tell future terms apart."""
    year, season = key.split('-')
    month = {'spring': 1, 'summer': 5, 'fall': 8}[season]
    return datetime.date(int(year), month, 15)

def window_start(today, years):
    """First term of the window: the fall that began `years` academic years
    before the current one (Nov 2026, years=3 -> Fall 2023)."""
    ay = today.year if today.month >= 8 else today.year - 1
    return term_key('fall', ay - years)

def list_cdcs_terms(page):
    """{term_key: form value} from the CDCS term dropdown. When CDCS offers
    the same term under more than one prefix, the D- (day/College) value the
    planner has always used wins."""
    m = re.search(r'<select[^>]*name="ddlTerm"[^>]*>(.*?)</select>', page, re.S | re.I)
    if not m:
        return {}
    out = {}
    for value, text in re.findall(r'<option[^>]*value="([^"]*)"[^>]*>([^<]*)</option>', m.group(1), re.I):
        value = html.unescape(value)
        tm = _TERM_RE.search(value) or _TERM_RE.search(html.unescape(text))
        if not tm:
            continue
        key = term_key(tm.group(1), tm.group(2))
        if key not in out or (value.startswith('D-') and not out[key].startswith('D-')):
            out[key] = value
    return out

def select_terms(available, today, years):
    start = term_ord(window_start(today, years))
    return sorted((k for k in available if term_ord(k) >= start), key=term_ord)

# ---------------------------------------------------------------- rebuild ---

# Text from offerings within this many terms of a course's newest one is
# merged (3 = one year: Fall 2025, Spring/Summer 2026 and Fall 2026 all feed
# a course last seen in Fall 2026); anything older is ignored.
TEXT_SPAN = 4

def combine(parts, old_raw):
    """parts: {term_key: {code: entry}} -> rebuilt raw catalog."""
    by_code = {}
    for key, part in parts.items():
        for code, e in part.items():
            by_code.setdefault(code, []).append((term_ord(key), key, e))
    fetched = set(parts)
    latest = max(term_ord(k) for k in parts) if parts else 0
    catalog = {}
    for code, seen in by_code.items():
        seen.sort(key=lambda t: t[0])
        newest = seen[-1][0]
        acc = {}
        for o, key, e in seen:
            if newest - o <= TEXT_SPAN:
                merge(acc, {code: e})
        e = acc[code]
        # Co-location pairs a section with another code in that one term, and
        # build_data chains pairs into cross-listing families. Only the
        # catalog's latest year counts, or an old pairing (ENGL 375 with
        # ENGL 475 in 2024) joins classes that are separate today.
        e['colocated'] = ''
        for o, _, x in seen:
            if latest - o <= TEXT_SPAN:
                e['colocated'] = merge_text(e['colocated'], x.get('colocated', ''))
        history = {key for _, key, _ in seen}
        old = old_raw.get(code) or {}
        history |= {k for k in old.get('terms_offered') or [] if k not in fetched}
        e['terms_offered'] = sorted(history, key=term_ord)
        e['terms_seen'] = sorted({season_of(k) for k in e['terms_offered']})
        e['instructors'] = sorted(e.get('instructors') or [], key=str.casefold)
        catalog[code] = e
    # Courses CDCS no longer lists at all: keep the last known entry so plans
    # that use them still load, but with no terms in the window.
    for code, old in old_raw.items():
        if code in catalog:
            continue
        kept = dict(old)
        kept['terms_offered'] = [k for k in old.get('terms_offered') or [] if k not in fetched]
        catalog[code] = kept
    return {code: catalog[code] for code in sorted(catalog)}

def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('workdir')
    ap.add_argument('--years', type=int, default=3,
                    help='academic years of history before the current one (default 3)')
    ap.add_argument('--list-terms', action='store_true',
                    help='print the terms CDCS offers and the ones in the window, then exit')
    ap.add_argument('--offline', action='store_true',
                    help='rebuild only from the term dumps already in workdir')
    ap.add_argument('--today', help='YYYY-MM-DD; defaults to the current date (for testing)')
    args = ap.parse_args()
    today = datetime.date.fromisoformat(args.today) if args.today else datetime.date.today()

    work = args.workdir
    os.makedirs(work, exist_ok=True)
    cookies = os.path.join(work, 'cdcs-refresh-cookies.txt')
    if args.offline:
        # Rebuild from dumps already in <workdir> without contacting CDCS.
        page = ''
        available = {}
        for name in os.listdir(work):
            m = re.match(r'cdcs-full-(Fall|Spring|Summer)-(\d{4})\.json$', name)
            if m:
                available[term_key(m.group(1), m.group(2))] = f'D-{m.group(1)} {m.group(2)}'
    else:
        page = curl(['-c', cookies, BASE])
        available = list_cdcs_terms(page)
    assert available, 'could not read the CDCS term list (page layout changed or site unreachable)'
    terms = select_terms(available, today, args.years)
    print(f'CDCS lists {len(available)} terms: ' +
          ', '.join(term_label(k) for k in sorted(available, key=term_ord)))
    print(f'Window ({args.years}y back from {today}): ' + ', '.join(term_label(k) for k in terms))
    if args.list_terms:
        return
    assert terms, 'no CDCS terms fall inside the window'

    def hidden(name):
        m = re.search(r'name="%s"[^>]*value="([^"]*)"' % name, page)
        return m.group(1) if m else ''
    form = {
        '__VIEWSTATE': hidden('__VIEWSTATE'), '__VIEWSTATEGENERATOR': hidden('__VIEWSTATEGENERATOR'),
        '__EVENTVALIDATION': hidden('__EVENTVALIDATION'),
        'ddlSchool': '1', 'ddlDept': '', 'txtCourse': '', 'ddlTypes': '', 'ddlStatus': '',
        'txtDescription': '', 'txtTitle': '', 'txtInstructor': '', 'ddlDeliveryMode': '',
        'btnSearchTop': 'Search',
    }
    assert args.offline or form['__VIEWSTATE'], 'no VIEWSTATE'

    parts, stats = {}, []
    for key in terms:
        season = season_of(key)
        out = os.path.join(work, f'cdcs-full-{term_label(key).replace(" ", "-")}.json')
        part = None
        if os.path.exists(out):
            part = json.load(open(out))
            sample = next(iter(part.values()), {})
            if 'instructors' not in sample:  # pre-instructor dumps
                part = None
        if part is None:
            body = dict(form); body['ddlTerm'] = available[key]
            print(f'POST {available[key]} …', flush=True)
            resp = curl(['-b', cookies, '--data-raw', urllib.parse.urlencode(body), BASE])
            part = parse(resp, season)
            time.sleep(PAUSE)
            min_courses = 80 if season == 'summer' else 500
            if len(part) <= min_courses:
                # A future term CDCS lists before departments have posted
                # sections (Summer 2027 in November) is skipped, not fatal;
                # the next run picks it up once it fills in.
                if term_starts(key) > today:
                    print(f'{term_label(key)}: only {len(part)} courses posted so far, skipping for now')
                    continue
                raise SystemExit(f'{available[key]} dump looks truncated '
                                 f'({len(part)} courses, {len(resp)} bytes)')
            json.dump(part, open(out, 'w'))
        notes = sum(1 for e in part.values() if e.get('public_notes'))
        named = sum(1 for e in part.values() if e.get('instructors'))
        print(f'{term_label(key)}: {len(part)} courses, {notes} with public notes, {named} with instructors')
        parts[key] = part
        stats.append({'term': key, 'label': term_label(key), 'courses': len(part)})

    old_raw = json.load(open(RAW)) if os.path.exists(RAW) else {}
    catalog = combine(parts, old_raw)
    with open(RAW, 'w') as f:
        json.dump(catalog, f, indent=1)
        f.write('\n')
    with open(META, 'w') as f:
        json.dump({
            'source': BASE,
            'harvestedOn': today.isoformat(),
            'years': args.years,
            'windowStart': window_start(today, args.years),
        # Terms CDCS lists but which had too few sections to use yet.
        'skipped': [term_label(k) for k in terms if k not in parts],
            'terms': stats,
        }, f, indent=1)
        f.write('\n')
    depts = len({e['dept'] for e in catalog.values()})
    recent = sum(1 for e in catalog.values() if e.get('terms_offered'))
    print(f'rebuilt catalog: {len(catalog)} courses across {depts} departments, '
          f'{recent} scheduled in the window -> {RAW}')

if __name__ == '__main__':
    main()
