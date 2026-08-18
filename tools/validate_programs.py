#!/usr/bin/env python3
"""Data linter: makes bulk requirement entry safe.

Checks src/data/*.json for:
  - every course code referenced by an ACTIVE program / equivalency group /
    policy exists in the course catalog (missing -> ERROR; placeholders skipped)
  - rule shapes are well-formed (known type, sane n, non-empty lists)
  - ACTIVE programs carry sourceUrl + sourcedOn + at least one group
  - groups without a sourceQuote (verbatim sentence from the official page)
    get a WARNING - new entries should always include one
  - course prereq references resolve to catalog courses or level:<tag> entries
    with a matching equivalency group
  - duplicate program ids

Exit code 1 if any ERROR. Run after every data edit:
  python3 tools/build_data.py && python3 tools/validate_programs.py
"""
import json, os, re, sys

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'data')
courses = json.load(open(os.path.join(D, 'courses.json')))
programs = json.load(open(os.path.join(D, 'programs.json')))
clusters = json.load(open(os.path.join(D, 'clusters.json')))
policy = json.load(open(os.path.join(D, 'policy.json')))
eq_groups = json.load(open(os.path.join(D, 'equivalency_groups.json')))

errors, warnings = [], []
E = lambda m: errors.append(m)
W = lambda m: warnings.append(m)

CODE = re.compile(r'^[A-Z0-9]{2,5} \d{3}[A-Z]{0,2}$')
RULE_TYPES = {'all_of', 'n_of', 'sequence_one_of', 'n_from_filter', 'track_n_of',
              'breadth_outside_track'}
level_tags = {g['satisfiesPrereqLevel'] for g in eq_groups if g.get('satisfiesPrereqLevel')}

def check_code(code, where):
    if not CODE.match(code):
        E(f'{where}: malformed course code "{code}"')
    elif code not in courses:
        E(f'{where}: course "{code}" not in catalog')
    elif courses[code].get('stub'):
        W(f'{where}: {code} is a stub (never seen in a harvested schedule) — verify it exists')

def check_rule(rule, where):
    t = rule.get('type')
    if t not in RULE_TYPES:
        E(f'{where}: unknown rule type "{t}"'); return
    if t == 'all_of':
        if not rule.get('courses'): E(f'{where}: all_of with empty courses')
        for c in rule.get('courses', []): check_code(c, where)
    elif t == 'n_of':
        opts = rule.get('options', [])
        n = rule.get('n', 0)
        if not opts: E(f'{where}: n_of with no options')
        if not (1 <= n <= len(opts)): E(f'{where}: n_of n={n} vs {len(opts)} options')
        for c in opts: check_code(c, where)
    elif t == 'sequence_one_of':
        seqs = rule.get('sequences', [])
        if not seqs: E(f'{where}: sequence_one_of with no sequences')
        for seq in seqs:
            if not seq: E(f'{where}: empty sequence')
            for c in seq: check_code(c, where)
    elif t == 'n_from_filter':
        f = rule.get('filter', {})
        if rule.get('n', 0) < 1: E(f'{where}: n_from_filter n<1')
        if not f.get('depts'): W(f'{where}: filter without depts (matches everything)')
        for c in f.get('exclude', []) or []: check_code(c, where)
    elif t == 'track_n_of':
        tracks = rule.get('tracks', {})
        if not tracks: E(f'{where}: track_n_of with no tracks')
        for name, codes in tracks.items():
            if not codes: E(f'{where}: empty track "{name}"')
            # track lists come from a scraped index; missing catalog entries
            # are common for retired courses - warn, do not fail
            for c in codes:
                if not CODE.match(c): E(f'{where}: malformed code "{c}" in track {name}')
                elif c not in courses: W(f'{where}: track "{name}" course {c} not in catalog')
    elif t == 'breadth_outside_track':
        if not rule.get('trackGroupId'): E(f'{where}: breadth without trackGroupId')

seen_ids = set()
for p in programs:
    pid = p.get('id', '?')
    if pid in seen_ids: E(f'duplicate program id {pid}')
    seen_ids.add(pid)
    where = f'program {pid}'
    if p.get('status') == 'ACTIVE':
        if not p.get('sourceUrl'): E(f'{where}: ACTIVE without sourceUrl')
        if not p.get('sourcedOn'): E(f'{where}: ACTIVE without sourcedOn')
        if not p.get('requirementGroups'): E(f'{where}: ACTIVE with no requirement groups')
        for g in p.get('requirementGroups', []):
            gw = f'{where} / group {g.get("id","?")}'
            check_rule(g.get('rule', {}), gw)
            if not g.get('sourceQuote') and not g.get('note'):
                W(f'{gw}: no sourceQuote/note (add the verbatim sentence it encodes)')
        ulw = p.get('upperLevelWriting')
        if ulw and ulw.get('rule'): check_rule(ulw['rule'], f'{where} / ULW')
    elif p.get('status') != 'NEEDS_DATA_ENTRY':
        E(f'{where}: unknown status "{p.get("status")}"')
    if not p.get('sourceUrl'): W(f'{where}: no sourceUrl at all')

for g in eq_groups:
    where = f'equivalency {g.get("id","?")}'
    if g.get('status') == 'ACTIVE':
        if len(g.get('paths', [])) < 2: E(f'{where}: ACTIVE with fewer than 2 paths')
        if not g.get('sourceUrl'): E(f'{where}: ACTIVE without sourceUrl')
        for p in g.get('paths', []):
            if not p.get('courses'): E(f'{where}: empty path {p.get("id")}')
            for c in p.get('courses', []): check_code(c, f'{where}/{p.get("id")}')
    elif g.get('status') != 'NEEDS_DATA_ENTRY':
        E(f'{where}: unknown status')

for combo in policy['pwr']['satisfiedBy']:
    for c in combo: check_code(c, 'policy.pwr')
for c in policy['overlapExemptCourses']:
    if not CODE.match(c): E(f'policy.exempt: malformed "{c}"')
    elif c not in courses: W(f'policy.exempt: {c} not in catalog (kept: list is policy, not schedule)')

for code, c in courses.items():
    for grp in c.get('prereqs', []) or []:
        for entry in grp:
            if entry.startswith('level:'):
                if entry[6:] not in level_tags:
                    E(f'course {code}: prereq level tag "{entry}" has no equivalency group')
            elif not CODE.match(entry):
                E(f'course {code}: malformed prereq "{entry}"')
            elif entry not in courses:
                W(f'course {code}: prereq {entry} not in catalog')

print(f'validate_programs: {len(errors)} errors, {len(warnings)} warnings')
for m in errors: print('  ERROR:', m)
shown = warnings[:25]
for m in shown: print('  warn :', m)
if len(warnings) > 25: print(f'  ... and {len(warnings) - 25} more warnings')
sys.exit(1 if errors else 0)
