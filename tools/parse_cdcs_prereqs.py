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
# Entry courses a placement test admits to directly ("MUSC 101, 110 or
# permission of instructor (placement test)"): the listed courses are one way
# in, not a requirement, so a plan may start at the course itself.
HS_PLACEMENT_RE = re.compile(
    r'precalculus course in high school|\bin high school\b|high[- ]school precalculus|'
    r'permission of (?:the )?instructor \(placement test\)',
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
    r'(?:may be (?:a )?co-?requisite|(?:can|may) be (?:taken )?concurrent(?:ly)?)',
    re.I)
MUST_TAKE_RE = re.compile(
    r'(?:must (?:have )?(?:complete|take|finish)(?:d)?|successful completion of|'
    r'equivalent proficiency level with)\s+'
    r'((?:[A-Z]{2,5}\s?\d{3}[A-Z]{0,2})(?:\s+and\s+[A-Z]{2,5}\s?\d{3}[A-Z]{0,2})*)',
    re.I)
CONCURRENT_RE = re.compile(
    r'(?:may |can )?(?:also )?be taken concurrently with\s+(.{0,80})|'
    r'concurrent (?:enrollment|registration) (?:in|with)\s+(.{0,80})',
    re.I)
# Banner's structured line: "Prerequisite(s): Successful completion of the
# following is required: CHE 243 PHYS 113, 113P, 121, 121P or 141 MATH 165".
# Juxtaposed codes are separate requirements; commas inside one requirement
# usually list alternatives, so the generic comma-means-AND rule misreads it.
BANNER_RE = re.compile(r'following is required\s*:?\s*(.*)', re.I | re.S)
BANNER_TOKEN_RE = re.compile(
    r'\b(?-i:([A-Z]{2,5}))\s?(\d{3}[A-Z]{0,2})\b|(?<![A-Z0-9])(\d{3}[A-Z]{0,2})\b|'
    r'(\()|(\))|(,)|(/)|\b(or|and)\b',
    re.I)
CONCURRENT_PAREN_RE = re.compile(
    r'\(([^()]*?)\bcan be (?:taken )?concurrent(?:ly)?(?: registered)?\s*\)|'
    r'\(([^()]*?)\bcan be concurrently registered\s*\)',
    re.I)


def normalize_code(dept, num, catalog_codes=None):
    dept = DEPT_ALIAS.get(dept, dept)
    code = f'{dept} {num}'
    if catalog_codes is None:
        return code
    if code in catalog_codes:
        # Bare "BIO 111" in CDCS notes is the intro sequence. Summer harvests
        # sometimes list a lecture-only code; prefer the fall/spring lab twin
        # so academic-year plans still satisfy the note.
        alt_l = f'{dept} {num}L'
        if isinstance(catalog_codes, dict) and alt_l in catalog_codes:
            terms = set((catalog_codes.get(code) or {}).get('terms_seen') or [])
            alt_terms = set((catalog_codes.get(alt_l) or {}).get('terms_seen') or [])
            if terms <= {'summer'} and (alt_terms & {'fall', 'spring'}):
                return alt_l
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


def codes_in(text, self_code, catalog_codes=None, spans=None):
    """Codes named in text, in order. `spans`, if given, collects each
    code's character offsets so callers can tell which clause named it
    (\"BIO 110 or 112\" names BIOL 110 and BIOL 112 without spelling either)."""
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
        if not code or code == self_code:
            continue
        if spans is not None:
            spans.setdefault(code, []).append(m.start())
        if code in seen:
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


# "MTH 165 (concurrently)": a corequisite flagged right after the code.
CONCURRENT_SUFFIX_RE = re.compile(
    r'([A-Z]{2,5}\s*\d{3}[A-Z]{0,2})\s*\((?:may be taken |taken |or )?concurrent(?:ly)?\)', re.I)


def concurrent_codes(text, self_code, catalog_codes=None):
    skip = set()
    for m in CONCURRENT_SUFFIX_RE.finditer(text or ''):
        skip.update(codes_in(m.group(1), self_code, catalog_codes))
    for m in CONCURRENT_RE.finditer(text or ''):
        chunk = re.split(r'\s+if\s+|[.;]', m.group(1) or m.group(2), maxsplit=1)[0]
        skip.update(codes_in(chunk, self_code, catalog_codes))
    for m in COREQ_RE.finditer(text or ''):
        skip.update(codes_in(m.group(1), self_code, catalog_codes))
    return skip


# a parenthesized clause holding a course number and its own and/or
NESTED_LOGIC_RE = re.compile(
    r'\([^()]*\d{3}[^()]*\b(?:and|or)\b[^()]*\)|\([^()]*\b(?:and|or)\b[^()]*\d{3}[^()]*\)',
    re.I)


def _codes_within(text, start, end, codes, spans):
    """Codes named between window offsets start and end."""
    part = text[start:end]
    compact = part.upper().replace(' ', '')
    out = []
    for c in codes:
        pos = (spans or {}).get(c)
        if pos is not None:
            if any(start <= x < end for x in pos):
                out.append(c)
        elif c.replace(' ', '') in compact:
            out.append(c)
    return out


def _part_offsets(window, parts):
    offs, at = [], 0
    for part in parts:
        i = window.find(part, at)
        if i < 0:
            i = at
        offs.append((i, i + len(part)))
        at = i + len(part)
    return offs


def to_cnf(window, codes, spans=None):
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
        # "MATH 172, MATH 200 or MATH 235": a list of single codes whose last
        # item is "X or Y" is one OR group ("CHEM 131, CHEM 132 or
        # equivalent" stays a sequence).
        offs = _part_offsets(window, top)
        per_part = [_codes_within(window, a, b, codes, spans) for a, b in offs]
        if (all(len(pc) == 1 for pc in per_part[:-1]) and per_part[-1] and
                re.match(r'(?:[A-Z]{2,5}\s?)?\d{3}[A-Z]{0,2}\s+or\s+(?:[A-Z]{2,5}\s?)?\d{3}',
                         top[-1].strip(), re.I) and
                not any(re.search(r'\b(?:and|or)\b', p, re.I) for p in top[:-1])):
            return [list(codes)]
        groups = []
        for part, (a, b) in zip(top, _part_offsets(window, top)):
            pcodes = _codes_within(window, a, b, codes, spans)
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
    if has_and and has_or and NESTED_LOGIC_RE.search(window):
        # "(MATH 173) or (MATH 164 and MATH 235)": alternatives of
        # conjunctions do not fit one CNF row; one OR group never blocks a
        # valid plan.
        return [list(codes)]
    if has_and and has_or:
        # "A and B or C" is ambiguous; split on 'and' then 'or' inside each arm.
        cuts = [0] + [x for m in re.finditer(r'\band\b|&', window, flags=re.I)
                      for x in (m.start(), m.end())] + [len(window)]
        groups = []
        for a, b in zip(cuts[::2], cuts[1::2]):
            arm_codes = _codes_within(window, a, b, codes, spans)
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


def _banner_tokens(text, self_code, catalog_codes):
    toks, last_dept = [], None
    for m in BANNER_TOKEN_RE.finditer(text):
        if m.group(1) or m.group(3):
            explicit = bool(m.group(1))
            if explicit:
                last_dept, num = m.group(1).upper(), m.group(2)
            elif last_dept:
                num = m.group(3)
            else:
                continue
            code = normalize_code(last_dept, num, catalog_codes)
            # keep a placeholder for unknown or self codes so juxtaposition
            # boundaries still fall in the right place
            toks.append(('code', None if code == self_code else code, explicit))
        elif m.group(4):
            toks.append(('(',))
        elif m.group(5):
            toks.append((')',))
        elif m.group(6):
            toks.append(('op', ','))
        elif m.group(7):
            toks.append(('op', 'or'))
        else:
            toks.append(('op', m.group(8).lower()))
    return toks


def _banner_segments(toks):
    """Split where a requirement ends and the next begins with no operator."""
    segs, cur, depth = [], [], 0
    for t in toks:
        starts = t[0] == '(' or (t[0] == 'code' and t[2])
        if cur and depth == 0 and starts and cur[-1][0] in ('code', ')'):
            segs.append(cur)
            cur = []
        if t[0] == '(':
            depth += 1
        elif t[0] == ')':
            depth = max(0, depth - 1)
        cur.append(t)
    if cur:
        segs.append(cur)
    return segs


def _strip_parens(toks):
    while len(toks) >= 2 and toks[0][0] == '(' and toks[-1][0] == ')':
        depth = 0
        for i, t in enumerate(toks):
            depth += t[0] == '('
            depth -= t[0] == ')'
            if depth == 0 and i < len(toks) - 1:
                return toks
        toks = toks[1:-1]
    return toks


def _segment_cnf(toks):
    toks = _strip_parens(toks)
    codes = [t[1] for t in toks if t[0] == 'code' and t[1]]
    if not codes:
        return []
    depth, top_ops = 0, set()
    for t in toks:
        if t[0] == '(':
            depth += 1
        elif t[0] == ')':
            depth -= 1
        elif t[0] == 'op' and depth == 0:
            top_ops.add(t[1])
    if 'and' in top_ops and 'or' not in top_ops:
        groups, part, depth = [], [], 0
        for t in toks + [('op', 'and')]:
            if t[0] == '(':
                depth += 1
            elif t[0] == ')':
                depth -= 1
            if t[0] == 'op' and t[1] in ('and', ',') and depth == 0:
                groups.extend(_segment_cnf(part))
                part = []
            else:
                part.append(t)
        return groups
    if 'or' in top_ops:
        # "A or B, C or D, E" lists alternative sequences that a CNF cannot
        # state faithfully; one OR group never blocks a valid plan.
        return [list(dict.fromkeys(codes))]
    return [[c] for c in dict.fromkeys(codes)]


def parse_banner(text, course_id, catalog_codes=None):
    """CNF for Banner's 'Successful completion of the following is required'."""
    m = BANNER_RE.search(text or '')
    if not m:
        return None
    body = m.group(1).split(' | ')[0]
    body = re.split(r'\bNot open to\b', body, maxsplit=1, flags=re.I)[0]
    body = re.sub(r'\bwith an? [A-F][+-]? or better\b', ' ', body, flags=re.I)
    # "(MATH 281 can be taken concurrently)" names the coreqs; a bare
    # "(can be taken concurrently)" applies to the requirement just before it.
    conc_codes, conc_marks = set(), []
    def mark(mm):
        inner = mm.group(1) if mm.group(1) is not None else (mm.group(2) or '')
        named = codes_in(inner, course_id, catalog_codes)
        if named:
            conc_codes.update(named)
            return ' '
        conc_marks.append(True)
        return ' \u2020 '
    body = CONCURRENT_PAREN_RE.sub(mark, body)
    pieces = body.split('\u2020')
    groups = []
    for i, piece in enumerate(pieces):
        segs = _banner_segments(_banner_tokens(piece, course_id, catalog_codes))
        for j, seg in enumerate(segs):
            concurrent_tail = i < len(pieces) - 1 and j == len(segs) - 1
            if concurrent_tail:
                continue
            for g in _segment_cnf(seg):
                if all(c in conc_codes for c in g):
                    continue
                if g not in groups:
                    groups.append(g)
    if not groups:
        return None
    return {
        'prereqs': groups,
        'verified': True,
        'note': 'Extracted from the CDCS registration prerequisite line.',
        'source': 'CDCS (Registrar) Public Notes / description, Fall 2025–Fall 2026',
        'quote': m.group(0).strip()[:240],
    }


def parse_description(desc, course_id, catalog_codes=None):
    """Return {prereqs, verified, note, quote} or None."""
    if not desc:
        return None
    banner = parse_banner(desc, course_id, catalog_codes)
    if banner:
        return banner
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
        spans = {}
        codes = codes_in(window, course_id, catalog_codes, spans)
        if kind == 'labeled':
            codes = expand_calc1_equivalent(window, codes, catalog_codes)
        if not codes:
            continue
        quotes.append(window.strip()[:180])
        cnf_window = window
        if kind == 'labeled' and re.search(r'\bor equivalent\b', window, re.I):
            cnf_window = window if re.search(r'\bor\b', window, re.I) else (window + ' or equivalent')
        for g in to_cnf(cnf_window, codes, spans):
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
    out = {}
    for cid, e in catalog.items():
        # Public Notes are the registrar's section-level prereq line and win
        # over a copied description blurb (DSCC 242 vs CSC 242).
        parsed = None
        notes = parse_description(e.get('public_notes') or '', cid, catalog)
        if notes and notes['verified']:
            parsed = notes
        else:
            parsed = parse_description(e.get('desc') or '', cid, catalog) or notes
            if not parsed:
                parsed = parse_description(e.get('restrictions') or '', cid, catalog)
        if parsed:
            out[cid] = widen_with_banner(parsed, e, cid, catalog)
    return out


def widen_with_banner(parsed, entry, cid, catalog):
    """Add the alternatives Banner's registration line lists to the matching
    Public Notes requirement: notes say "PHY 113, MTH 143" for CHEM 252, and
    Banner accepts PHYS 121/141 and MATH 162/172 for the same slots. Notes
    keep the structure, since they sometimes accept more than Banner does
    (PHYS 113 for PHYS 122)."""
    banner = None
    for key in ('restrictions', 'public_notes', 'desc'):
        banner = parse_banner(entry.get(key) or '', cid, catalog)
        if banner:
            break
    if not banner or banner is parsed or parsed['note'] == banner['note']:
        return parsed
    groups = []
    for g in parsed['prereqs']:
        ng = list(g)
        for bg in banner['prereqs']:
            if any(c in ng for c in bg):
                ng.extend(c for c in bg if c not in ng)
        groups.append(ng)
    return {**parsed, 'prereqs': groups}


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
        'Prerequisites: CSC 171, MTH 161 and CSC 172 (concurrently)',
        'CSC 200', set(cat) | {'CSC 200'})
    assert d['prereqs'] == [['CSC 171'], ['MATH 161']], d  # (concurrently) = corequisite
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
    d = parse_catalog({
        'BIOL 190': {
            'public_notes': 'Prerequisites: BIO 110/111.',
            'terms_seen': ['fall'],
        },
        'BIOL 110': {'terms_seen': ['fall']},
        'BIOL 111': {'terms_seen': ['summer']},
        'BIOL 111L': {'terms_seen': ['spring']},
    })
    assert d['BIOL 190']['prereqs'] == [['BIOL 110'], ['BIOL 111L']], d
    phys = {c: {} for c in ['PHYS 113', 'PHYS 114', 'PHYS 121', 'PHYS 122', 'PHYS 123',
                            'PHYS 141', 'PHYS 142', 'PHYS 143', 'MATH 281', 'CHE 243',
                            'PHYS 113P', 'PHYS 121P', 'MATH 165', 'CHEM 132', 'MATH 161',
                            'MATH 142', 'MATH 171', 'MATH 143', 'MATH 162', 'MATH 172']}
    # Banner line: alternative sequences collapse to one OR group, and the
    # "(can be taken concurrently)" requirement before it is a coreq.
    d = parse_description(
        'Prerequisite(s): Successful completion of the following is required: PHYS 113 or '
        'PHYS 121, PHYS 114 or 122, 123 or PHYS 141, 142, 143 MATH 281 (can be taken concurrently)',
        'PHYS 217', set(phys) | {'PHYS 217'})
    assert d['prereqs'] == [['PHYS 113', 'PHYS 121', 'PHYS 114', 'PHYS 122', 'PHYS 123',
                             'PHYS 141', 'PHYS 142', 'PHYS 143']], d
    # juxtaposed codes are separate requirements; commas inside one list OR
    d = parse_description(
        'Prerequisite(s): Successful completion of the following is required: CHE 243 '
        'PHYS 113, 113P, 121, 121P or 141 MATH 165',
        'CHE 244', set(phys) | {'CHE 244'})
    assert d['prereqs'] == [['CHE 243'], ['PHYS 113', 'PHYS 113P', 'PHYS 121', 'PHYS 121P', 'PHYS 141'],
                            ['MATH 165']], d
    d = parse_description(
        'Prerequisite(s): Successful completion of the following is required: CHEM 132 '
        '(MATH 161, MATH 142 OR MATH 171) AND (MATH 143, MATH 162 OR MATH 172) PHYS 113, '
        'PHYS 113P, PHYS 121, PHYS 121P OR PHYS 141 (Can be concurrently registered)',
        'CHE 113', set(phys) | {'CHE 113'})
    assert d['prereqs'] == [['CHEM 132'], ['MATH 161', 'MATH 142', 'MATH 171'],
                            ['MATH 143', 'MATH 162', 'MATH 172']], d
    # "completion or concurrent enrollment" is a coreq
    d = parse_description(
        'Prerequisites: Completion or concurrent enrollment in CHEM 131 or equivalent.',
        'BIOL 110L', set(cat) | {'BIOL 110L'})
    assert d is None, d
    # department carried onto bare numbers when assigning codes to clauses
    d = parse_catalog({
        'BIOL 210': {'public_notes': 'Prerequisites: BIO 110 or 112 and BIO 111 or 113.'},
        'BIOL 110': {}, 'BIOL 112': {}, 'BIOL 111': {}, 'BIOL 113': {},
    })
    assert d['BIOL 210']['prereqs'] == [['BIOL 110', 'BIOL 112'], ['BIOL 111', 'BIOL 113']], d
    # Banner alternatives widen a terse Public Notes requirement
    d = parse_catalog({
        'CHEM 252': {
            'public_notes': 'Prerequisites: first semester physics - PHY 113, Calculus - MTH143.',
            'restrictions': 'Prerequisite(s): Successful completion of the following is required : '
                            'PHYS 113 OR PHYS 121 OR PHYS 141 with a C- or better MATH 143 OR MATH 162',
        },
        **phys,
    })
    assert d['CHEM 252']['prereqs'] == [['PHYS 113', 'PHYS 121', 'PHYS 141'], ['MATH 143', 'MATH 162']], d
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
