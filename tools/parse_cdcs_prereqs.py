#!/usr/bin/env python3
"""Pull structured prerequisites out of CDCS listings.

CDCS has no dedicated Prerequisites form field. Required courses show up in:
  - Public Notes  ("Prerequisites: CSC 172 and MATH 150") — most reliable
  - Description   (often a second paragraph after the blurb)
  - Restrictions  (usually permission/major locks, rarely codes)

This module turns those mentions into the planner's CNF shape: a list of
OR-groups (every group must be satisfied; any member of a group will do).

Conservative by design:
  - only course codes, never "one prior PHIL course" or instructor permission
  - skip "no prerequisites", "not a prerequisite", "suggested", "recommended"
  - skip "this course is a prerequisite for X" (the other direction)
  - drop the course's own code (FREN 204 mentioning FREN 204)
  - drop codes listed as "may be taken concurrently" (coreq, not prior-semester)
  - labeled "Prerequisite:" clauses with only codes are marked verified
  - other extracted codes (builds on, must complete) are unverified

Used by tools/build_data.py. Run standalone to dump a report:
  python3 tools/parse_cdcs_prereqs.py
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, '..', 'data-src', 'ur-catalog-raw.json')

# Historical CDCS department tokens → current catalog departments.
DEPT_ALIAS = {
    'MTH': 'MATH', 'CHM': 'CHEM', 'BIO': 'BIOL', 'PSC': 'PSCI',
    'BCS': 'BCSC', 'PHY': 'PHYS', 'ECO': 'ECON', 'PSY': 'PSYC',
    'JPN': 'JPNS', 'POR': 'PORT', 'LIN': 'LING', 'CAS': 'CASC',
    'ENG': 'ENGL', 'STT': 'STAT', 'HIS': 'HIST',
}

CODE_RE = re.compile(r'\b([A-Z]{2,5})\s?(\d{3}[A-Z]{0,2})\b')
TOKEN_RE = re.compile(
    r'\b([A-Z]{2,5})\s?(\d{3}[A-Z]{0,2})\b|(?<![A-Z0-9])(\d{3}[A-Z]{0,2})\b')
CLAUSE_STOP_RE = re.compile(
    r'(?:(?<=[a-z0-9)])\.\s+(?=[A-Z])|'
    r'\bYou must register\b|\bYOU MUST REGISTER\b|\bNOTE:|\bClass Info:|'
    r'\bThis course cannot\b|'
    r'\bStudents (?:can|should|who|completing|taking)\b|'
    r'\*\*)',
    re.I)
HS_PLACEMENT_RE = re.compile(
    r'precalculus course in high school|\bin high school\b|high[- ]school precalculus',
    re.I)
CALC1 = ['MATH 141', 'MATH 161', 'MATH 171']
NEGATION_RE = re.compile(
    r'\bno prerequisites?\b|\bnot a prerequisite\b|\bis not a prerequisite\b|'
    r'\bwithout prerequisites?\b|\bthere are no prerequisites?\b',
    re.I)
# "this course serves as a prerequisite for PSCI 405" is the opposite direction.
FORWARD_RE = re.compile(
    r'serves as a prerequisite for|is a prerequisite for|prerequisite for the',
    re.I)
LABELED_RE = re.compile(
    r'(?:^|[.!\]]\s*)((?:suggested\s+)?prerequisites?(?:\(s\))?'
    r'(?:\s+will\s+be\s+strictly\s+enforced)?\s*[:.\-–]\s*)(.{0,350})',
    re.I)
BUILDS_ON_RE = re.compile(
    r'builds on (?:the )?foundations established in ([A-Z]{2,5}\s?\d{3}[A-Z]{0,2})',
    re.I)
RECOMMEND_RE = re.compile(r'\brecommend|\bhelpful but not required\b', re.I)
COREQ_RE = re.compile(
    r'([A-Z]{2,5}\s?\d{3}[A-Z]{0,2})\s*\(?\s*'
    r'(?:may be (?:a )?co-?requisite|can be concurrent|may be concurrent)',
    re.I)
MUST_TAKE_RE = re.compile(
    r'(?:must (?:have )?(?:complete|take|finish)(?:d)?|successful completion of|'
    r'equivalent proficiency level with)\s+'
    r'((?:[A-Z]{2,5}\s?\d{3}[A-Z]{0,2})(?:\s+and\s+[A-Z]{2,5}\s?\d{3}[A-Z]{0,2})*)',
    re.I)
CONCURRENT_RE = re.compile(
    r'(?:may |can )?(?:also )?be taken concurrently with\s+(.{0,80})',
    re.I)


def normalize_code(dept, num, catalog_codes=None):
    dept = DEPT_ALIAS.get(dept, dept)
    code = f'{dept} {num}'
    if catalog_codes is None:
        return code
    if code in catalog_codes:
        return code
    # Lab/writing twin only — never a P (project) section of a different course.
    for alt in (f'{dept} {num}L', f'{dept} {num}W'):
        if alt in catalog_codes:
            return alt
    orig_dept = next((k for k, v in DEPT_ALIAS.items() if v == dept), None)
    if orig_dept:
        orig = f'{orig_dept} {num}'
        if orig in catalog_codes:
            return orig
    return None  # not in catalog — drop rather than invent a stub


def codes_in(text, self_code, catalog_codes=None):
    out, seen = [], set()
    last_dept = None
    for m in TOKEN_RE.finditer(text or ''):
        if m.group(1):
            last_dept, num = m.group(1), m.group(2)
        elif last_dept:
            num = m.group(3)
        else:
            continue
        code = normalize_code(last_dept, num, catalog_codes)
        if not code or code == self_code or code in seen:
            continue
        seen.add(code)
        out.append(code)
    return out


def clip_labeled_clause(clause):
    """Keep the prereq list; drop recitation/policy sentences that follow."""
    m = CLAUSE_STOP_RE.search(clause or '')
    if m:
        clause = clause[:m.start()]
    return (clause or '').strip(' .;:')


def expand_calc1_equivalent(window, codes, catalog_codes=None):
    if not re.search(r'\bor equivalent\b', window or '', re.I):
        return codes
    if not any(c in CALC1 for c in codes):
        return codes
    out = list(codes)
    for c in CALC1:
        if c in out:
            continue
        if catalog_codes is None or c in catalog_codes:
            out.append(c)
    return out


def strip_recommended(text):
    """Drop '; CSC 173 STRONGLY Recommended' tails so they are not required."""
    prefix = re.split(r'\brecommend', text, maxsplit=1, flags=re.I)[0]
    prefix = re.sub(r'[;.][^;.]*\bstrongly\s*$', '', prefix, flags=re.I)
    prefix = re.sub(r'\bstrongly\s*$', '', prefix, flags=re.I)
    parts = re.split(r'[;.]', prefix)
    keep = []
    for p in parts:
        if not p.strip() or RECOMMEND_RE.search(p):
            continue
        keep.append(p.strip())
    return '. '.join(keep)


def split_top_level_commas(text):
    parts, buf, depth = [], [], 0
    for ch in text or '':
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth = max(0, depth - 1)
        if ch == ',' and depth == 0:
            parts.append(''.join(buf).strip())
            buf = []
        else:
            buf.append(ch)
    if buf:
        parts.append(''.join(buf).strip())
    return [p for p in parts if p]


def concurrent_codes(text, self_code, catalog_codes=None):
    skip = set()
    for m in CONCURRENT_RE.finditer(text or ''):
        chunk = re.split(r'\s+if\s+|[.;]', m.group(1), maxsplit=1)[0]
        skip.update(codes_in(chunk, self_code, catalog_codes))
    for m in COREQ_RE.finditer(text or ''):
        skip.update(codes_in(m.group(1), self_code, catalog_codes))
    return skip


def to_cnf(window, codes):
    """AND of OR-groups from a clause that names `codes` in order."""
    if not codes:
        return []
    if len(codes) == 1:
        return [[codes[0]]]
    # "CSC 172, Calculus 1 (MATH 141, MATH 161 or MATH 171)" — commas
    # outside parens are AND; "or" inside a part is OR.
    top = split_top_level_commas(window)
    if len(top) > 1:
        # "MATH 143, 162, or MATH 172" is one OR group, not AND.
        if any(re.match(r'or\b', p.strip(), re.I) for p in top):
            return [list(codes)]
        groups = []
        for part in top:
            compact = part.upper().replace(' ', '')
            pcodes = [c for c in codes if c.replace(' ', '') in compact]
            if not pcodes:
                continue
            if re.search(r'\bor\b', part, re.I):
                groups.append(pcodes)
            else:
                groups.extend([[c] for c in pcodes])
        if groups:
            return groups
    low = window.lower()
    has_and = bool(re.search(r'\band\b|&', low))
    has_or = bool(re.search(r'\bor\b', low))
    if has_and and not has_or:
        return [[c] for c in codes]
    if has_or and not has_and:
        return [list(codes)]
    if has_and and has_or:
        # "A and B or C" is ambiguous; split on 'and' then 'or' inside each arm.
        arms = re.split(r'\band\b|&', window, flags=re.I)
        groups = []
        for arm in arms:
            arm_codes = [c for c in codes if c.split()[0] in arm.upper() or c.replace(' ', '') in arm.upper().replace(' ', '')]
            if not arm_codes:
                continue
            groups.append(arm_codes)
        if groups:
            return groups
    # Juxtaposed list with no conjunction: treat as AND (CSC 172, MATH 150).
    return [[c] for c in codes]


def entry_text(entry):
    """Public Notes first — that is where CDCS actually puts Prerequisites:."""
    parts = []
    for key in ('public_notes', 'desc', 'restrictions'):
        val = (entry.get(key) or '').strip()
        if val and val not in parts:
            parts.append(val)
    return '\n'.join(parts)


def parse_description(desc, course_id, catalog_codes=None):
    """Return {prereqs, verified, note, quote} or None."""
    if not desc:
        return None
    if NEGATION_RE.search(desc) and not LABELED_RE.search(desc):
        return None
    if FORWARD_RE.search(desc) and not LABELED_RE.search(desc):
        return None

    labeled = LABELED_RE.search(desc)
    if labeled and re.match(r'suggested', labeled.group(1), re.I):
        labeled = None  # "Suggested prerequisites: CAS 170" is not required

    windows = []
    verified = False
    if labeled:
        window = clip_labeled_clause(strip_recommended(labeled.group(2)))
        if window and not HS_PLACEMENT_RE.search(window):
            windows.append(('labeled', window))
            verified = bool(codes_in(window, course_id, catalog_codes))

    if not windows:
        for rx in (BUILDS_ON_RE, MUST_TAKE_RE):
            for m in rx.finditer(desc):
                windows.append(('inferred', m.group(0)))

    if not windows:
        return None

    skip = concurrent_codes(desc, course_id, catalog_codes)
    groups, quotes = [], []
    seen_group = set()
    for kind, window in windows:
        codes = codes_in(window, course_id, catalog_codes)
        if kind == 'labeled':
            codes = expand_calc1_equivalent(window, codes, catalog_codes)
        if not codes:
            continue
        quotes.append(window.strip()[:180])
        cnf_window = window
        if kind == 'labeled' and re.search(r'\bor equivalent\b', window, re.I):
            cnf_window = window if re.search(r'\bor\b', window, re.I) else (window + ' or equivalent')
        for g in to_cnf(cnf_window, codes):
            # Drop a concurrent course only when it is a standalone AND
            # requirement (CSC 172 + MATH 150 coreq). Keep it when it is
            # one alternative in an OR group (PHYS 113: 141 or 161 or 171).
            g = [c for c in g if c not in skip or len(g) > 1]
            if not g:
                continue
            key = tuple(g)
            if key in seen_group:
                continue
            seen_group.add(key)
            groups.append(g)

    if not groups:
        return None

    note = 'Extracted from CDCS Public Notes / course description.'
    if not verified:
        note += ' Not a labeled Prerequisite field — confirm with the department.'
    return {
        'prereqs': groups,
        'verified': verified,
        'note': note,
        'source': 'CDCS (Registrar) Public Notes / description, Fall 2025–Fall 2026',
        'quote': ' | '.join(quotes)[:240],
    }


def parse_catalog(catalog):
    codes = set(catalog)
    out = {}
    for cid, e in catalog.items():
        # Public Notes are the registrar's section-level prereq line and win
        # over a copied description blurb (DSCC 242 vs CSC 242).
        parsed = None
        notes = parse_description(e.get('public_notes') or '', cid, codes)
        if notes and notes['verified']:
            parsed = notes
        else:
            parsed = parse_description(e.get('desc') or '', cid, codes) or notes
            if not parsed:
                parsed = parse_description(e.get('restrictions') or '', cid, codes)
        if parsed:
            out[cid] = parsed
    return out


def _self_test():
    cat = {
        'CSC 171': {}, 'CSC 172': {}, 'MATH 150': {}, 'CSC 173': {}, 'FREN 200': {},
        'CHEM 131': {}, 'MUSC 111': {}, 'MUSC 112': {}, 'GBA 412': {}, 'GBA 462P': {},
        'MATH 161': {},
    }
    d = parse_description(
        'Prerequisites: CSC 172 and MTH 150; CSC 173 STRONGLY Recommended.',
        'DSCC 242', set(cat) | {'DSCC 242'})
    assert d['prereqs'] == [['CSC 172'], ['MATH 150']], d
    assert d['verified'] is True
    d = parse_description(
        'PREREQUISITE: YOU MUST TAKE FREN 200 BEFORE REGISTERING FOR FREN 204.',
        'FREN 204', set(cat) | {'FREN 204'})
    assert d['prereqs'] == [['FREN 200']], d
    d = parse_description(
        'CHEM 132 builds on the foundations established in CHEM 131, with an emphasis on rates.',
        'CHEM 132', set(cat) | {'CHEM 132'})
    assert d['prereqs'] == [['CHEM 131']] and d['verified'] is False, d
    d = parse_description(
        'This course has no prerequisites and is open to all students.',
        'CSC 160', set(cat) | {'CSC 160'})
    assert d is None
    d = parse_description(
        'Permission of instructor required and successful completion of MUSC 111 and MUSC 112.',
        'MUSC 116', set(cat) | {'MUSC 116'})
    assert d['prereqs'] == [['MUSC 111'], ['MUSC 112']], d
    d = parse_description(
        'Prerequisite: GBA 412 or GBA 462',
        'CIS 417', set(cat) | {'CIS 417'})
    assert d['prereqs'] == [['GBA 412']], d  # GBA 462 not in catalog; do not remap to 462P
    d = parse_description(
        'Lab and workshop required. Prerequisites: CSC 171 or equivalent, MATH 150. '
        'May be taken concurrently with MATH 150 if CSC 171 prerequisite is satisfied.',
        'CSC 172', set(cat))
    assert d['prereqs'] == [['CSC 171']], d  # MATH 150 is a coreq, not a prior-semester prereq
    d = parse_description(
        'Prerequisites will be strictly enforced: CSC171, CSC 172 and MATH 161',
        'CSC 240', set(cat) | {'CSC 240'})
    assert d['prereqs'] == [['CSC 171'], ['CSC 172'], ['MATH 161']], d
    d = parse_description(
        'Prerequisites: PHYS 122, MATH 162, BME 201P, MATH 165 may be a co-requisite',
        'BME 210', set(cat) | {'BME 210', 'PHYS 122', 'MATH 162', 'BME 201P', 'MATH 165'})
    assert ['MATH 165'] not in d['prereqs'] and 'MATH 165' not in sum(d['prereqs'], []), d
    d = parse_description(
        'Prerequisites: MATH 140 or a precalculus course in high school. You must register for a recitation.',
        'MATH 141', set(cat) | {'MATH 141', 'MATH 140'})
    assert d is None, d
    d = parse_description(
        'Prerequisites: MATH 143, 162, or MATH 172. NOTE: MATH 164 is not a prerequisite for MATH 165.',
        'MATH 165', set(cat) | {'MATH 165', 'MATH 143', 'MATH 162', 'MATH 172', 'MATH 164'})
    assert sorted(d['prereqs'][0]) == ['MATH 143', 'MATH 162', 'MATH 172'], d
    d = parse_description(
        'Prerequisite(s): Successful completion of MATH 141 or MATH 161 or MATH 171 with C- or better is required. (MATH 161 or MATH 171 can be taken concurrently)',
        'PHYS 113', set(cat) | {'PHYS 113', 'MATH 141', 'MATH 161', 'MATH 171'})
    assert set(d['prereqs'][0]) == {'MATH 141', 'MATH 161', 'MATH 171'}, d
    d = parse_catalog({
        'CSC 280': {
            'desc': 'Finite-state machines. Prerequisites: CSC 173 Computation and Formal Systems, and MATH 150 Discrete Mathematics',
            'public_notes': '',
        },
        'CSC 173': {}, 'MATH 150': {},
    })
    assert d['CSC 280']['prereqs'] == [['CSC 173'], ['MATH 150']], d
    d = parse_catalog({
        'DSCC 242': {
            'desc': 'Prerequisites: CSC 172 and MTH 150; CSC 173 STRONGLY Recommended.',
            'public_notes': 'Prerequisites: CSC 172, Calculus 1 (MATH 141, MATH 161 or MATH 171) Recommended: Calculus 2',
        },
        'CSC 172': {}, 'MATH 150': {}, 'MATH 141': {}, 'MATH 161': {}, 'MATH 171': {},
    })
    assert d['DSCC 242']['prereqs'] == [['CSC 172'], ['MATH 141', 'MATH 161', 'MATH 171']], d
    print('parse_cdcs_prereqs self-test ok')


def main():
    _self_test()
    catalog = json.load(open(RAW))
    found = parse_catalog(catalog)
    print(f'{len(found)} courses with extracted prereqs (of {len(catalog)})')
    verified = sum(1 for v in found.values() if v['verified'])
    print(f'  labeled/verified: {verified}')
    for cid, v in sorted(found.items()):
        flag = 'V' if v['verified'] else 'u'
        print(f'  [{flag}] {cid}: {v["prereqs"]}  — {v["quote"][:100]}')


if __name__ == '__main__':
    main()
