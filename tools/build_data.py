#!/usr/bin/env python3
"""Build src/data/*.json from raw sourced data in data-src/.

Raw inputs (provenance):
  ur-catalog-raw.json   - parsed from CDCS (cdcs.ur.rochester.edu), the Registrar's
                          official course description system, Fall 2025 + Spring 2026
                          + Fall 2026 (Public Notes harvested for prerequisites).
  clusters-parsed.json  - parsed from the official Cluster Search Engine PDF
                          "Cluster Offerings by Department [2025-2026]"
                          (secure1.rochester.edu/registrar/CSE/).
  psc-tracks.json       - parsed from sas.rochester.edu/psc/courses/tracks.php.

Everything that could NOT be confirmed from an official page carries a
verified:false flag and, where useful, a note. Nothing is invented.
"""
import json, re, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
from parse_cdcs_prereqs import parse_catalog

SRC = os.path.join(HERE, '..', 'data-src')
OUT = os.path.join(HERE, '..', 'src', 'data')
FETCH_DATE = '2026-07-03'

URLS = {
    'cs_bs': 'https://www.cs.rochester.edu/undergraduate/bs-requirements.html',
    'cs_minor': 'https://www.cs.rochester.edu/undergraduate/minor-clusters.html',
    'bio_ba': 'https://www.sas.rochester.edu/bio/undergraduate/bio.html',
    'psc_ba': 'https://sas.rochester.edu/psc/undergraduate/major-psc-ba.html',
    'psc_tracks': 'https://www.sas.rochester.edu/psc/courses/tracks.php?dept=psc',
    'cdcs': 'https://cdcs.ur.rochester.edu/',
    'cse': 'https://secure1.rochester.edu/registrar/CSE/',
    'ccas_clusters': 'https://www.rochester.edu/college/ccas/undergraduate/curriculum/clusters.html',
    'majors_index': 'https://www.rochester.edu/college/ccas/undergraduate/curriculum/index.html',
}

catalog = json.load(open(os.path.join(SRC, 'ur-catalog-raw.json')))
clusters_raw = json.load(open(os.path.join(SRC, 'clusters-parsed.json')))
psc_tracks = json.load(open(os.path.join(SRC, 'psc-tracks.json')))

# ---------------------------------------------------------------- courses ---

def parse_code(code):
    m = re.match(r'^([A-Z]{2,5})\s+(\d{3})([A-Z]{0,2})$', code)
    return (m.group(1), int(m.group(2)), m.group(3)) if m else (None, None, None)

# (introductoryScore heuristic removed 2026-07-07: superseded by the
#  same-department ascending-number rule in src/engine/deptSequencing.js)

def offered_from_claim(claim_list):
    terms = set()
    for c in claim_list:
        cl = c.lower()
        if 'fall' in cl: terms.add('fall')
        if 'spring' in cl: terms.add('spring')
    return sorted(terms)

# Officially stated prerequisites only. CNF: list of OR-groups.
CURATED_PREREQS = {
    # C- progression rule stated on CS BS requirements page.
    'CSC 172': {'prereqs': [['CSC 171']], 'verified': True, 'source': URLS['cs_bs'],
                'note': 'C- or better in CSC 171 required to progress.'},
    'CSC 173': {'prereqs': [['CSC 172']], 'verified': True, 'source': URLS['cs_bs'],
                'note': 'C- or better in CSC 172 required to progress.'},
    # Stated in course description on cs.rochester.edu fall term schedule.
    'CSC 242': {'prereqs': [['CSC 172'], ['MATH 150']], 'verified': True,
                'source': 'https://www.cs.rochester.edu/courses/fall.php'},
    'CSC 240': {'prereqs': [['CSC 171'], ['CSC 172'], ['MATH 161', 'MATH 141', 'MATH 171']],
                'verified': True, 'source': 'https://www.cs.rochester.edu/courses/fall.php'},
    # Stated on PSC tracks page ("Prerequisite: PSCI 200 or other statistics course").
    'PSCI 205': {'prereqs': [['PSCI 200', 'STAT 180', 'STAT 190', 'STAT 212', 'STAT 213', 'ECON 230']],
                 'verified': True, 'source': URLS['psc_tracks'],
                 'note': 'PSCI 200 or other statistics course.'},
    # Sequence ordering implied by official sequence definitions; not stated verbatim
    # on a fetched page -> verified false so the UI flags it for confirmation.
    'MATH 142': {'prereqs': [['MATH 141']], 'verified': False, 'note': 'Sequence order (MATH 14x); verify.'},
    'MATH 143': {'prereqs': [['MATH 142']], 'verified': False, 'note': 'Sequence order (MATH 14x); verify.'},
    'MATH 162': {'prereqs': [['MATH 161']], 'verified': False, 'note': 'Sequence order (MATH 16x); verify.'},
    'MATH 163': {'prereqs': [['MATH 162']], 'verified': False, 'note': 'Sequence order; verify.'},
    'MATH 164': {'prereqs': [['MATH 162']], 'verified': False, 'note': 'Sequence order; verify.'},
    'MATH 165': {'prereqs': [['MATH 162', 'MATH 143', 'MATH 172']], 'verified': False,
                 'note': 'Calculus II normally required first; verify.'},
    'MATH 172': {'prereqs': [['MATH 171']], 'verified': False, 'note': 'Sequence order (MATH 17x); verify.'},
    'MATH 173': {'prereqs': [['MATH 172']], 'verified': False, 'note': 'Sequence order (MATH 17x); verify.'},
    'CHEM 132': {'prereqs': [['CHEM 131']], 'verified': False, 'note': 'Sequence order (CHEM 131-132); verify.'},
    'CHEM 203': {'prereqs': [['CHEM 132']], 'verified': False,
                 'note': 'Taken after CHEM 131-132 per Biology BA page sequencing; verify.'},
    'CHEM 207': {'prereqs': [], 'verified': False, 'note': 'Lab taken with CHEM 203 (corequisite); verify.'},
    'BIOL 111L': {'prereqs': [['BIOL 110L', 'BIOL 112L']], 'verified': False,
                  'note': 'Intro sequence order per Biology BA page; verify.'},
    'BIOL 198': {'prereqs': [['BIOL 111L', 'BIOL 113L']], 'verified': False,
                 'note': 'Taken after intro biology per Biology BA page sequencing; verify.'},
    'BIOL 190': {'prereqs': [['BIOL 111L', 'BIOL 113L']], 'verified': False,
                 'note': 'Taken after intro biology per Biology BA page sequencing; verify.'},
}

# Course codes named as prerequisites in CDCS Public Notes / descriptions.
# Curated verified entries above still win; this fills the rest so auto-generate
# can order them. MATH 141/161 stay empty when CDCS only cites high-school placement.
CDCS_PREREQS = parse_catalog(catalog)

def expand_intro_programming_prereqs(prereqs):
    # CSC 171 covers a CSC 161 prerequisite; CSC 161 does not cover CSC 171.
    out = []
    for g in prereqs:
        ng = list(g)
        if 'CSC 161' in ng and 'CSC 171' not in ng:
            ng.append('CSC 171')
        out.append(ng)
    return out

def prereq_fields(code):
    cur = CURATED_PREREQS.get(code)
    parsed = CDCS_PREREQS.get(code)
    if cur and cur.get('verified'):
        src = cur
    elif parsed:
        src = parsed
    else:
        src = cur or {}
    return {
        'prereqs': expand_intro_programming_prereqs(src.get('prereqs', [])),
        'prereqsVerified': src.get('verified', False),
        'prereqNote': src.get('note'),
        'prereqSource': src.get('source'),
    }

courses = {}
for code, e in catalog.items():
    dept, num, suffix = parse_code(code)
    if dept is None:
        continue
    offered = e.get('terms_seen') or []
    fields = prereq_fields(code)
    courses[code] = {
        'id': code, 'dept': dept, 'number': num, 'suffix': suffix,
        'title': e.get('title') or code,
        'credits': e.get('credits') if e.get('credits') is not None else 4,
        'creditsVerified': e.get('credits') is not None,
        'offered': offered,
        'offeredClaim': offered_from_claim(e.get('offered_field', [])),
        'offeredVerified': bool(offered),
        'prereqs': fields['prereqs'],
        'prereqsVerified': fields['prereqsVerified'],
        'prereqNote': fields['prereqNote'],
        'prereqSource': fields['prereqSource'],
        'instructors': list(e.get('instructors') or []),
        'description': (e.get('desc') or '')[:260],
        'crossListings': [],
        'crossListingSource': None,
        'source': 'CDCS (Registrar) Fall 2025 / Spring 2026 / Fall 2026 schedules',
        'stub': False,
    }

# Courses referenced by clusters but not scheduled in the two harvested terms:
# create stub entries so they are searchable/placeable, clearly flagged.
for cl in clusters_raw:
    for g in cl['groups']:
        for opt in g['options']:
            for i, code in enumerate(opt['codes']):
                dept, num, suffix = parse_code(code)
                if dept is None or code in courses:
                    continue
                title = code
                m = re.search(re.escape(code.split()[1]) + r':?\s*([^•]+)', opt['text'])
                if m:
                    title = m.group(1).strip().split(' or ')[0][:80].rstrip(' (')
                courses[code] = {
                    'id': code, 'dept': dept, 'number': num, 'suffix': suffix,
                    'title': title,
                    'credits': 4, 'creditsVerified': False,
                    'offered': [], 'offeredClaim': [], 'offeredVerified': False,
                    'prereqs': [], 'prereqsVerified': False, 'prereqNote': None, 'prereqSource': None,
                    'instructors': [],
                    'description': '',
                    'crossListings': [],
                    'crossListingSource': None,
                    'source': 'Referenced by cluster listing (CSE PDF 2025-26); details not yet sourced',
                    'stub': True,
                }

# ---------------------------------------------------------------- clusters ---

# Cluster IDs embed the *old* SAS department tokens (e.g. H1ENG### where the
# course designator is ENGL). This table normalizes each token to the course
# department codes it encompasses, so the own-department rule can compare a
# cluster's home department against a major's departments. Heuristic mapping
# of known renames - flagged in README for verification.
DEPT_TOKEN_TO_COURSE_DEPTS = {
    'AAS': ['AAAS', 'BLST'], 'AH': ['AHST', 'AH'], 'AME': ['AME'], 'ANT': ['ANTH', 'ANR'],
    'ASL': ['ASLA'], 'BCS': ['BCSC'], 'BIO': ['BIOL'], 'BME': ['BME'], 'CHE': ['CHE'],
    'CHI': ['CHIN'], 'CHM': ['CHEM'], 'CLT': ['CLTR'], 'CSC': ['CSC'], 'DAN': ['DANC'],
    'ECE': ['ECE'], 'ECO': ['ECON', 'AEC'], 'EES': ['EESC'], 'EHU': ['EHUM'],
    'ENG': ['ENGL', 'ENG'], 'FMS': ['FMST'], 'FR': ['FREN', 'FR'], 'GER': ['GRMN', 'GER'],
    'GSW': ['GSWS', 'GSW', 'WST', 'WMST'], 'HIS': ['HIST', 'HIS'], 'INT': ['INTD'],
    'IT': ['ITAL', 'IT'], 'JPN': ['JPNS'], 'KOR': ['KORE'], 'LIN': ['LING'], 'MAS': ['MAS'],
    'ME': ['ME'], 'MTH': ['MATH', 'MTH'], 'MUR': ['MUSC', 'MUR'], 'OPT': ['OPT'],
    'PAS': ['PHYS', 'ASTR'], 'PH': ['PHLT'], 'PHL': ['PHIL', 'PHL'], 'POL': ['POLS'],
    'POR': ['PORT'], 'PSC': ['PSCI', 'INTR', 'PSC', 'IR'], 'PSY': ['PSYC', 'PSY'],
    'REL': ['RELC', 'REL'], 'RST': ['RSST'], 'RUS': ['RUSS', 'RUS'], 'SA': ['SART'],
    'SP': ['SPAN'], 'STT': ['STAT', 'APS'], 'SUS': ['SUST'], 'WRT': ['WRTG'],
}

clusters = []
for cl in clusters_raw:
    division = {'Humanities': 'humanities', 'Social Sciences': 'social-sciences',
                'Natural Sciences': 'natural-sciences'}[cl['division']]
    clusters.append({
        'id': cl['id'],
        'name': cl['name'],
        'division': division,
        'homeDept': cl['homeDept'],
        'homeDeptCourseDepts': DEPT_TOKEN_TO_COURSE_DEPTS.get(cl['homeDept'], [cl['homeDept']]),
        'description': cl['description'],
        'status': 'ACTIVE' if cl['parseStatus'] == 'OK' else 'PARTIAL_PARSE',
        'sourceUrl': URLS['cse'],
        'sourcedOn': FETCH_DATE,
        'groups': [
            {
                'n': g['n'],
                'all': g['all'],
                'unit': g['unit'],
                'note': g['note'],
                'options': [{'codes': o['codes'], 'mode': o['mode'], 'text': o['text']}
                            for o in g['options']],
            } for g in cl['groups']
        ],
    })

# ---------------------------------------------------------------- programs ---

def rg(id_, label, rule, note=None):
    g = {'id': id_, 'label': label, 'rule': rule}
    if note: g['note'] = note
    return g

CS_CORE = ['CSC 173', 'CSC 242', 'CSC 252', 'CSC 254', 'CSC 280', 'CSC 282']

cs_bs = {
    'id': 'major-csc-bs', 'type': 'major', 'name': 'Computer Science', 'degree': 'BS',
    'school': 'hajim', 'division': 'natural-sciences', 'departments': ['CSC'],
    'status': 'ACTIVE', 'sourceUrl': URLS['cs_bs'], 'sourcedOn': FETCH_DATE,
    'clustersRequired': 2,
    'allowedClusterDivisions': ['humanities', 'social-sciences'],
    'totalCreditsOverride': None,
    'overlapCapOverride': None,
    'notes': [
        'Pre-major courses require a GPA of at least 2.0.',
        'C- or better required to progress CSC 171 -> 172 -> 173.',
        'No more than two core/advanced courses may be taken at other institutions (except UR education abroad).',
        'At least 12 credit hours of general electives are required.',
    ],
    'requirementGroups': [
        rg('premajor', 'Pre-major', {'type': 'all_of', 'courses': ['CSC 171', 'CSC 172', 'MATH 150']},
           'MATH 171 students may substitute the MATH 150A supplement for MATH 150.'),
        rg('calculus', 'Calculus sequence', {'type': 'sequence_one_of', 'sequences': [
            ['MATH 161', 'MATH 162'], ['MATH 141', 'MATH 142', 'MATH 143'], ['MATH 171', 'MATH 172']]},
           'Either the MATH 14x, MATH 16x, or MATH 17x sequence.'),
        rg('core', 'Core courses', {'type': 'all_of', 'courses': CS_CORE}),
        rg('stat', 'Statistics', {'type': 'n_of', 'n': 1,
                                  'options': ['STAT 190', 'ECON 230', 'MATH 201', 'STAT 201']}),
        rg('linear', 'Linear algebra', {'type': 'n_of', 'n': 1, 'options': ['MATH 165', 'MATH 173']}),
        rg('advanced', 'Advanced CSC (4 courses, 200-level or higher)',
           {'type': 'n_from_filter', 'n': 4,
            'filter': {'depts': ['CSC'], 'minNumber': 200, 'maxNumber': 399, 'minCredits': 4,
                       'exclude': CS_CORE + ['CSC 273W', 'CSC 299W']}},
           'Four 4-credit advanced CSC courses numbered 200 or higher (beyond the core).'),
    ],
    'upperLevelWriting': {
        'label': 'Two upper-level writing courses approved by the CS department',
        'rule': {'type': 'n_from_filter', 'n': 2,
                 'filter': {'depts': ['CSC'], 'minNumber': 200, 'maxNumber': 399, 'wOnly': True}},
        'note': 'Commonly CSC 273W / CSC 299W; department-approved list governs.',
    },
}

# (BA in Biology moved to data-src/programs/biol-ba.json in the Bio-tracks batch)

psc_track_names = list(psc_tracks.keys())
psc_tracks_codes = {name: [c['code'] for c in lst] for name, lst in psc_tracks.items()}
PSC_TOOLS = ['PSCI 107', 'PSCI 200', 'PSCI 202W', 'PSCI 203W', 'PSCI 205', 'PSCI 281', 'PSCI 288']

psc_ba = {
    'id': 'major-psc-ba', 'type': 'major', 'name': 'Political Science', 'degree': 'BA',
    'school': 'sas', 'division': 'social-sciences', 'departments': ['PSCI', 'INTR'],
    'status': 'ACTIVE', 'sourceUrl': URLS['psc_ba'], 'sourcedOn': FETCH_DATE,
    'clustersRequired': 2,
    'allowedClusterDivisions': ['humanities', 'natural-sciences'],
    'totalCreditsOverride': None,
    'overlapCapOverride': None,
    'programChecks': {'totalCourses': 12, 'minFromDepts': {'depts': ['PSCI', 'INTR'], 'n': 9},
                      'max100Level': 4},
    'notes': [
        'At least 12 courses, minimum 2.0 GPA across them; at least 9 of 12 with PSCI/INTR designation.',
        'No S/F-graded courses may count.',
        'Maximum four 100-level courses.',
        'Transfer credit: max three courses; none for tools, writing, or team learning.',
        'Tools courses cannot double-count toward core track, breadth, or electives.',
    ],
    'requirementGroups': [
        rg('tools', 'Tools of political analysis (2)', {'type': 'n_of', 'n': 2, 'options': PSC_TOOLS},
           'Tools courses cannot also count toward core track, breadth, or electives.'),
        rg('core-track', 'Core track (5 courses from one field)',
           {'type': 'track_n_of', 'n': 5, 'tracks': psc_tracks_codes},
           'All five from a single track: ' + ', '.join(psc_track_names) + '.'),
        rg('breadth', 'Breadth (2 courses outside your core track)',
           {'type': 'breadth_outside_track', 'n': 2, 'trackGroupId': 'core-track'}),
        rg('electives', 'Electives (3)',
           {'type': 'n_from_filter', 'n': 3,
            'filter': {'depts': ['PSCI', 'INTR', 'ECON', 'HIST', 'PHIL'], 'minNumber': 100,
                       'maxNumber': 399, 'exclude': []}},
           'PSCI/INTR track offerings or ECON, HIST, PHIL; other departments need approval.'),
        rg('team-learning', 'Team learning (1+)',
           {'type': 'n_from_filter', 'n': 1,
            'filter': {'depts': ['PSCI', 'INTR'], 'minNumber': 380, 'maxNumber': 399, 'exclude': []}},
           'NEEDS VERIFICATION: research seminars, experiential learning, independent study, internships qualify; filter is an approximation.'),
    ],
    'upperLevelWriting': {
        'label': 'Two W courses with PSCI/INTR designation',
        'rule': {'type': 'n_from_filter', 'n': 2,
                 'filter': {'depts': ['PSCI', 'INTR'], 'minNumber': 200, 'maxNumber': 399, 'wOnly': True}},
        'note': 'Counted within the 12-course total; max one may also satisfy writing in a second/third major.',
    },
}

cs_minor = {
    'id': 'minor-csc', 'type': 'minor', 'name': 'Computer Science', 'degree': 'Minor',
    'school': 'hajim', 'division': 'natural-sciences', 'departments': ['CSC'],
    'status': 'ACTIVE', 'sourceUrl': URLS['cs_minor'], 'sourcedOn': FETCH_DATE,
    'notes': [
        'Six 4-credit CSC courses above the level of 130.',
        'CSC 161 counts only if completed before CSC 171; CSC 162 only if before CSC 172.',
    ],
    'requirementGroups': [
        rg('six', 'Six CSC courses above 130',
           {'type': 'n_from_filter', 'n': 6,
            'filter': {'depts': ['CSC'], 'minNumber': 131, 'maxNumber': 399, 'minCredits': 4}}),
    ],
    'upperLevelWriting': None,
}

def placeholder(id_, name, degree, type_, school, division, url, extra=None):
    p = {
        'id': id_, 'type': type_, 'name': name, 'degree': degree,
        'school': school, 'division': division, 'departments': [],
        'status': 'NEEDS_DATA_ENTRY',
        'sourceUrl': url, 'sourcedOn': None,
        'requirementGroups': [], 'upperLevelWriting': None,
        'notes': ['Requirements not yet loaded. Source them from the official page linked above.'],
    }
    if extra: p.update(extra)
    return p

H = 'https://www.hajim.rochester.edu/'
S = 'https://www.sas.rochester.edu/'
placeholders = [
    # Hajim majors named in confirmed policy (credit totals / cluster counts from policy).
    placeholder('major-ame-bs', 'Audio and Music Engineering', 'BS', 'major', 'hajim', 'engineering', H + 'ame/',
                {'clustersRequired': 1, 'allowedClusterDivisions': ['humanities', 'social-sciences'], 'totalCreditsOverride': 132}),
    placeholder('major-bme-bs', 'Biomedical Engineering', 'BS', 'major', 'hajim', 'engineering', H + 'bme/',
                {'clustersRequired': 1, 'allowedClusterDivisions': ['humanities', 'social-sciences'], 'totalCreditsOverride': 131}),
    placeholder('major-che-bs', 'Chemical Engineering', 'BS', 'major', 'hajim', 'engineering', H + 'che/',
                {'clustersRequired': 1, 'allowedClusterDivisions': ['humanities', 'social-sciences'], 'totalCreditsOverride': 132}),
    placeholder('major-ece-bs', 'Electrical and Computer Engineering', 'BS', 'major', 'hajim', 'engineering', H + 'ece/',
                {'clustersRequired': 1, 'allowedClusterDivisions': ['humanities', 'social-sciences'], 'totalCreditsOverride': 130}),
    placeholder('major-me-bs', 'Mechanical Engineering', 'BS', 'major', 'hajim', 'engineering', H + 'me/',
                {'clustersRequired': 1, 'allowedClusterDivisions': ['humanities', 'social-sciences'],
                 'totalCreditsOverride': None,
                 'totalCreditsNote': 'NEEDS VERIFICATION: total credit hours not confirmed (spec flags mechanical engineering as unverified).'}),
    placeholder('major-opt-bs', 'Optics', 'BS', 'major', 'hajim', 'engineering', H + 'optics/',
                {'clustersRequired': 1, 'allowedClusterDivisions': ['humanities', 'social-sciences'], 'totalCreditsOverride': 129}),
    placeholder('major-opte-bs', 'Optical Engineering', 'BS', 'major', 'hajim', 'engineering', H + 'optics/',
                {'clustersRequired': 1, 'allowedClusterDivisions': ['humanities', 'social-sciences'], 'totalCreditsOverride': 129}),
    placeholder('major-dsc-bs', 'Data Science', 'BS', 'major', 'hajim', 'natural-sciences', H + 'dsc/',
                {'clustersRequired': 2}),
    placeholder('major-geo-bs', 'Geomechanics', 'BS', 'major', 'hajim', 'natural-sciences', H,
                {'clustersRequired': 2}),
    placeholder('major-eas-bs', 'Engineering Science / Engineering and Applied Sciences', 'BS', 'major', 'hajim', 'engineering', H,
                {'clustersRequired': 2}),
    # Pilot-adjacent programs seen on department sites.
    placeholder('major-csc-ba', 'Computer Science', 'BA', 'major', 'sas', 'natural-sciences',
                'https://www.cs.rochester.edu/undergraduate/ba-requirements.html', {'clustersRequired': 2}),
    placeholder('major-psc-bs', 'Political Science', 'BS', 'major', 'sas', 'social-sciences', S + 'psc/undergraduate/major-psc-bs.html', {'clustersRequired': 2}),
    placeholder('major-ir-ba', 'International Relations', 'BA', 'major', 'sas', 'social-sciences', S + 'psc/undergraduate/major-ir.html', {'clustersRequired': 2}),
    placeholder('major-ppe-ba', 'Politics, Philosophy, and Economics', 'BA', 'major', 'sas', 'social-sciences', S + 'psc/undergraduate/major-ppe.html', {'clustersRequired': 2}),
    # Common SAS departments (dept sites exist; requirements not sourced yet).
    placeholder('major-econ-ba', 'Economics', 'BA', 'major', 'sas', 'social-sciences', S + 'eco/', {'clustersRequired': 2}),
    placeholder('major-math-ba', 'Mathematics', 'BA', 'major', 'sas', 'natural-sciences', S + 'mth/', {'clustersRequired': 2}),
    placeholder('major-math-bs', 'Mathematics', 'BS', 'major', 'sas', 'natural-sciences', S + 'mth/', {'clustersRequired': 2}),
    placeholder('major-phys-ba', 'Physics', 'BA', 'major', 'sas', 'natural-sciences', S + 'pas/', {'clustersRequired': 2}),
    placeholder('major-phys-bs', 'Physics', 'BS', 'major', 'sas', 'natural-sciences', S + 'pas/', {'clustersRequired': 2}),
    placeholder('major-chem-ba', 'Chemistry', 'BA', 'major', 'sas', 'natural-sciences', S + 'chm/', {'clustersRequired': 2}),
    placeholder('major-chem-bs', 'Chemistry', 'BS', 'major', 'sas', 'natural-sciences', S + 'chm/', {'clustersRequired': 2}),
    placeholder('major-engl-ba', 'English', 'BA', 'major', 'sas', 'humanities', S + 'eng/', {'clustersRequired': 2}),
    placeholder('major-hist-ba', 'History', 'BA', 'major', 'sas', 'humanities', S + 'his/', {'clustersRequired': 2}),
    placeholder('major-phil-ba', 'Philosophy', 'BA', 'major', 'sas', 'humanities', S + 'phl/', {'clustersRequired': 2}),
    placeholder('major-psyc-ba', 'Psychology', 'BA', 'major', 'sas', 'social-sciences', S + 'psy/', {'clustersRequired': 2}),
    placeholder('major-bcsc-ba', 'Brain and Cognitive Sciences', 'BA', 'major', 'sas', 'natural-sciences', S + 'bcs/', {'clustersRequired': 2}),
    placeholder('major-bcsc-bs', 'Brain and Cognitive Sciences', 'BS', 'major', 'sas', 'natural-sciences', S + 'bcs/', {'clustersRequired': 2}),
    placeholder('major-anth-ba', 'Anthropology', 'BA', 'major', 'sas', 'social-sciences', S + 'ant/', {'clustersRequired': 2}),
    placeholder('major-eesc-ba', 'Earth and Environmental Sciences', 'BA', 'major', 'sas', 'natural-sciences', S + 'ees/', {'clustersRequired': 2}),
    placeholder('major-eesc-bs', 'Earth and Environmental Sciences', 'BS', 'major', 'sas', 'natural-sciences', S + 'ees/', {'clustersRequired': 2}),
    # Majors with confirmed stricter double-major overlap caps (per project policy).
    placeholder('major-hls-ba', 'Health, Behavior, and Society (HLS)', 'BA', 'major', 'sas', 'social-sciences', URLS['majors_index'],
                {'clustersRequired': 2, 'overlapCapOverride': 2}),
    placeholder('major-ipa-ba', 'International Political Analysis (IPA)', 'BA', 'major', 'sas', 'social-sciences', URLS['majors_index'],
                {'clustersRequired': 2, 'overlapCapOverride': 2}),
    # Minor placeholders.
    placeholder('minor-bio', 'Biology', 'Minor', 'minor', 'sas', 'natural-sciences', S + 'bio/undergraduate/minors.html'),
    placeholder('minor-psc', 'Political Science', 'Minor', 'minor', 'sas', 'social-sciences', S + 'psc/undergraduate/'),
    placeholder('minor-econ', 'Economics', 'Minor', 'minor', 'sas', 'social-sciences', S + 'eco/'),
    placeholder('minor-math', 'Mathematics', 'Minor', 'minor', 'sas', 'natural-sciences', S + 'mth/'),
    placeholder('minor-engl', 'English', 'Minor', 'minor', 'sas', 'humanities', S + 'eng/'),
    placeholder('minor-hist', 'History', 'Minor', 'minor', 'sas', 'humanities', S + 'his/'),
    placeholder('minor-phil', 'Philosophy', 'Minor', 'minor', 'sas', 'humanities', S + 'phl/'),
    placeholder('minor-psyc', 'Psychology', 'Minor', 'minor', 'sas', 'social-sciences', S + 'psy/'),
]

programs = [cs_bs, psc_ba, cs_minor] + placeholders

# Hand-encoded programs live as JSON files in data-src/programs/ (one per
# program, template: data-src/TEMPLATE.program.json). A file whose id matches
# an existing entry (usually a placeholder) replaces it; new ids are appended.
import glob
TRACK_SETS = {
    'psc-tracks': psc_tracks_codes,
    'ir-tracks': (json.load(open(os.path.join(SRC, 'ir-tracks.json')))
                  if os.path.exists(os.path.join(SRC, 'ir-tracks.json')) else {}),
}
# Reusable option lists (e.g. Biology diversification electives per track,
# stored with their Fall/Spring split preserved for auditability). A rule may
# say {"type": "n_of", "n": 3, "optionsRef": "bio-div:ba"}.
BIO_DIV = (json.load(open(os.path.join(SRC, 'bio-diversification.json')))
           if os.path.exists(os.path.join(SRC, 'bio-diversification.json')) else {})

def resolve_track_refs(entry):
    for g in entry.get('requirementGroups', []):
        r = g.get('rule', {})
        if r.get('type') == 'track_n_of' and 'tracksRef' in r:
            r['tracks'] = TRACK_SETS[r.pop('tracksRef')]
        if 'optionsRef' in r:
            ref = r.pop('optionsRef')
            kind, key = ref.split(':', 1)
            assert kind == 'bio-div' and key in BIO_DIV, f'unknown optionsRef {ref}'
            seen, opts = set(), []
            for term in ('fall', 'spring'):
                for c in BIO_DIV[key][term]:
                    if c not in seen:
                        seen.add(c); opts.append(c)
            r['options'] = sorted(opts)
    return entry

prog_dir = os.path.join(SRC, 'programs')
if os.path.isdir(prog_dir):
    by_id = {p['id']: i for i, p in enumerate(programs)}
    for path in sorted(glob.glob(os.path.join(prog_dir, '*.json'))):
        entry = resolve_track_refs(json.load(open(path)))
        if entry['id'] in by_id:
            programs[by_id[entry['id']]] = entry
        else:
            programs.append(entry)
            by_id[entry['id']] = len(programs) - 1

# ------------------------------------------------------- equivalency groups ---
# "A instead of B" alternatives (NOT prerequisites). A plan may follow only one
# path per group; the group's satisfiesPrereqLevel tag is fulfilled once the
# terminal course of any single path is completed.
#
# Only groups confirmed against a fetched official page are ACTIVE. The project
# spec's illustrative example treated MATH 171 alone as the honors path; the
# sourced CS BS page defines the sequences as MATH 14x / 16x / 17x, so the
# honors path here is MATH 171-172 (deviation noted in README).

equivalency_groups = [
    {
        'id': 'calc-sequence',
        'name': 'Calculus sequence',
        'status': 'ACTIVE',
        'sourceUrl': URLS['cs_bs'],
        'sourceQuote': 'Either MATH 14x, MATH 16x, or MATH 17x sequence',
        'sourcedOn': FETCH_DATE,
        'satisfiesPrereqLevel': 'calc_sequence_complete',
        'paths': [
            {'id': '14x', 'name': 'MATH 141-143', 'courses': ['MATH 141', 'MATH 142', 'MATH 143'], 'accelerated': False},
            {'id': '16x', 'name': 'MATH 161-162', 'courses': ['MATH 161', 'MATH 162'], 'accelerated': False},
            {'id': '17x', 'name': 'Honors (MATH 171-172)', 'courses': ['MATH 171', 'MATH 172'], 'accelerated': True},
        ],
    },
    # CSC 161 and CSC 171 are alternate intro-programming / intro-CS courses
    # (both Python). CDCS says 161 cannot count for a CSC major or minor if
    # taken after or alongside 171; requirement pages across the college list
    # them as a single "choose one" slot. CSC 162 is not in the current catalog.
    # This group blocks placing both on a plan. It does NOT make 161 satisfy
    # CSC 172 or the CS BA/BS "CSC 171" core — those pages name 171 specifically.
    {
        'id': 'intro-cs',
        'name': 'Introductory computer science',
        'status': 'ACTIVE',
        'sourceUrl': URLS['cdcs'],
        'sourceQuote': 'This course may not be used for CSC major or minor credit if completed after or at the same time as CSC171.',
        'sourcedOn': '2026-08-24',
        'satisfiesPrereqLevel': 'intro_cs_complete',
        'paths': [
            {'id': '161', 'name': 'CSC 161 (intro programming)', 'courses': ['CSC 161'], 'accelerated': False},
            {'id': '171', 'name': 'CSC 171 (intro CS)', 'courses': ['CSC 171'], 'accelerated': False},
        ],
    },
    {
        'id': 'intro-biology',
        'name': 'Introductory biology sequence',
        'status': 'ACTIVE',
        'sourceUrl': URLS['bio_ba'],
        'sourceQuote': 'BIOL 110L and 111L (or 112L and 113L)',
        'sourcedOn': FETCH_DATE,
        'satisfiesPrereqLevel': 'intro_bio_complete',
        'paths': [
            {'id': '110', 'name': 'BIOL 110L-111L', 'courses': ['BIOL 110L', 'BIOL 111L'], 'accelerated': False},
            {'id': '112', 'name': 'BIOL 112L-113L', 'courses': ['BIOL 112L', 'BIOL 113L'], 'accelerated': False},
        ],
    },
    # Plausible families that must be confirmed before getting course lists —
    # consistent with the Program model's NEEDS_DATA_ENTRY convention.
    # JUDGMENT CALL (flagged per Bio-track spec): PHYS 113 / 121 / 141 are
    # modeled as an EquivalencyGroup because the Biology pages present them as
    # alternate-rigor variants of the same intro-physics slot ("one of the
    # following physics I courses"). Sourced from the Biology requirement
    # pages, NOT the Physics department's own page - if PAS policy allows
    # credit for more than one of these, downgrade this to plain n_of choices.
    {
        'id': 'intro-physics', 'name': 'Introductory physics (Physics I)',
        'status': 'ACTIVE',
        'sourceUrl': URLS['bio_ba'],
        'sourceQuote': 'One of the following physics I courses: PHYS 113: General Physics I with Lab; PHYS 121: Mechanics; PHYS 141: Mechanics (Honors) with Lab',
        'sourcedOn': '2026-07-06',
        'satisfiesPrereqLevel': 'physics_intro_complete',
        'paths': [
            {'id': '113', 'name': 'PHYS 113 (general)', 'courses': ['PHYS 113'], 'accelerated': False},
            {'id': '121', 'name': 'PHYS 121 (mechanics)', 'courses': ['PHYS 121'], 'accelerated': False},
            {'id': '141', 'name': 'PHYS 141 (honors)', 'courses': ['PHYS 141'], 'accelerated': True},
        ],
    },
    # Organic chemistry I: two alternate-rigor sequences covering the same
    # material - exactly the pattern the equivalency-group feature was built
    # for (vs. the intro-biology 198/190 choice, which stays a plain n_of
    # inside programs because it is one requirement slot, not a multi-course
    # rigor path).
    {
        'id': 'orgo-sequence', 'name': 'Organic chemistry I sequence',
        'status': 'ACTIVE',
        'sourceUrl': URLS['bio_ba'],
        'sourceQuote': 'One of the following organic chemistry I courses: CHEM 203/207: Organic Chemistry I with Lab; CHEM 171/173: First Year Organic Chemistry I with Lab',
        'sourcedOn': '2026-07-06',
        'satisfiesPrereqLevel': 'orgo_sequence_complete',
        'paths': [
            {'id': '203', 'name': 'CHEM 203 + 207', 'courses': ['CHEM 203', 'CHEM 207'], 'accelerated': False},
            {'id': '171', 'name': 'First-year organic (CHEM 171 + 173)', 'courses': ['CHEM 171', 'CHEM 173'], 'accelerated': True},
        ],
    },
    # NOTE on calculus (verified, no change needed): the Biology pages require
    # only ONE calculus course (MATH 141 / 161 / 171Q -> our MATH 171), i.e. a
    # Calc-I-level slot, NOT "calc_sequence_complete". Programs model that as
    # a plain n_of; the existing calc-sequence group still applies unmodified
    # for its conflict role (placing MATH 141 alongside MATH 171 is flagged),
    # and its terminal-course level tag is simply not referenced by Biology.
    {
        'id': 'intro-chemistry', 'name': 'Introductory / first-year chemistry',
        'status': 'NEEDS_DATA_ENTRY', 'sourceUrl': S + 'chm/', 'sourceQuote':
            'Bio BA page notes CHEM 171/173 + 172/210 with AP credit can replace CHEM 131-132; exact path structure unconfirmed',
        'sourcedOn': None, 'satisfiesPrereqLevel': 'intro_chem_complete', 'paths': [],
    },
    {
        'id': 'intro-statistics', 'name': 'Introductory statistics',
        'status': 'NEEDS_DATA_ENTRY', 'sourceUrl': S + 'mth/', 'sourceQuote': None,
        'sourcedOn': None, 'satisfiesPrereqLevel': 'intro_stat_complete', 'paths': [],
    },
]

# ------------------------------------------------------------------ policy ---

policy = {
    'sourceNote': 'Confirmed UR policy rules supplied with the project spec (2026-07); per-item sources in README.',
    'standardTotalCredits': 128,
    'doubleDegreeTotalCredits': 136,
    'maxCoursesPerDepartment': 20,
    'declareByCredits': 64,
    'clusterMinCourses': 3,
    'divisions': ['humanities', 'social-sciences', 'natural-sciences', 'engineering'],
    'overlapCaps': {'majorMajor': 3, 'majorMinor': 2, 'minorMinor': 2, 'clusterProgram': 1},
    'clusterUniqueCoursesMin': 2,
    'overlapExemptCourses': [
        'BIOL 110L', 'BIOL 111L', 'BIOL 112L', 'BIOL 113L',
        'MATH 141', 'MATH 142', 'MATH 143', 'MATH 150',
        'MATH 161', 'MATH 162', 'MATH 163', 'MATH 164', 'MATH 165',
        'MATH 171', 'MATH 172', 'MATH 173', 'MATH 174',
        'PHYS 113', 'PHYS 114', 'PHYS 121', 'PHYS 121P', 'PHYS 122', 'PHYS 122P',
        'PHYS 123', 'PHYS 141', 'PHYS 142', 'PHYS 143',
        'STAT 211', 'STAT 212', 'STAT 213', 'STAT 214',
        'ECON 230', 'PSCI 200', 'DSCC 262',
    ],
    'pwr': {
        'label': 'Primary Writing Requirement',
        'satisfiedBy': [['WRTG 105'], ['WRTG 105E'], ['WRTG 105A', 'WRTG 105B']],
        'minGrade': 'C',
        'neverCountsTowardCluster': ['WRTG 105', 'WRTG 105A', 'WRTG 105B', 'WRTG 105E'],
    },
    'creditLoad': {'min': 12, 'max': 18},
    'transferRules': {
        'apIbNeverSatisfiesCluster': True,
        'transferGenerallyNotForClusters': True,
        'transferClusterExceptionNote': 'Study-abroad courses may count toward clusters with department approval.',
    },
}

# ------------------------------------------------------------------- write ---

# Courses referenced by hand-encoded requirement lists (all_of / n_of /
# sequences / equivalency paths / PWR) but not scheduled in the harvested
# terms: create flagged stubs so they stay placeable and searchable. The
# linter warns whenever an ACTIVE program leans on one of these.
referenced = set()
for p in programs:
    rules = [g['rule'] for g in p.get('requirementGroups', [])]
    if p.get('upperLevelWriting') and p['upperLevelWriting'].get('rule'):
        rules.append(p['upperLevelWriting']['rule'])
    for r in rules:
        referenced.update(r.get('courses', []))
        referenced.update(r.get('options', []))
        for seq in r.get('sequences', []):
            referenced.update(seq)
        # track_n_of names its courses under tracks{}; without this a course that
        # appears ONLY in a track never gets a stub and its track can never be
        # completed (ECE 240 in the ECE minor's Digital Audio program of study).
        for codes in (r.get('tracks') or {}).values():
            referenced.update(codes)
for grp in equivalency_groups:
    for path in grp.get('paths', []):
        referenced.update(path['courses'])
for combo in policy['pwr']['satisfiedBy']:
    referenced.update(combo)
for code in sorted(referenced):
    dept, num, suffix = parse_code(code)
    if dept is None or code in courses:
        continue
    courses[code] = {
        'id': code, 'dept': dept, 'number': num, 'suffix': suffix,
        'title': code,
        'credits': 4, 'creditsVerified': False,
        'offered': [], 'offeredClaim': [], 'offeredVerified': False,
        'prereqs': [], 'prereqsVerified': False, 'prereqNote': None, 'prereqSource': None,
        'instructors': [],
        'description': '',
        'crossListings': [],
        'crossListingSource': None,
        'source': 'Listed in program requirements; not scheduled in harvested terms',
        'stub': True,
    }

# Cross-listings: the same class under two (or more) department codes.
# CDCS Co-Located is the registrar's official pairing. Matching title +
# description catches listings that share a blurb but weren't tagged in every
# harvested section. Independent-study / dissertation boilerplates are skipped
# so 70 department-specific 391s are not treated as one course.
_COLOC_CODE = re.compile(r'([A-Z]{2,5})\s+(\d{3}[A-Z]{0,2})')
_GENERIC_TITLE = re.compile(
    r'independent (study|research|work)|phd (research|readings)|'
    r'doctoral dissertation|continuation of (masters|doctoral)|'
    r'masters (dissertation|research|readings?|thesis)|'
    r'supervised teaching|visiting student|senior project|'
    r'^(fall|spring) 20\d{2}$',
    re.I,
)

def _norm_title(t):
    t = re.sub(r'\s+', ' ', (t or '').lower()).strip()
    return re.sub(r'[^a-z0-9 +&/-]', '', t)

def _norm_desc_key(d):
    return re.sub(r'\s+', ' ', (d or '').lower()).strip()[:200]

def attach_cross_listings(courses, catalog):
    parent = {cid: cid for cid in courses}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, b):
        if a not in parent or b not in parent or a == b:
            return
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    coloc_edges = set()
    for cid, e in catalog.items():
        loc = e.get('colocated') or ''
        if not loc:
            continue
        partners = {f'{m.group(1)} {m.group(2)}' for m in _COLOC_CODE.finditer(loc)}
        partners.add(cid)
        live = sorted(c for c in partners if c in courses)
        for i, a in enumerate(live):
            for b in live[i + 1:]:
                union(a, b)
                coloc_edges.add(tuple(sorted((a, b))))

    title_edges = set()
    by_key = {}
    for cid, c in courses.items():
        if c.get('stub'):
            continue
        raw = catalog.get(cid) or {}
        title = _norm_title(c.get('title') or raw.get('title'))
        desc = _norm_desc_key(raw.get('desc') or c.get('description'))
        if not title or len(title) < 8 or _GENERIC_TITLE.search(title):
            continue
        if not desc or len(desc) < 60:
            continue
        if 'opportunity to pursue' in desc or 'made arrangements with a faculty' in desc:
            continue
        by_key.setdefault((title, desc), []).append(cid)
    for ids in by_key.values():
        uniq = sorted(set(ids))
        if len(uniq) < 2:
            continue
        for i, a in enumerate(uniq):
            for b in uniq[i + 1:]:
                union(a, b)
                title_edges.add(tuple(sorted((a, b))))

    buckets = {}
    for cid in courses:
        buckets.setdefault(find(cid), []).append(cid)
    n_families = 0
    for members in buckets.values():
        members = sorted(members)
        if len(members) < 2:
            continue
        n_families += 1
        member_set = set(members)
        has_coloc = any(a in member_set and b in member_set for a, b in coloc_edges)
        has_title = any(a in member_set and b in member_set for a, b in title_edges)
        bits = []
        if has_coloc:
            bits.append('CDCS Co-Located')
        if has_title:
            bits.append('matching title and description')
        source = '; '.join(bits) or 'matching title and description'
        for cid in members:
            courses[cid]['crossListings'] = [x for x in members if x != cid]
            courses[cid]['crossListingSource'] = source
    return n_families

cross_list_families = attach_cross_listings(courses, catalog)

os.makedirs(OUT, exist_ok=True)
meta = {'builtOn': FETCH_DATE, 'counts': {
    'courses': len(courses), 'stubCourses': sum(1 for c in courses.values() if c['stub']),
    'clusters': len(clusters), 'programs': len(programs),
    'activePrograms': sum(1 for p in programs if p['status'] == 'ACTIVE'),
    'equivalencyGroups': len(equivalency_groups),
    'activeEquivalencyGroups': sum(1 for g in equivalency_groups if g['status'] == 'ACTIVE'),
    'crossListFamilies': cross_list_families,
}}
json.dump(courses, open(os.path.join(OUT, 'courses.json'), 'w'), separators=(',', ':'))
json.dump(clusters, open(os.path.join(OUT, 'clusters.json'), 'w'), separators=(',', ':'))
json.dump(programs, open(os.path.join(OUT, 'programs.json'), 'w'), indent=1)
json.dump(policy, open(os.path.join(OUT, 'policy.json'), 'w'), indent=1)
json.dump(equivalency_groups, open(os.path.join(OUT, 'equivalency_groups.json'), 'w'), indent=1)
exam_credit_src = os.path.join(SRC, 'exam-credit.json')
if os.path.exists(exam_credit_src):
    exam_credit = json.load(open(exam_credit_src))
    json.dump(exam_credit, open(os.path.join(OUT, 'exam_credit.json'), 'w'), indent=1)
    meta['counts']['examCredit'] = len(exam_credit.get('exams') or [])
json.dump(meta, open(os.path.join(OUT, 'meta.json'), 'w'), indent=1)
print(json.dumps(meta, indent=1))
