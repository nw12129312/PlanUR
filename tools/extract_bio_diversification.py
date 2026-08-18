#!/usr/bin/env python3
"""Extract each Biology track's Diversification/Advanced Electives list from
its snapshot page, preserving the Fall/Spring split, into
data-src/bio-diversification.json:

  { "<track>": { "fall": ["BIOL 204", ...], "spring": [...] } }

Referenced from program JSON via rule {"type": "n_of", "optionsRef":
"bio-div:<track>"} (resolved in build_data.py, options = fall+spring). The
split is preserved here so it can be audited against the catalog's actual
offering terms - term validation itself uses CDCS data on each course.
"""
import re, html, json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
PAGES = os.path.join(HERE, '..', 'data-src', 'pages', 'bio')
OUT = os.path.join(HERE, '..', 'data-src', 'bio-diversification.json')

code_re = re.compile(r'\b([A-Z]{2,5})\s?(\d{3}[A-Z]{0,2})\b')

def page_text(path):
    return subprocess.run(['python3', os.path.join(HERE, 'page_text.py'), path],
                          capture_output=True, text=True).stdout

def extract(track, fname, header='Diversification Electives List'):
    text = page_text(os.path.join(PAGES, fname))
    m = re.search(re.escape(header) + r'(.*?)(?:$)', text, re.S)
    if not m:
        return None
    seg = m.group(1)
    parts = re.split(r'\bSpring\b', seg, maxsplit=1)
    fall_part = re.split(r'\bFall\b', parts[0], maxsplit=1)
    fall_txt = fall_part[1] if len(fall_part) > 1 else parts[0]
    spring_txt = parts[1] if len(parts) > 1 else ''

    def codes(t):
        out = []
        for line in t.split('\n'):
            line = line.strip()
            if not line.startswith('•'):
                continue
            # "BIOL 228A&B" -> 228A + 228B; "CHEM/BIOL 275" -> both depts
            line2 = re.sub(r'(\d{3})A&B', r'\g<1>A \g<1>B', line)
            mm = re.match(r'•\s*([A-Z]{2,5}(?:/[A-Z]{2,5})?)\s?(\d{3}[A-Z]{0,2})', line2)
            if not mm:
                continue
            for dept in mm.group(1).split('/'):
                c = f'{dept} {mm.group(2)}'
                if c not in out:
                    out.append(c)
            # second code on the expanded A&B line
            m2 = re.findall(r'\b(\d{3}[A-Z])\b', line2)
            if 'A&B' in line:
                base = mm.group(2)[:3]
                for suf in ('A', 'B'):
                    c = f'{mm.group(1).split("/")[0]} {base}{suf}'
                    if c not in out:
                        out.append(c)
        return out

    return {'fall': codes(fall_txt), 'spring': codes(spring_txt)}

result = {}
for track, fname in [
    ('ba', 'bio_undergraduate_bio.html'),
    ('bsg', 'bio_undergraduate_bsg.html'),
    ('bbc', 'bio_undergraduate_bbc.html'),
    ('bcd', 'bio_undergraduate_bcd.html'),
    ('bcb', 'bio_undergraduate_bcb.html'),
    ('beb', 'bio_undergraduate_beb.html'),
    ('bmb', 'bio_undergraduate_bmb.html'),
    ('bmg', 'bio_undergraduate_bmg.html'),
]:
    r = extract(track, fname)
    if r is None and track == 'bsg':
        r = extract(track, fname, header='Advanced Electives List')
    if r:
        result[track] = r
        print(f'{track}: fall={len(r["fall"])} spring={len(r["spring"])}')
    else:
        print(f'{track}: NO LIST FOUND on page')

json.dump(result, open(OUT, 'w'), indent=1)
print('wrote', OUT)
