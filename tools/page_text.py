#!/usr/bin/env python3
"""Print the readable text of a snapshotted page (main content, tags stripped).
Usage: python3 tools/page_text.py [--max N|--full] data-src/pages/eco/eco_undergraduate_major.html [more...]

Output is capped at 12000 chars by default. Long requirement pages (business tracks,
public-health themes, the dance major) run past that and the tail is SILENTLY lost —
pass --full when encoding a program so no requirement category goes missing."""
import re, html, sys

args = sys.argv[1:]
cap = 12000
while args and args[0].startswith('--'):
    flag = args.pop(0)
    if flag == '--full':
        cap = None
    elif flag == '--max':
        cap = int(args.pop(0))
    else:
        sys.exit(f'unknown flag {flag}')

for path in args:
    src = open(path, errors='replace').read()
    # cut site chrome: keep from <main> or first <h1> to footer
    m = re.search(r'<main[^>]*>(.*?)</main>', src, re.S | re.I)
    body = m.group(1) if m else src
    body = re.sub(r'<(script|style|nav|header|footer)[^>]*>.*?</\1>', ' ', body, flags=re.S | re.I)
    body = re.sub(r'<li[^>]*>', '\n• ', body)
    body = re.sub(r'<(h[1-4])[^>]*>', '\n\n## ', body)
    body = re.sub(r'<(p|div|tr|br|table)[^>]*>', '\n', body)
    text = re.sub(r'<[^>]+>', ' ', body)
    text = html.unescape(text)
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n\s*\n+', '\n\n', text)
    text = text.strip()
    print(f'\n===== {path} ({len(text)} chars) =====')
    print(text if cap is None else text[:cap])
    if cap is not None and len(text) > cap:
        print(f'\n[... TRUNCATED at {cap} of {len(text)} chars — rerun with --full ...]')
