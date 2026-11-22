#!/usr/bin/env python3
"""Stamp the one shared public header (tools/site-header.html = the live homepage header) onto every
public page, so the menus cannot drift. Run after editing site-header.html; check.py verifies it.
Pages keep any extra classes on the old <nav> (dual-pub, cx-pubnav). Idempotent."""
import os, re, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HDR = open(os.path.join(ROOT, 'tools', 'site-header.html'), encoding='utf-8').read().strip()
DL = '<script src="/assets/dl-menu.js?v=%s" defer></script>'
OPEN = re.compile(r'<(nav|header)\b[^>]*id="site-nav"[^>]*>')

def pages():
    out = subprocess.check_output(['git', 'ls-files', '*.html'], cwd=ROOT, text=True).split()
    return [os.path.join(ROOT, f) for f in out if not f.startswith(('node_modules/', 'android/', 'tools/'))]

def build(extra):
    h = HDR
    if extra:
        h = h.replace('<header class="hn"', '<header class="hn ' + ' '.join(extra) + '"', 1)
    return h

def stamp(s, v):
    m = OPEN.search(s)
    if not m:
        return s
    cls = re.search(r'class="([^"]*)"', m.group(0)).group(1).split()
    extra = [c for c in cls if c not in ('nav', 'hn')]
    end = s.index('</nav>' if m.group(1) == 'nav' else '</header>', m.end()) + len('</nav>' if m.group(1) == 'nav' else '</header>')
    tail = re.compile(r'\s*<script src="/?assets/dl-menu\.js[^>]*></script>').match(s, end)
    if tail:
        end = tail.end()
    s = s[:m.start()] + build(extra) + DL % v + s[end:]
    # head/body assets
    s = re.sub(r'[ \t]*<link rel="stylesheet" href="(/?)assets/nav-features\.css[^>]*>\n?', '', s)
    s = re.sub(r'[ \t]*<script src="(/?)assets/nav-features\.js[^>]*></script>\n?', '', s)
    s = re.sub(r'[ \t]*<link rel="stylesheet" href="/?assets/site-header\.css[^>]*>\n?', '', s)
    s = re.sub(r'[ \t]*<script src="/?assets/(home-a|menu-hover)\.js[^>]*></script>\n?', '', s)
    s = re.sub(r'([ \t]*)(<link rel="stylesheet" href="/?assets/style\.css[^>]*>\n)', lambda k: k.group(0) + k.group(1) + '<link rel="stylesheet" href="/assets/site-header.css?v=%s">\n' % v, s, 1)
    js = '<script src="/assets/home-a.js?v=%s" defer></script>\n<script src="/assets/menu-hover.js?v=%s" defer></script>\n' % (v, v)
    s = s.replace('</body>', js + '</body>', 1)
    return s

def main():
    v = re.search(r'style\.css\?v=(\d+)', open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()).group(1)
    n = 0
    for p in pages():
        s = open(p, encoding='utf-8').read()
        t = stamp(s, v)
        if t != s:
            open(p, 'w', encoding='utf-8').write(t); n += 1
    print('stamped', n, 'pages')
if __name__ == '__main__':
    main()
