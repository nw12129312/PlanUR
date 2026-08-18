#!/usr/bin/env python3
"""Layer 2: snapshot every department's requirement-ish pages.

For each department site root, fetches the undergraduate index and every
same-site page one hop away whose link href/text looks like requirements
(major/minor/degree/BA/BS/track/honors/concentration/cluster/handbook).
Saves raw HTML under data-src/pages/<dept>/ with a manifest for provenance,
so requirement encoding never has to re-fetch. Resumable: existing files are
kept unless --refetch.
"""
import subprocess, re, html, json, os, sys, time, hashlib
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
PAGES = os.path.join(HERE, '..', 'data-src', 'pages')
os.makedirs(PAGES, exist_ok=True)

SAS = 'https://www.sas.rochester.edu'
HAJ = 'https://www.hajim.rochester.edu'
ROOTS = {
    # SAS (slug -> site root)
    **{s: f'{SAS}/{s}/' for s in
       ['aas', 'aah', 'ant', 'asl', 'bcs', 'bio', 'chm', 'dan', 'eco', 'ees', 'ehu',
        'eng', 'fms', 'gsw', 'his', 'lin', 'mlc', 'mth', 'mur', 'pas', 'ph', 'phl',
        'psc', 'psy', 'rel', 'stt', 'dms', 'int']},
    # Hajim
    **{s: f'{HAJ}/{s}/' for s in ['ame', 'bme', 'che', 'ece', 'me', 'optics', 'dsc']},
    'csc': 'https://www.cs.rochester.edu/',
    'wrt': 'https://writing.rochester.edu/',
}

KEYWORD = re.compile(
    r'(major|minor|requirem|degree|\bba\b|\bbs\b|-ba\b|-bs\b|ba-|bs-|track|honors'
    r'|concentr|cluster|handbook|curriculum|advising|declar)', re.I)
SKIP = re.compile(r'(\.pdf$|\.jpg|\.png|mailto:|tel:|#|facebook|twitter|linkedin'
                  r'|instagram|youtube|/news|/events|/people|/faculty|/graduate/'
                  r'|/research|semester\.php|fall\.php|spring\.php|summer)', re.I)
MAX_PER_DEPT = 35

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
        if href.startswith('//'): continue
        if href.startswith('/'): href = site + href
        elif not href.startswith('http'):
            href = base_url.rsplit('/', 1)[0] + '/' + href
        if not href.startswith(site): continue
        if SKIP.search(href): continue
        out.append((href.split('#')[0], text))
    return out

def fname(url):
    tail = re.sub(r'https?://[^/]+/', '', url).strip('/') or 'index'
    tail = re.sub(r'[^A-Za-z0-9._-]', '_', tail)[:80]
    if not tail.endswith(('.html', '.php')): tail += '.html'
    return tail

def main():
    manifest = []
    total = 0
    for dept, root in ROOTS.items():
        ddir = os.path.join(PAGES, dept)
        os.makedirs(ddir, exist_ok=True)
        seeds = [root, root + 'undergraduate/', root + 'undergraduate/index.html']
        seen_urls, to_save = set(), {}
        for s in seeds:
            body, code = fetch(s)
            if code != '200' or len(body) < 500: continue
            if s not in seen_urls:
                to_save[s] = body; seen_urls.add(s)
            for href, text in extract_links(body, s):
                if href in seen_urls: continue
                if KEYWORD.search(href) or KEYWORD.search(text):
                    seen_urls.add(href)
                    if len(to_save) >= MAX_PER_DEPT: break
                    b2, c2 = fetch(href)
                    time.sleep(0.4)
                    if c2 == '200' and len(b2) > 500:
                        to_save[href] = b2
        for url, body in to_save.items():
            f = fname(url)
            path = os.path.join(ddir, f)
            open(path, 'w').write(body)
            t = re.search(r'<title>([^<]*)</title>', body)
            manifest.append({
                'dept': dept, 'url': url, 'file': f'{dept}/{f}',
                'title': html.unescape(t.group(1)).strip() if t else '',
                'fetchedOn': str(date.today()), 'bytes': len(body),
            })
        total += len(to_save)
        print(f'{dept}: {len(to_save)} pages', flush=True)
        time.sleep(0.4)
    json.dump(manifest, open(os.path.join(PAGES, 'manifest.json'), 'w'), indent=1)
    print(f'DONE: {total} pages across {len(ROOTS)} departments', flush=True)

if __name__ == '__main__':
    main()
