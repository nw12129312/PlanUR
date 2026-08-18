#!/usr/bin/env python3
"""Coverage report: which programs are fully encoded (ACTIVE) vs awaiting
data entry, and whether their requirement pages are already snapshotted in
data-src/pages/. Writes data-src/COVERAGE.md and prints a summary."""
import json, os
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(HERE, '..', 'src', 'data')
PAGES = os.path.join(HERE, '..', 'data-src', 'pages')

programs = json.load(open(os.path.join(D, 'programs.json')))
meta = json.load(open(os.path.join(D, 'meta.json')))

manifest = []
mpath = os.path.join(PAGES, 'manifest.json')
if os.path.exists(mpath):
    manifest = json.load(open(mpath))
pages_by_dept = {}
for m in manifest:
    pages_by_dept.setdefault(m['dept'], []).append(m)

# program -> likely snapshot dept slug (site roots use SAS/Hajim slugs)
SLUG_HINTS = {
    'csc': 'csc', 'bio': 'bio', 'psc': 'psc', 'econ': 'eco', 'math': 'mth',
    'phys': 'pas', 'chem': 'chm', 'engl': 'eng', 'hist': 'his', 'phil': 'phl',
    'psyc': 'psy', 'bcsc': 'bcs', 'anth': 'ant', 'eesc': 'ees', 'ir': 'psc',
    'ppe': 'psc', 'ame': 'ame', 'bme': 'bme', 'che': 'che', 'ece': 'ece',
    'me': 'me', 'opt': 'optics', 'opte': 'optics', 'dsc': 'dsc', 'geo': 'ees',
    'eas': 'me', 'hls': 'ph', 'ipa': 'psc',
}

def slug_for(program_id):
    if program_id.startswith('biol-'):
        return 'bio'
    core = program_id.split('-')[1] if '-' in program_id else program_id
    return SLUG_HINTS.get(core)

rows = []
for p in sorted(programs, key=lambda x: (x['status'] != 'ACTIVE', x['type'], x['name'])):
    slug = slug_for(p['id'])
    n_pages = len(pages_by_dept.get(slug, [])) if slug else 0
    rows.append((p['id'], f"{p['name']} ({p['degree']})", p['type'], p['status'],
                 f'{n_pages} pages ({slug})' if slug else 'no snapshot dir'))

active = sum(1 for p in programs if p['status'] == 'ACTIVE')
lines = [
    f'# Program data coverage — {date.today()}',
    '',
    f"**{active} / {len(programs)} programs ACTIVE** · catalog: {meta['counts']['courses']} courses "
    f"({meta['counts']['stubCourses']} stubs) · {len(manifest)} requirement pages snapshotted across "
    f'{len(pages_by_dept)} departments',
    '',
    '| Program | Type | Status | Snapshots |',
    '|---|---|---|---|',
]
for _, name, typ, status, snap in rows:
    lines.append(f'| {name} | {typ} | {status} | {snap} |')
lines += [
    '',
    'Workflow to activate a program: read its snapshot in `data-src/pages/`, encode it in',
    '`tools/build_data.py` (template: `data-src/TEMPLATE.program.json`, with `sourceQuote`',
    'per group), then `python3 tools/build_data.py && python3 tools/validate_programs.py`',
    '&& `npm test`.',
]
out = os.path.join(HERE, '..', 'data-src', 'COVERAGE.md')
open(out, 'w').write('\n'.join(lines) + '\n')
print(f'{active}/{len(programs)} ACTIVE · {len(manifest)} pages in {len(pages_by_dept)} dept dirs · wrote data-src/COVERAGE.md')
