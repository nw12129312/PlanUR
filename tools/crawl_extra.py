#!/usr/bin/env python3
"""Additive companion to crawl_requirements.py for programs whose pages live
outside the department-site pattern that crawler walks (Simon/BSB, the MSC
certificate pages, CVS, Eastman, Nursing, Warner, one-off minors).

Unlike crawl_requirements.py this NEVER rewrites the manifest wholesale - it
merges, keyed by url, so the 299 pages already captured stay put. Resumable:
files already on disk are kept unless --refetch.
"""
import subprocess, re, html, json, os, sys, time
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
PAGES = os.path.join(HERE, '..', 'data-src', 'pages')
MANIFEST = os.path.join(PAGES, 'manifest.json')

# slug -> seed URLs. One hop of same-site requirement-ish links is followed
# from each seed, same as the main crawler.
SEEDS = {
    'bsb': ['https://www.sas.rochester.edu/bsb/undergraduate/index.html',
            'https://www.sas.rochester.edu/bsb/undergraduate/bs-degree.html',
            'https://www.sas.rochester.edu/bsb/undergraduate/ba-degree.html',
            'https://www.sas.rochester.edu/bsb/undergraduate/minor.html'],
    'aths': ['https://www.sas.rochester.edu/aths/undergraduate/minor.html',
             'https://www.sas.rochester.edu/aths/'],
    'jst': ['http://www.sas.rochester.edu/jst/undergrad/minors.html',
            'https://www.sas.rochester.edu/jst/'],
    'lacx': ['https://www.sas.rochester.edu/lacx/undergraduate/major.html',
             'https://www.sas.rochester.edu/lacx/'],
    'msc': ['https://www.rochester.edu/college/msc/index.html',
            'https://www.rochester.edu/college/msc/certificates/actuarial.html',
            'https://www.rochester.edu/college/msc/certificates/user-experience.html',
            'https://www.rochester.edu/college/msc/major-minor/latin-american-studies-minor.html',
            'https://www.rochester.edu/college/msc/major-minor/clinical-translational-sciences.html'],
    'mas': ['https://www.rochester.edu/college/mas/minor.html',
            'https://www.rochester.edu/college/mas/'],
    'cvs': ['https://www.cvs.rochester.edu/training/undergraduate.html'],
    'theatre': ['https://www.sas.rochester.edu/theatre/academics/stage-management.html',
                'https://www.sas.rochester.edu/theatre/academics/'],
    'sus': ['https://www.sas.rochester.edu/sus/', 'https://www.sas.rochester.edu/sus/undergraduate/'],
    'phlt': ['https://www.rochester.edu/college/ph/undergrad/majors/epidemiology.html',
             'https://www.rochester.edu/college/ph/undergrad/'],
    'hajim': ['https://www.hajim.rochester.edu/undergraduate/eas-bs.html',
              'http://www.hajim.rochester.edu/undergraduate/es-ba.html',
              'https://www.hajim.rochester.edu/undergraduate/'],
    'matsci': ['https://www.hajim.rochester.edu/matsci/'],
    'esm': ['https://www.esm.rochester.edu/admissions/ugrad/',
            'https://www.esm.rochester.edu/composition/',
            'https://www.esm.rochester.edu/jazz/',
            'https://www.esm.rochester.edu/jazz/jazz-voice/',
            'https://www.esm.rochester.edu/go/soundarts/music-technology/',
            'https://www.esm.rochester.edu/mtl/',
            'https://www.esm.rochester.edu/theory/'],
    'son': ['https://son.rochester.edu/academics/accelerated-nursing-programs/absn/index.html',
            'https://son.rochester.edu/academics/rn-bs-completion-program/index.html'],
    'warner': ['https://admissions.rochester.edu/academics/grade/'],
}

KEYWORD = re.compile(
    r'(major|minor|requirem|degree|\bba\b|\bbs\b|-ba\b|-bs\b|ba-|bs-|track|honors'
    r'|concentr|cluster|handbook|curriculum|certificate|program)', re.I)
SKIP = re.compile(r'(\.pdf$|\.jpg|\.png|mailto:|tel:|facebook|twitter|linkedin'
                  r'|instagram|youtube|/news|/events|/people|/faculty|/graduate/'
                  r'|/research|/apply|/visit|/give)', re.I)
MAX_PER_SLUG = 25


def fetch(url, timeout=25):
    r = subprocess.run(['curl', '-sL', '--max-time', str(timeout), '-w', '\n%{http_code}', url],
                       capture_output=True, text=True)
    body, _, code = r.stdout.rpartition('\n')
    return body, code.strip()


def extract_links(src, base_url):
    site = re.match(r'(https?://[^/]+)', base_url).group(1)
    out = []
    for m in re.finditer(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', src, re.S | re.I):
        href, text = m.group(1), re.sub(r'<[^>]+>', ' ', m.group(2))
        text = html.unescape(re.sub(r'\s+', ' ', text)).strip()
        if href.startswith('//') or href.startswith('#'):
            continue
        if href.startswith('/'):
            href = site + href
        elif not href.startswith('http'):
            href = base_url.rsplit('/', 1)[0] + '/' + href
        if not href.startswith(site) or SKIP.search(href):
            continue
        out.append((href.split('#')[0], text))
    return out


def fname(url):
    tail = re.sub(r'https?://[^/]+/', '', url).strip('/') or 'index'
    tail = re.sub(r'[^A-Za-z0-9._-]', '_', tail)[:80]
    if not tail.endswith(('.html', '.php')):
        tail += '.html'
    return tail


def main():
    refetch = '--refetch' in sys.argv
    manifest = json.load(open(MANIFEST)) if os.path.exists(MANIFEST) else []
    by_url = {m['url']: m for m in manifest}
    added = 0

    for slug, seeds in SEEDS.items():
        ddir = os.path.join(PAGES, slug)
        os.makedirs(ddir, exist_ok=True)
        to_save, seen = {}, set()
        for s in seeds:
            if s in seen:
                continue
            seen.add(s)
            body, code = fetch(s)
            time.sleep(0.4)
            if code != '200' or len(body) < 500:
                print(f'  {slug}: seed {code} {s}', flush=True)
                continue
            to_save[s] = body
            for href, text in extract_links(body, s):
                if href in seen or len(to_save) >= MAX_PER_SLUG:
                    continue
                if not (KEYWORD.search(href) or KEYWORD.search(text)):
                    continue
                seen.add(href)
                b2, c2 = fetch(href)
                time.sleep(0.35)
                if c2 == '200' and len(b2) > 500:
                    to_save[href] = b2

        for url, body in to_save.items():
            f = fname(url)
            path = os.path.join(ddir, f)
            if os.path.exists(path) and not refetch and url in by_url:
                continue
            open(path, 'w').write(body)
            t = re.search(r'<title>([^<]*)</title>', body)
            entry = {'dept': slug, 'url': url, 'file': f'{slug}/{f}',
                     'title': html.unescape(t.group(1)).strip() if t else '',
                     'fetchedOn': str(date.today()), 'bytes': len(body)}
            if url in by_url:
                by_url[url].update(entry)
            else:
                by_url[url] = entry
                added += 1
        print(f'{slug}: {len(to_save)} pages fetched', flush=True)

    merged = sorted(by_url.values(), key=lambda m: (m['dept'], m['url']))
    json.dump(merged, open(MANIFEST, 'w'), indent=1)
    print(f'DONE: +{added} new pages; manifest now {len(merged)} entries', flush=True)


if __name__ == '__main__':
    main()
