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

Usage: python3 tools/cdcs_harvest_all.py <workdir>
  Writes <workdir>/cdcs-full-<term-slug>.json and merges everything (plus any
  existing harvest at data-src/ur-catalog-raw.json) into
  data-src/ur-catalog-raw.json.
"""
import subprocess, re, html, json, os, sys, urllib.parse, time

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, '..', 'data-src', 'ur-catalog-raw.json')
BASE = 'https://cdcs.ur.rochester.edu/'
# Fall 2026 is the current registration term; keep 2025-26 so offered terms
# still cover the academic year the planner was built against.
TERMS = [
    ('D-Fall 2025', 'fall'),
    ('D-Spring 2026', 'spring'),
    ('D-Fall 2026', 'fall'),
]

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
            })
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
    return catalog

def merge(into, add):
    for code, e in add.items():
        t = into.setdefault(code, {
            'title': '', 'credits': None, 'desc': '',
            'public_notes': '', 'restrictions': '', 'colocated': '',
            'offered_field': [], 'terms_seen': [], 'dept': e['dept'],
        })
        t.setdefault('public_notes', '')
        t.setdefault('restrictions', '')
        t.setdefault('colocated', '')
        if e.get('credits') and (t['credits'] is None or e['credits'] > t['credits']):
            t['credits'] = e['credits']
        if len(e.get('title', '')) > len(t['title']): t['title'] = e['title']
        t['desc'] = keep_longer(t.get('desc', ''), e.get('desc', ''))
        t['public_notes'] = merge_text(t.get('public_notes', ''), e.get('public_notes', ''))
        t['restrictions'] = merge_text(t.get('restrictions', ''), e.get('restrictions', ''))
        t['colocated'] = merge_text(t.get('colocated', ''), e.get('colocated', ''))
        for x in e.get('offered_field', []):
            if x not in t['offered_field']: t['offered_field'].append(x)
        for x in e.get('terms_seen', []):
            if x not in t['terms_seen']: t['terms_seen'].append(x)
    return into

def main():
    if len(sys.argv) < 2:
        sys.exit('Usage: python3 tools/cdcs_harvest_all.py <workdir>')
    work = sys.argv[1]
    cookies = os.path.join(work, 'cdcs-refresh-cookies.txt')
    os.makedirs(work, exist_ok=True)
    page = curl(['-c', cookies, BASE])
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
    assert form['__VIEWSTATE'], 'no VIEWSTATE'

    catalog = {}
    if os.path.exists(RAW):
        catalog = merge(catalog, json.load(open(RAW)))
    for term_value, term in TERMS:
        slug = term_value.replace(' ', '-').replace('D-', '')
        out = os.path.join(work, f'cdcs-full-{slug}.json')
        if os.path.exists(out):
            part = json.load(open(out))
        else:
            body = dict(form); body['ddlTerm'] = term_value
            print(f'POST {term_value} …', flush=True)
            resp = curl(['-b', cookies, '--data-raw', urllib.parse.urlencode(body), BASE])
            part = parse(resp, term)
            assert len(part) > 500, f'{term_value} dump looks truncated ({len(part)} courses, {len(resp)} bytes)'
            json.dump(part, open(out, 'w'))
            time.sleep(1)
        notes = sum(1 for e in part.values() if e.get('public_notes'))
        print(f'{term_value}: {len(part)} courses, {notes} with public notes')
        catalog = merge(catalog, part)
    for e in catalog.values():
        e['terms_seen'] = sorted(set(e['terms_seen']))
    json.dump(catalog, open(RAW, 'w'), indent=1)
    depts = len({e['dept'] for e in catalog.values()})
    print(f'merged catalog: {len(catalog)} courses across {depts} departments -> {RAW}')

if __name__ == '__main__':
    main()
