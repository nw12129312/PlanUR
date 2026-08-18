#!/usr/bin/env python3
"""Full CDCS catalog refresh in two requests.

CDCS (cdcs.ur.rochester.edu) returns the ENTIRE School of Arts & Sciences +
Hajim catalog for a term when the search form is posted with school=1 and an
empty department filter (verified 2026-07: identical content to unioning all
per-department queries — ~1,800 courses / ~79 departments per term). So a
complete refresh is one POST per term, not 540.

Usage: python3 tools/cdcs_harvest_all.py <workdir>
  Writes <workdir>/cdcs-full-<term>.json and merges everything (plus any
  existing per-dept harvest at data-src/ur-catalog-raw.json) into
  data-src/ur-catalog-raw.json.
"""
import subprocess, re, html, json, os, sys, urllib.parse, time

WORK = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, '..', 'data-src', 'ur-catalog-raw.json')
BASE = 'https://cdcs.ur.rochester.edu/'
COOKIES = os.path.join(WORK, 'cdcs-refresh-cookies.txt')
TERMS = [('D-Fall 2025', 'fall'), ('D-Spring 2026', 'spring')]

TYPES = {'Lecture','Laboratory','Lab','Recitation','Workshop','Seminar','Independent Study',
         'Internship','Practicum','Studio','Discussion','Credit','Research','Blank - for MUR use'}
code_re = re.compile(r'^([A-Z0-9]{2,5})\s+(\d{3}[A-Z]{0,2})-\S+$')
num_re = re.compile(r'^\d{1,2}\.\d$')

def curl(args, timeout=240):
    return subprocess.run(['curl', '-sL', '--max-time', str(timeout)] + args,
                          capture_output=True, text=True).stdout

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
            e = catalog.setdefault(code, {'title': title or '', 'credits': None, 'desc': '',
                                          'offered_field': [], 'terms_seen': [term], 'dept': m.group(1)})
            if credits and (e['credits'] is None or credits > e['credits']): e['credits'] = credits
            if title and len(title) > len(e['title']): e['title'] = title
            cur = e
        elif l == 'Description:' and cur and i + 1 < len(lines):
            if len(lines[i+1]) > len(cur['desc']): cur['desc'] = lines[i+1]
        elif l == 'Offered:' and cur and i + 1 < len(lines):
            if lines[i+1] not in cur['offered_field']: cur['offered_field'].append(lines[i+1])
    return catalog

def merge(into, add):
    for code, e in add.items():
        t = into.setdefault(code, {'title': '', 'credits': None, 'desc': '',
                                   'offered_field': [], 'terms_seen': [], 'dept': e['dept']})
        if e.get('credits') and (t['credits'] is None or e['credits'] > t['credits']):
            t['credits'] = e['credits']
        if len(e.get('title', '')) > len(t['title']): t['title'] = e['title']
        if len(e.get('desc', '')) > len(t['desc']): t['desc'] = e['desc']
        for x in e.get('offered_field', []):
            if x not in t['offered_field']: t['offered_field'].append(x)
        for x in e.get('terms_seen', []):
            if x not in t['terms_seen']: t['terms_seen'].append(x)
    return into

def main():
    page = curl(['-c', COOKIES, BASE])
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
        out = os.path.join(WORK, f'cdcs-full-{term}.json')
        if os.path.exists(out):
            part = json.load(open(out))
        else:
            body = dict(form); body['ddlTerm'] = term_value
            resp = curl(['-b', COOKIES, '--data-raw', urllib.parse.urlencode(body), BASE])
            part = parse(resp, term)
            assert len(part) > 500, f'{term} dump looks truncated ({len(part)} courses)'
            json.dump(part, open(out, 'w'))
            time.sleep(1)
        print(f'{term}: {len(part)} courses')
        catalog = merge(catalog, part)
    for e in catalog.values():
        e['terms_seen'] = sorted(set(e['terms_seen']))
    json.dump(catalog, open(RAW, 'w'), indent=1)
    depts = len({e['dept'] for e in catalog.values()})
    print(f'merged catalog: {len(catalog)} courses across {depts} departments -> {RAW}')

if __name__ == '__main__':
    main()
