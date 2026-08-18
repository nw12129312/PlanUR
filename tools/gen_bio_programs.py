#!/usr/bin/env python3
"""Generate the ten Biology program JSON files in data-src/programs/.

Every requirement below was transcribed from the track's own page (snapshots
in data-src/pages/bio/, fetched 2026-07-06); shared ancillary blocks are
defined once here because the pages state them identically. Judgment calls
are recorded in each program's notes (JSON cannot carry comments) and in the
equivalency-group comments in build_data.py:
  - BIOL 198-vs-190 stays a plain n_of (one requirement slot, both feed the
    same downstream courses per the pages) - NOT an equivalency group.
  - Organic chemistry I and intro physics ARE equivalency groups
    (orgo-sequence, intro-physics) - alternate-rigor paths; see build_data.py.
  - Calculus: Biology needs only a Calc-I-level course, so requirement groups
    use n_of; the existing calc-sequence equivalency group still guards
    against mixing 141/161/171 paths.
Cross-cutting Biology rules (advising page): apIbCreditExcluded,
minMajorGPA 2.0, minPctFromHomeInstitution 50 (ancillary groups exempt via
their ancillary:true flag).
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'data-src', 'programs')
BIO = 'https://www.sas.rochester.edu/bio/undergraduate/'
DATE = '2026-07-06'

def g(id_, label, rule, quote=None, note=None, ancillary=False, allowReuse=False):
    out = {'id': id_, 'label': label, 'rule': rule}
    if quote: out['sourceQuote'] = quote
    if note: out['note'] = note
    if ancillary: out['ancillary'] = True
    if allowReuse: out['allowReuse'] = True
    return out

n_of = lambda n, opts: {'type': 'n_of', 'n': n, 'options': opts}
all_of = lambda cs: {'type': 'all_of', 'courses': cs}
seq = lambda seqs: {'type': 'sequence_one_of', 'sequences': seqs}
div_ref = lambda track, n: {'type': 'n_of', 'n': n, 'optionsRef': f'bio-div:{track}'}

# ---- shared blocks (stated identically on the track pages) ----
INTRO_110_111 = g('intro', 'Introductory biology', all_of(['BIOL 110L', 'BIOL 111L']),
                  'BIOL 110L/098: Principles of Biology I with Lab; BIOL 111L/099: Principles of Biology II with Lab')
GENETICS_CHOICE = g('genetics', 'Genetics', n_of(1, ['BIOL 198', 'BIOL 190']),
                    'BIOL 198 & 198P: Principles of Genetics with Lab; BIOL 190 & 198P: Genetics: From Mendel to Molecules with Lab',
                    'Judgment call: modeled as a one-slot choice (n_of), not an equivalency group - both feed the same downstream requirements.')
GEN_CHEM = g('chem-gen', 'General chemistry', all_of(['CHEM 131', 'CHEM 132']),
             'Both of the following general chemistry courses: CHEM 131: Chemical Concepts I with Lab; CHEM 132: Chemical Concepts II with Lab',
             ancillary=True)
ORGO_1 = g('orgo-1', 'Organic chemistry I (one path)', seq([['CHEM 203', 'CHEM 207'], ['CHEM 171', 'CHEM 173']]),
           'One of the following organic chemistry I courses: CHEM 203/207: Organic Chemistry I with Lab; CHEM 171/173: First Year Organic Chemistry I with Lab',
           'Alternate-rigor paths - also enforced by the orgo-sequence equivalency group (mixing paths is flagged).',
           ancillary=True)
ORGO_2 = g('orgo-2', 'Organic chemistry II (one path)', seq([['CHEM 204', 'CHEM 208'], ['CHEM 172', 'CHEM 210']]),
           'One of the following organic chemistry II courses: CHEM 204/208: Organic Chemistry II with Lab; CHEM 172/208 or 210: First Year Organic Chemistry with Lab',
           'CHEM 172 may pair with CHEM 208 or CHEM 210 as its lab; modeled with 210.',
           ancillary=True)
PHYS_1 = g('phys-1', 'Physics I', n_of(1, ['PHYS 113', 'PHYS 121', 'PHYS 141']),
           'One of the following physics I courses: PHYS 113: General Physics I with Lab; PHYS 121: Mechanics with Lab; PHYS 141: Mechanics (Honors) with Lab',
           'Alternate-rigor variants - also enforced by the intro-physics equivalency group.',
           ancillary=True)
PHYS_2 = g('phys-2', 'Physics II', n_of(1, ['PHYS 114', 'PHYS 122', 'PHYS 142']),
           'One of the following physics II courses: PHYS 114: General Physics II with Lab; PHYS 122: Electricity and Magnetism with Lab; PHYS 142: Electricity and Magnetism (Honors) with Lab',
           ancillary=True)
CALC_1 = g('calc-1', 'Calculus I', n_of(1, ['MATH 141', 'MATH 161', 'MATH 171']),
           'One of the following calculus I courses: MATH 141: Calculus I; MATH 161: Calculus IA; MATH 171Q: Honors Calculus I',
           'Page lists MATH 171Q; the catalog code is MATH 171. Only Calc I is required here (not the full sequence); the calc-sequence equivalency group still prevents mixing paths.',
           ancillary=True)
CALC_2 = g('calc-2', 'Calculus II', n_of(1, ['MATH 142', 'MATH 162', 'MATH 172']),
           'One of the following calculus II courses: MATH 142: Calculus II; MATH 162: Calculus IIA; MATH 172Q: Honors Calculus II',
           'Page lists MATH 172Q; catalog code MATH 172.',
           ancillary=True)
ANC_ELECTIVE_OPTS = ['MATH 164', 'MATH 165', 'MATH 235', 'STAT 180', 'STAT 190', 'STAT 201',
                     'CSC 161', 'CSC 170', 'CSC 171', 'ECE 114']
ANC_ELECTIVE = lambda n: g('anc-elective', f'Ancillary elective{"s" if n > 1 else ""} ({n})',
    n_of(n, ANC_ELECTIVE_OPTS),
    'Math: MATH 164, 165, 235 or other upper-level math with advisor approval (MATH 143 is not acceptable); Statistics: STAT AP, 180, 190, 201 or other upper-level statistics course with advisor approval (STAT 211 is not acceptable); Computer programming: CSC 161, 170, 171, ECE 114 or other computer programming course with advisor approval',
    '"Other courses with advisor approval" are not auto-modeled; MATH 143 and STAT 211 are not acceptable.',
    ancillary=True)
ULW_DEFAULT = {
    'label': 'Two ULW courses (biological/natural sciences)',
    'rule': {'type': 'n_from_filter', 'n': 2,
             'filter': {'depts': ['BIOL', 'BCH', 'MBI', 'NSCI'], 'minNumber': 200, 'maxNumber': 499, 'wOnly': True}},
    'sourceQuote': 'All biology majors must complete two ULW courses. ... Writing courses within the humanities and social sciences cannot be applied to the biology major.',
    'note': 'Department-scoped filter: one natural-sciences W course outside these departments may count with adviser permission (CHEM 210W for biochemistry majors); humanities/social-science W courses never count.',
}

def program(id_, name, url_page, groups, ulw, extra_notes=(), departments=('BIOL',), degree='BS'):
    return {
        'id': id_, 'type': 'major', 'name': name, 'degree': degree,
        'school': 'sas', 'division': 'natural-sciences',
        'departments': list(departments),
        'status': 'ACTIVE',
        'sourceUrl': BIO + url_page,
        'sourcedOn': DATE, 'last_verified': DATE,
        'snapshot': f'data-src/pages/bio/bio_undergraduate_{url_page}',
        'clustersRequired': 2,
        'allowedClusterDivisions': ['humanities', 'social-sciences'],
        'totalCreditsOverride': None,
        'overlapCapOverride': None,
        'apIbCreditExcluded': True,
        'minMajorGPA': 2.0,
        'minPctFromHomeInstitution': 50,
        'notes': [
            'AP Biology (4/5) and IB Biology HL (6/7) earn general credit only - never major/minor requirements (encoded: apIbCreditExcluded).',
            'UR courses must fulfill at least half the concentration requirements; ancillary-field courses are exempt (encoded: minPctFromHomeInstitution + per-group ancillary flags).',
            'Maintain a 2.0 GPA within the major, excluding allied/ancillary field courses (minMajorGPA - informational: the app does not track grades).',
            *extra_notes,
        ],
        'requirementGroups': groups,
        'upperLevelWriting': ulw,
    }

programs = []

# ---------------------------------------------------------------- BA --------
programs.append(program(
    'biol-ba', 'Biology', 'bio.html', [
        INTRO_110_111, GENETICS_CHOICE,
        g('genetics-lab', 'Genetics lab', all_of(['BIOL 198P']), 'BIOL 198P: Principles of Genetics Lab'),
        g('lab-2', 'Second laboratory experience', n_of(1, [
            'BIOL 204P', 'BIOL 217L', 'BIOL 219L', 'BIOL 225', 'BIOL 228A', 'BIOL 228B',
            'BIOL 250P', 'BIOL 253L', 'BIOL 257L', 'BIOL 268', 'BCH 208', 'MBI 221W']),
          'Choose 1 from: BIOL 204P, BIOL 217L, BIOL 219L, BIOL 225, BIOL 228, BIOL 250P, BIOL 253L, BIOL 257L, BIOL 268, ####395 (Independent Research), BCH 208, MBI 221W',
          'Independent research (395) also qualifies with approval - not auto-modeled.'),
        g('adv-eco', 'Advanced: evolution/ecology', n_of(1, ['BIOL 205', 'BIOL 219L', 'BIOL 253L', 'BIOL 260', 'BIOL 263', 'BIOL 267']),
          'Choose 1 evolution/ecology course from: BIOL 205, BIOL 219L, BIOL 253L, BIOL 260, BIOL 263, BIOL 267'),
        g('adv-mol', 'Advanced: molecular/cell/physiology', n_of(1, ['BIOL 202', 'BIOL 204', 'BIOL 210', 'BIOL 226', 'BIOL 250', 'BIOL 252', 'BIOL 278']),
          'Choose 1 from: BIOL 202, BIOL 204, BIOL 210, BIOL 226, BIOL 250, BIOL 250+250P, BIOL 252, BIOL 278'),
        g('diversification', 'Diversification electives (3)', div_ref('ba', 3),
          'Choose 3 from the Diversification Electives list',
          'Options come from the BA page\'s own Fall/Spring diversification list (data-src/bio-diversification.json).'),
        GEN_CHEM, ORGO_1, PHYS_1, CALC_1,
        g('stat', 'Statistics', n_of(1, ['STAT 180', 'STAT 190']),
          'Statistics: choose 1 from STAT 180, STAT 190', ancillary=True),
    ],
    ULW_DEFAULT,
    extra_notes=('BIOL 112L/113L may replace BIOL 110L/111L per department placement.',),
    degree='BA'))

# ---------------------------------------------------------------- BSG -------
programs.append(program(
    'biol-bs-general', 'Biological Sciences: General (BSG) Track', 'bsg.html', [
        INTRO_110_111, GENETICS_CHOICE,
        g('genetics-lab', 'Genetics lab', all_of(['BIOL 198P']), 'BIO 198P: Principles of Genetics Lab'),
        g('lab-2', 'Second laboratory experience', n_of(1, ['BIOL 225', 'MBI 221W', 'BIOL 268', 'BCH 308', 'NSCI 203']),
          'Plus, one of the following: BIOL 225; MBI 221W; BIOL 268; BCH 308; NSCI 203; #### 395: Independent Research',
          'Independent research (395) also qualifies with approval - not auto-modeled.'),
        g('core-biochem', 'Core: biochemistry', n_of(1, ['BIOL 250', 'BIOL 250P', 'BIOL 252']),
          'Select one of the following Biochemistry courses: BIOL 250; BIOL 250P; BIOL 252'),
        g('core-eco', 'Core: evolution/ecology', n_of(1, ['BIOL 205', 'BIOL 260', 'BIOL 263', 'BIOL 267']),
          'Select one of the following: BIOL 205: Evolution; BIOL 260: Animal Behavior; BIOL 263: Ecology; BIOL 267: Human Evolutionary Genetics'),
        g('core-cell', 'Core: physiology/cell/development', n_of(1, ['BIOL 204', 'BIOL 210', 'BIOL 226']),
          'Select one of the following: BIOL 204: Principles of Physiology; BIOL 210: Cell Biology; BIOL 226: Developmental Biology'),
        g('advanced', 'Advanced electives (3)', div_ref('bsg', 3),
          'Select three courses from the BSG advanced electives list.',
          'Options from the BSG page\'s Fall/Spring advanced electives list; at least one advanced/core course must emphasize primary literature (coordinator-determined, not auto-enforced).'),
        GEN_CHEM,
        g('chem-2-alt', 'General chemistry II alternative', n_of(1, ['CHEM 132', 'CHEM 171']),
          'One of the following general chemistry II courses: CHEM 132; CHEM 171',
          'Overlaps general chemistry above per the page\'s CHEM 171/172 first-year-organic pathway.',
          ancillary=True, allowReuse=True),
        ORGO_1, PHYS_1,
        g('phys-prog', 'Physics II or programming (within ancillary electives)', n_of(2, [
            'MATH 150', 'MATH 164', 'MATH 165', 'BIOL 208', 'CSC 161', 'CSC 170', 'CSC 171',
            'CHEM 204', 'CHEM 208', 'PHYS 114', 'PHYS 122', 'PHYS 142',
            'STAT 201', 'STAT 216', 'STAT 277', 'EESC 201']),
          'Select two of the following ancillary electives: Math: MATH 150, 164, or 165; Computer programming: BIOL 208, CSC 161, 170, or 171; Organic chemistry: CHEM 204 ..., 208, or 172/210; Physics: PHYS 114, 122, or 142; Statistics: STAT 201, 216, or 277; Earth and environmental science: EESC 201',
          ancillary=True),
        CALC_1, CALC_2,
        g('stat', 'Statistics', n_of(1, ['STAT 180', 'STAT 190']),
          'One of the following statistics courses: STAT 180 (formerly STAT 212); STAT 190 (formerly STAT 213)', ancillary=True),
    ],
    ULW_DEFAULT,
    extra_notes=('The BSG track does not count PHLT 394E toward the ULW requirement.',)))

# ---------------------------------------------------------------- BBC -------
programs.append(program(
    'biol-bs-biochem', 'Biological Sciences: Biochemistry (BBC) Track', 'bbc.html', [
        INTRO_110_111,
        g('genetics', 'Genetics', all_of(['BIOL 198']), 'BIOL 198: Principles of Genetics'),
        g('lab', 'Laboratory experience', n_of(1, ['BCH 308']),
          'Select one of the following options: BCH 308: Biochemistry Lab and Critical Analysis (formerly BCH 208); Two BCH/BIOL/CHEM #395s: Independent Research',
          'The two-independent-research (395x2) alternative requires advisor approval and is not auto-modeled.'),
        g('adv-core', 'Advanced core', all_of(['BIOL 252', 'BIOL 202', 'IND 408', 'BIOL 278']),
          'All of the following courses are required: BIOL 252; BIOL 202; IND 408: Advanced Biochemistry; BIOL 278',
          'BIOL 278 and BCH 412 overlap in time slots; take BIOL 278 in spring of junior year per the page.'),
        g('adv-macromol', 'Advanced biochemistry elective', n_of(1, ['BCH 412', 'IND 432']),
          'Plus choose one of the following: BCH 412: Advanced Topics in Biological Macromolecules; IND 432: Foundations in Modern Biology II'),
        g('adv-elective', 'Advanced elective', n_of(1, ['BIOL 222', 'BIOL 243', 'CHEM 252', 'CHEM 440', 'IND 447']),
          'Plus choose one of the following: BIOL 222; BIOL 243; CHEM 252; CHEM 440; IND 409 (canceled); IND 447; #### 395',
          '395 can fulfill this only if not used for the lab requirement; IND 409 canceled after fall 2017.'),
        g('diversification', 'Diversification elective (1, outside BBC)', div_ref('bbc', 1),
          'Select one course from the BBC diversification electives list, which must be approved by the track coordinator.'),
        GEN_CHEM, ORGO_1, ORGO_2, PHYS_1, PHYS_2, CALC_1, CALC_2, ANC_ELECTIVE(1),
    ],
    {**ULW_DEFAULT, 'note': 'Biochemistry majors may use CHEM 210W toward one of the two; humanities/social-science W courses never count.'},
    extra_notes=('CHEM 171/173 + 172/208-or-210 with AP credit for CHEM 131 also fulfills the chemistry requirements.',)))

# ---------------------------------------------------------------- BCD -------
programs.append(program(
    'biol-bs-celldev', 'Biological Sciences: Cell and Developmental Biology (BCD) Track', 'bcd.html', [
        INTRO_110_111,
        g('genetics', 'Genetics', all_of(['BIOL 198']), 'BIOL 198: Principles of Genetics'),
        g('lab-half', 'Half lab (UPBM list)', n_of(1, ['BIOL 198P', 'BIOL 204P', 'BIOL 250P']),
          'Select one half lab from UPBM laboratories list. BIOL 198P is highly recommended.',
          'NEEDS VERIFICATION: the UPBM half-lab list is not published inline; known half-labs modeled.'),
        g('lab-main', 'Laboratory experience', n_of(1, ['BIOL 268', 'BIOL 228A', 'BIOL 228B']),
          'Plus one of the following: BIOL 268 (usually junior year); BIOL 228A&B iGEM I&II; Two #### 395s',
          'iGEM requires both 228A and 228B (pairing not auto-enforced); the two-395 alternative is not auto-modeled.'),
        g('adv-biochem', 'Advanced: biochemistry', n_of(1, ['BIOL 250', 'BIOL 252']),
          'One of the following: BIOL 250: Biochemistry; BIOL 252: Principles of Biochemistry'),
        g('adv-core', 'Advanced core', all_of(['BIOL 210', 'BIOL 226']),
          'And: BIOL 210: Cell Biology; BIOL 226: Developmental Biology'),
        g('adv-electives', 'Advanced electives (2)', n_of(2, ['BIOL 220', 'BIOL 222', 'BIOL 243', 'BIOL 278', 'INTD 447', 'MBI 473']),
          'Plus two of the following: BIOL 220; BIOL 222; BIOL 243; BIOL 278; INTD 447: Signal transduction; MBI 473: Immunology'),
        g('diversification', 'Diversification elective (1, outside BCD)', div_ref('bcd', 1),
          'Select one from the BCD diversification electives list, which must be approved by the track coordinator.'),
        GEN_CHEM, ORGO_1, ORGO_2, PHYS_1, PHYS_2, CALC_1, CALC_2, ANC_ELECTIVE(1),
    ], ULW_DEFAULT))

# ---------------------------------------------------------------- BCB -------
programs.append(program(
    'biol-bs-compbio', 'Biological Sciences: Computational Biology (BCB) Track', 'bcb.html', [
        INTRO_110_111, GENETICS_CHOICE,
        g('genetics-lab', 'Genetics lab', all_of(['BIOL 198P']),
          'BIOL 198 & 198P ... BIOL 190 & 198P (both intro options include 198P)'),
        g('stat', 'Statistics (one path)', seq([['STAT 190'], ['STAT 180', 'STAT 216']]),
          'One of the following options: STAT 190; STAT 180 AND STAT 216: Applied Statistics Methods', ancillary=True),
        g('comp-core', 'Computational biology core', all_of(['BIOL 253L', 'BIOL 257L']),
          'Plus: BIOL 253L: Computational Biology with Lab ... Plus: BIOL 257L: Applied Genomics with Lab'),
        g('programming', 'Programming', n_of(1, ['CSC 171', 'CSC 161']),
          'Plus one of the following: CSC 171: Introduction to Computer Science; CSC 161: Introduction to Programming'),
        g('bio-elective', 'Biology elective', n_of(1, ['BIOL 202', 'BIOL 205', 'BIOL 243', 'BIOL 250', 'BIOL 252', 'BIOL 263', 'BIOL 266', 'BIOL 267']),
          'Plus one of the following biology electives: BIOL 202; BIOL 205; BIOL 243; BIOL 250; BIOL 252; BIOL 263; BIOL 266; BIOL 267'),
        g('comp-elective', 'Computational elective', n_of(1, ['CSC 172', 'CSC 240', 'BIOL 219L', 'DSCC 201']),
          'Plus one of the following computational electives: CSC 172; CSC 240; BIOL 219L; DSCC 201 (only open to non-DSCC majors in the spring)'),
        g('extra-elective', 'Additional bio/computational elective', n_of(1, [
            'BIOL 202', 'BIOL 205', 'BIOL 243', 'BIOL 250', 'BIOL 252', 'BIOL 263', 'BIOL 266', 'BIOL 267',
            'CSC 172', 'CSC 240', 'BIOL 219L', 'DSCC 201']),
          'Plus one additional elective from either the biology or computational electives listed above.'),
        g('diversification', 'Diversification elective (1, outside BCB)', div_ref('bcb', 1),
          'One 200-level course outside of the BCB major track, chosen from the BCB diversification electives list.'),
        GEN_CHEM, ORGO_1, PHYS_1, CALC_1, CALC_2,
        g('discrete', 'Discrete mathematics', all_of(['MATH 150']), 'And: MATH 150: Discrete Mathematics', ancillary=True),
    ], ULW_DEFAULT))

# ---------------------------------------------------------------- BEB -------
programs.append(program(
    'biol-bs-ecoevo', 'Biological Sciences: Ecology and Evolutionary Biology (BEB) Track', 'beb.html', [
        INTRO_110_111, GENETICS_CHOICE,
        g('labs', 'Laboratory experience', all_of(['BIOL 198P', 'BIOL 225']),
          'Students are required to take all of the following courses: BIOL 099 (within BIOL 111L); BIOL 198P; BIOL 225'),
        g('adv-core', 'Advanced core', all_of(['BIOL 205', 'BIOL 263']),
          'Both of the following: BIOL 205: Evolution; BIOL 263: Ecology'),
        g('adv-electives', 'Advanced electives (2 minimum)', n_of(2, [
            'BIOL 219L', 'BIOL 253L', 'BIOL 257L', 'BIOL 260', 'BIOL 266', 'BIOL 267', 'EESC 201', 'EESC 220']),
          'Plus two or three advanced electives from the following list: BIOL 219L; BIOL 253L; BIOL 257L; BIOL 260; BIOL 266; BIOL 267; EESC 201; EESC 220 (pending advisor approval)'),
        g('diversification', 'Diversification elective (1 minimum, outside BEB)', div_ref('beb', 1),
          'Select one or two courses from the BEB diversification electives list.',
          'BIOL 217L and BIOL/BME 258 may not satisfy the diversification requirement.'),
        g('adv-flex', 'Flexible slot: third advanced elective OR second diversification', {
            'type': 'n_of', 'n': 1, 'options': sorted(set(
                ['BIOL 219L', 'BIOL 253L', 'BIOL 257L', 'BIOL 260', 'BIOL 266', 'BIOL 267', 'EESC 201', 'EESC 220']))},
          'Majors may take either three advanced electives and one diversification elective, or two advanced electives and two diversification electives.',
          'The flexible fourth course may also come from the diversification list; the app fills it from the advanced list first.'),
        GEN_CHEM, ORGO_1, PHYS_1, CALC_1, CALC_2,
        g('stat', 'Statistics (one path)', seq([['STAT 190'], ['STAT 180', 'STAT 201'], ['STAT 180', 'STAT 216'], ['STAT 180', 'STAT 277']]),
          'The following statistics course: STAT 190 ... STAT 180 is not acceptable, unless one of STAT 201, 216, or 277 is also taken.', ancillary=True),
        g('anc-electives', 'Ancillary electives (2)', n_of(2, [
            'MATH 150', 'MATH 164', 'MATH 165', 'MATH 218', 'CSC 161', 'CSC 170', 'CSC 171', 'ECE 114',
            'CHEM 204', 'CHEM 208', 'PHYS 114', 'PHYS 122', 'PHYS 142', 'STAT 201', 'STAT 216', 'STAT 277']),
          'Plus two of the following ancillary electives: Math: MATH 150, 164, 165, or 218; Computer Programming: CSC 161, 170, 171, ECE 114; Organic Chemistry: CHEM 204 ..., CHEM 208, or CHEM 172 with CHEM 210; Physics: PHY 114, 122, or 142; Statistics: STAT 201, 216, or 277',
          ancillary=True),
    ],
    {
        'label': 'ULW: BIOL 225W plus one more',
        'rule': n_of(2, ['BIOL 225W', 'BIOL 205W', 'BIOL 272W', 'BIOL 274W']),
        'sourceQuote': 'BIOL 225W: Laboratory in Ecology and Evolutionary Biology. And select one from the following: BIOL 205W; BIOL 272W; BIOL 274W',
        'note': 'Track-specific override: BIOL 225W is required as one of the two (which-one not auto-enforced).',
    }))

# ---------------------------------------------------------------- BMB -------
programs.append(program(
    'biol-bs-microbio', 'Biological Sciences: Microbiology (BMB) Track', 'bmb.html', [
        INTRO_110_111,
        g('genetics', 'Genetics with lab', all_of(['BIOL 198', 'BIOL 198P']),
          'BIOL 198 & 198P: Principles of Genetics with Lab'),
        g('lab-half', 'Half lab (UPBM list)', n_of(1, ['BIOL 204P', 'BIOL 250P', 'BIOL 198P']),
          'One half lab from UPBM laboratories list. BIOL 198P is highly recommended.',
          'NEEDS VERIFICATION: UPBM half-lab list not published inline; known half-labs modeled (198P already used by the genetics requirement).'),
        g('micro-lab', 'Microbiology lab', all_of(['MBI 221W']), 'Plus MBI 221W: Microbiology Lab'),
        g('adv-core', 'Advanced core', all_of(['MBI 220']),
          'Students are required to take MBI 220: Introduction to Microbiology.'),
        g('adv-biochem', 'Advanced: biochemistry', n_of(1, ['BIOL 250', 'BIOL 252']),
          'Plus one of the following: BIOL 250: Biochemistry; BIOL 252: Principles of Biochemistry'),
        g('adv-electives', 'Advanced electives (3)', n_of(3, ['MBI 404', 'MBI 414', 'MBI 421', 'MBI 456', 'MBI 473']),
          'Plus three advanced electives: MBI 404; MBI 414; MBI 421; MBI 456; MBI 473'),
        g('diversification', 'Diversification elective (1, outside BMB)', div_ref('bmb', 1),
          'Select one course from the BMB diversification electives list.'),
        GEN_CHEM, ORGO_1, ORGO_2, PHYS_1, PHYS_2, CALC_1, CALC_2, ANC_ELECTIVE(1),
    ],
    {
        'label': 'ULW: MBI 221W plus one biology/natural-sciences W course',
        'rule': n_of(2, ['MBI 221W', 'BIOL 205W', 'BIOL 225W', 'BIOL 272W', 'BIOL 274W', 'CHEM 210W']),
        'sourceQuote': 'Students must take MBI 221W: Introduction to Microbiology, plus one biology or natural sciences ULW course to fulfill their upper-level writing requirement.',
        'note': 'Track-specific override: MBI 221W is required as one of the two; the second may be any biological/natural-sciences W course (known ones modeled).',
    },
    departments=('BIOL', 'MBI')))

# ---------------------------------------------------------------- BMG -------
programs.append(program(
    'biol-bs-molgen', 'Biological Sciences: Molecular Genetics (BMG) Track', 'bmg.html', [
        INTRO_110_111,
        g('genetics', 'Genetics', all_of(['BIOL 198']), 'BIOL 198: Principles of Genetics'),
        g('lab-half', 'Half lab (UPBM list)', n_of(1, ['BIOL 198P', 'BIOL 204P', 'BIOL 250P']),
          'One half lab from UPBM laboratories list. BIOL 198P is highly recommended.',
          'NEEDS VERIFICATION: UPBM half-lab list not published inline; known half-labs modeled.'),
        g('lab-main', 'Laboratory experience', n_of(1, ['BIOL 268', 'BIOL 228A', 'BIOL 228B']),
          'Plus one of the following options: BIOL 268 (usually junior year); BIOL 228A&B iGEM I&II; #### 395 (two courses)',
          'iGEM requires both 228A and 228B (pairing not auto-enforced); the two-395 alternative is not auto-modeled.'),
        g('adv-core', 'Advanced core', all_of(['BIOL 202', 'BIOL 243']),
          'Both of the following: BIOL 202: Molecular Biology; BIOL 243: Eukaryotic Gene Regulation'),
        g('adv-biochem', 'Advanced: biochemistry', n_of(1, ['BIOL 250', 'BIOL 252']),
          'Plus one of the following: BIOL 250 & 250P: Biochemistry and Biochemistry Lab; BIOL 252',
          'BIOL 250 pairs with 250P per the page (pairing not auto-enforced).'),
        g('adv-electives', 'Advanced electives (2)', n_of(2, [
            'BIOL 205', 'BIOL 210', 'BIOL 219L', 'BIOL 222', 'BIOL 226', 'BIOL 257L', 'BIOL 267', 'BIOL 278']),
          'Plus two of the following advanced electives: BIOL 205; BIOL 210; BIOL 219L; BIOL 222; BIOL 226; BIOL 257L; BIOL 267; BIOL 278'),
        g('diversification', 'Diversification elective (1, outside BMG)', div_ref('bmg', 1),
          'Select one course from the BMG diversification electives list.'),
        GEN_CHEM, ORGO_1, ORGO_2, PHYS_1, PHYS_2, CALC_1, CALC_2, ANC_ELECTIVE(1),
    ], ULW_DEFAULT))

# ---------------------------------------------------------------- BNS -------
programs.append(program(
    'biol-bs-neuro', 'Biological Sciences: Neuroscience Track', 'bns.html', [
        g('intro-bio-1', 'Introductory biology I', n_of(1, ['BIOL 110L', 'BIOL 110']),
          'One of the following: BIOL 110: Principles of Biology I (Spring); BIOL 110L: Principles of Biology I with lab (Fall)'),
        g('intro-bio-2', 'Introductory biology II', all_of(['BIOL 111L']),
          'Plus BIOL 111L: Principles of Biology II with lab (Spring)'),
        GENETICS_CHOICE,
        g('biochem', 'Biochemistry', n_of(1, ['BIOL 250', 'BIOL 252']),
          'One of the following: BIOL 250: Biochemistry (Spring); BIOL 252: Principles of Biochemistry (Spring)',
          'BIOL 198P and BIOL 250P labs are recommended but not required.'),
        g('diversification', 'Biology diversification elective (outside neuroscience)', {
            'type': 'n_from_filter', 'n': 1,
            'filter': {'depts': ['BIOL', 'MBI', 'BCH'], 'minNumber': 200, 'maxNumber': 499, 'minCredits': 4}},
          'Students are required to take one biology diversification elective ... from within the biological sciences, but from outside the neuroscience curriculum. The diversification elective must be 200-level or higher and 4 credits.'),
        g('core', 'Neuroscience core', all_of(['NSCI 201', 'NSCI 201P', 'NSCI 203']),
          'NSCI 201 & 201P: Basic Neurobiology with lab (Fall); NSCI 203: Laboratory in Neurobiology (Spring)'),
        g('seminar', 'Senior seminar', n_of(1, ['NSCI 301', 'NSCI 302']),
          'NSCI 301 or NSCI 302: Senior Seminar in Neuroscience (Fall or Spring)'),
        g('electives', 'Neuroscience electives (4)', n_of(4, [
            'NSCI 242', 'NSCI 243', 'NSCI 244', 'NSCI 245', 'NSCI 246', 'NSCI 247', 'NSCI 249',
            'NSCI 250', 'NSCI 251', 'NSCI 252', 'NSCI 257', 'NSCI 280', 'BME 415', 'IND 447']),
          'Neuroscience Electives (4 courses): NSCI 242; NSCI 243; NSCI 244; NSCI 245; NSCI 246; NSCI 247; NSCI 249; NSCI 250; NSCI 251; NSCI 252; NSCI 257; NSCI 280; BME 415; IND 447U',
          'NSCI 241 is no longer available (valid if previously completed); BME 415 on hiatus until 2026.'),
        GEN_CHEM, ORGO_1,
        g('stat', 'Statistics', n_of(1, ['STAT 180', 'STAT 190']),
          'One of the following statistics courses: STAT 180 (AP credits acceptable); STAT 190; STAT 212 (no longer available)', ancillary=True),
        g('allied', 'Additional allied field courses (4, from 2+ categories)', {
            'type': 'n_from_filter', 'n': 4,
            'filter': {'depts': ['CHEM', 'CSC', 'MATH', 'STAT', 'PHYS', 'BCSC', 'DSCC'], 'minNumber': 140, 'maxNumber': 499,
                       'exclude': ['CHEM 131', 'CHEM 132', 'CHEM 203', 'CHEM 207', 'CHEM 171', 'CHEM 173']}},
          'Four additional allied field courses, chosen from at least two of the following categories: Chemistry ... (full category lists on the BCS neuroscience page)',
          'NEEDS nuance: the two-category minimum and exact per-category lists are not auto-enforced; filter approximates the allowed departments.'),
    ],
    {
        'label': 'Two ULW courses (biological/natural sciences)',
        'rule': {'type': 'n_from_filter', 'n': 2,
                 'filter': {'depts': ['NSCI', 'BIOL', 'BCH', 'MBI'], 'minNumber': 200, 'maxNumber': 499, 'wOnly': True}},
        'sourceQuote': 'All biology majors must complete two ULW courses (per the shared UPBM requirement).',
        'note': 'Neuroscience is administered by BCS; ULW specifics follow the UPBM biology rule.',
    },
    departments=('BIOL', 'NSCI'),
    extra_notes=(
        'Administered by the Department of Brain and Cognitive Sciences; requirements sourced from the BCS neuroscience page (snapshot data-src/pages/bcs/bcs_undergraduate_.._neuro_requirements.html).',
        'Twenty courses total; independent study credits (e.g. NSCI 395) may not substitute for any major requirement.',
        'First-year organic students may substitute CHEM 172 (with CHEM 208 or CHEM 210W lab) for CHEM 132.',
    )))
# fix the source URL for neuro - the bio page is a pointer; the real page is BCS's
programs[-1]['sourceUrl'] = 'https://www.sas.rochester.edu/bcs/neuro/requirements.html'
programs[-1]['snapshot'] = 'data-src/pages/bcs/bcs_undergraduate_.._neuro_requirements.html'

# ---------------------------------------------------------------- CTS -------
programs.append(program(
    'biol-bs-clintrans', 'Clinical and Translational Sciences', 'cts.html', [
        g('foundations', 'Foundational courses', all_of(['BIOL 110L', 'BIOL 111L', 'CHEM 131', 'CHEM 132']),
          'All of the following courses: BIOL 110: Principles of Biology I; BIOL 111: Principles of Biology II; CHEM 131; CHEM 132'),
        g('core-fixed', 'Core: epidemiology, statistics, physiology', all_of(['PHLT 103', 'STAT 180', 'BIOL 204']),
          'Six of the following courses: PHLT 103: Concepts of Epidemiology; STAT 180; ... BIOL 204: Principles of Human Physiology'),
        g('core-ethics', 'Core: ethics', n_of(1, ['PHIL 225', 'PHIL 228']),
          'PHIL 225: Medical Ethics or PHIL 228: Public Health Ethics (instructor permission required)'),
        g('core-orgo', 'Core: organic chemistry I', n_of(1, ['CHEM 203', 'CHEM 171']),
          'CHEM 203: Organic Chemistry I or CHEM 171: First-Year Organic Chemistry I'),
        g('core-genetics', 'Core: genetics', n_of(1, ['BIOL 198', 'BIOL 190']),
          'BIOL 198: Principles of Genetics or BIOL 190: Genetics: From Mendel to Molecules'),
        g('seminar', 'Research seminar (two semesters)', all_of(['CTSC 299', 'CTSC 299W']),
          'Plus both of the following: CTSC 299W: Research Seminar in Translational Sciences; CTSC 299 (CTS juniors or seniors only)'),
        g('orgo-lab', 'Organic chemistry lab (1 credit)', n_of(1, ['CHEM 207', 'CHEM 173']),
          'Plus one of the following one credit labs: CHEM 207: Organic Chem I: Lab; CHEM 173: First-Year Organic Chem I Lab'),
        g('elective-clinical', 'Elective: clinical research methods (1+)', n_of(1, [
            'STAT 276', 'CSC 161', 'DSCC 201', 'BIOL 253L', 'DSCC 210', 'PM 415U', 'PM 488', 'BST 465']),
          'Choose at least one from this group: STAT 276; CSC 161; DSCC 201 or BIOL 253; DSCC 210; PM 415U; PM 488; BST 465'),
        g('elective-population', 'Elective: population sciences (exactly 1)', n_of(1, [
            'PHLT 116', 'PHLT 236', 'HIST 383W', 'PM 412', 'PM 414', 'PM 418', 'PM 424', 'PM 451', 'PM 489', 'PHLT 394E']),
          'Choose only one from this group: PHLT 116; PHLT 236; PHLT 216 (valid until spring 2022); HIST 383W; PM 412; PM 414; PM 418; PM 424; PM 451; PM 489; PHLT 394E',
          'The choose-ONLY-one cap is honored by giving the flexible slots no population-sciences options.'),
        g('elective-flex', 'Electives: two more (clinical methods or biomedical sciences)', n_of(2, [
            'STAT 276', 'CSC 161', 'DSCC 201', 'BIOL 253L', 'DSCC 210', 'PM 415U', 'PM 488', 'BST 465',
            'CHEM 204', 'CHEM 172', 'BIOL 202', 'BIOL 210', 'BIOL 222', 'BIOL 226', 'BIOL 250', 'MBI 220', 'MBI 221W']),
          'Students must take a total of FOUR of the following, with at least one from clinical research methods and one from population sciences. Biomedical Sciences Electives: CHEM 204 or CHEM 172; BIOL 202; BIOL 210; BIOL 222; BIOL 226; BIOL 250; MBI 220; MBI 221W'),
    ],
    {
        'label': 'ULW: CTSC 299W plus one more W course in the major',
        'rule': n_of(2, ['CTSC 299W', 'HIST 383W', 'PM 418W', 'PM 424W', 'PM 451W', 'PM 489W', 'MBI 221W']),
        'sourceQuote': 'Students will be required to register for two upper-level writing courses within this major, one of which is CTSC 299W: Research Seminar in Translational Sciences.',
        'note': 'CTSC 299W is required as one of the two (also part of the seminar requirement); PM W-sections cap at five students.',
    },
    departments=('BIOL', 'CTSC'),
    extra_notes=(
        'Eight full-credit required courses (CTSC 299 spans two semesters), one 1-credit lab, and four electives; satisfies the natural science division of the Rochester Curriculum per the page.',
        'Declaration requires three of PHLT 103 / STAT 180 / CHEM 203 / BIOL 198 (or 190) / BIOL 204 with a 2.0 average; S/F-graded courses cannot apply.',
        'Transfer credit must be approved BEFORE taking courses elsewhere, including ancillary requirements.',
    )))

os.makedirs(OUT, exist_ok=True)
for p in programs:
    path = os.path.join(OUT, f"{p['id']}.json")
    json.dump(p, open(path, 'w'), indent=1)
    print('wrote', os.path.basename(path), f"({len(p['requirementGroups'])} groups)")
