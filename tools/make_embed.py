#!/usr/bin/env python3
"""Convert dist/index.html (vite single-file build) into dist/embed.html:
body-only content (title + inlined styles + root div + inlined module script)
suitable for embedding in a host page that supplies the document shell.
"""
import re, os

HERE = os.path.dirname(os.path.abspath(__file__))
src_path = os.path.join(HERE, '..', 'dist', 'index.html')
out_path = os.path.join(HERE, '..', 'dist', 'embed.html')

html = open(src_path).read()
styles = re.findall(r'<style[^>]*>.*?</style>', html, re.S)
scripts = re.findall(r'<script type="module"[^>]*>.*?</script>', html, re.S)
assert styles and scripts, 'expected inlined style and module script in dist/index.html'

parts = [
    '<title>UR Schedule Builder</title>',
    *styles,
    '<div id="root"></div>',
    *scripts,
]
open(out_path, 'w').write('\n'.join(parts))
print(f'wrote {out_path} ({os.path.getsize(out_path)} bytes)')
