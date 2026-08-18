#!/usr/bin/env python3
"""Fetch exactly the requirement URLs named in the program directory sheet that
are not already captured under data-src/pages/, and merge them into the manifest.

Unlike crawl_requirements.py (which walks department sites and REWRITES the
manifest) this takes an explicit URL list and merges by url, so nothing already
captured is lost. Feed it the JSON emitted by the work-list reconciliation:

    python3 tools/fetch_missing.py urls.json      # [{"name":..., "missing":[url,...]}]
    python3 tools/fetch_missing.py <url> [<url>]  # or plain URLs
"""
import subprocess, re, html, json, os, sys, time, urllib.parse
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
PAGES = os.path.join(HERE, '..', 'data-src', 'pages')
MANIFEST = os.path.join(PAGES, 'manifest.json')

SLUG_OVERRIDE = {
    'cs.rochester.edu': 'csc', 'writing.rochester.edu': 'wrt', 'cvs.rochester.edu': 'cvs',
    'esm.rochester.edu': 'esm', 'son.rochester.edu': 'son', 'admissions.rochester.edu': 'warner',
}


def slug_for(url):
    p = urllib.parse.urlparse(url)
    host = p.netloc.replace('www.', '')
    if host in SLUG_OVERRIDE:
        return SLUG_OVERRIDE[host]
    parts = [x for x in p.path.split('/') if x]
    if parts and parts[0] == 'college' and len(parts) > 1:
        return parts[1]
    return parts[0] if parts else 'misc'


def fname(url):
    tail = re.sub(r'https?://[^/]+/', '', url).strip('/') or 'index'
    tail = re.sub(r'[^A-Za-z0-9._-]', '_', tail)[:80]
    if not tail.endswith(('.html', '.php')):
        tail += '.html'
    return tail


def fetch(url, timeout=25):
    r = subprocess.run(['curl', '-sL', '--max-time', str(timeout), '-w', '\n%{http_code}', url],
                       capture_output=True, text=True)
    body, _, code = r.stdout.rpartition('\n')
    return body, code.strip()


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return
    urls = []
    if args[0].endswith('.json'):
        for rec in json.load(open(args[0])):
            urls.extend(rec.get('missing') or [])
    else:
        urls = args
    urls = sorted({u for u in urls if u.startswith('http')})

    manifest = json.load(open(MANIFEST)) if os.path.exists(MANIFEST) else []
    by_url = {m['url']: m for m in manifest}
    added = failed = 0

    for url in urls:
        if url in by_url:
            continue
        body, code = fetch(url)
        time.sleep(0.35)
        if code != '200' or len(body) < 500:
            print(f'  FAIL {code:>3} {url}', flush=True)
            failed += 1
            continue
        slug = slug_for(url)
        os.makedirs(os.path.join(PAGES, slug), exist_ok=True)
        f = fname(url)
        open(os.path.join(PAGES, slug, f), 'w').write(body)
        t = re.search(r'<title>([^<]*)</title>', body)
        by_url[url] = {'dept': slug, 'url': url, 'file': f'{slug}/{f}',
                       'title': html.unescape(t.group(1)).strip() if t else '',
                       'fetchedOn': str(date.today()), 'bytes': len(body)}
        added += 1
        print(f'  ok  {slug}/{f}', flush=True)

    merged = sorted(by_url.values(), key=lambda m: (m['dept'], m['url']))
    json.dump(merged, open(MANIFEST, 'w'), indent=1)
    print(f'DONE: +{added} fetched, {failed} failed; manifest now {len(merged)}', flush=True)


if __name__ == '__main__':
    main()
