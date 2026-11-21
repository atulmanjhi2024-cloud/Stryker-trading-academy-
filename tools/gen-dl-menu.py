#!/usr/bin/env python3
"""Rewrite the header Download menu (.dl-panel + mobile .dl-drawer) on every page from ONE list (Owner 22 Nov:
Desktop app (Beta) / Phone app (Beta)). Also rewrites the hero + final buttons of download.html. Idempotent.
Usage: python3 tools/gen-dl-menu.py [version]   (version stamps ?r= on /dl/ links; default = desktop/package.json)"""
import glob, json, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VER = sys.argv[1] if len(sys.argv) > 1 else json.load(open(os.path.join(ROOT, 'desktop/package.json')))['version']
PC = '<svg class="ci" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.5" y="4.5" width="17" height="11.5" rx="2"/><path d="M8 20h8M12 16v4"/></svg>'
PH = '<svg class="ci" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>'
# id, file, label, small (menu), small (page)
DESK = [
  ('win', 'TradeZoro-Setup.exe', 'Windows', 'Windows 10 and 11 · 64-bit'),
  ('mac-arm', 'TradeZoro-mac-arm64.dmg', 'macOS Apple silicon', 'M1 or newer · macOS 11+'),
  ('mac-x64', 'TradeZoro-mac-x64.dmg', 'macOS Intel', 'Intel Macs · macOS 11+'),
  ('deb', 'TradeZoro-linux-x64.deb', 'Linux .deb', 'Debian and Ubuntu · 64-bit'),
  ('appimage', 'TradeZoro-linux-x64.AppImage', 'Linux AppImage', 'Any 64-bit Linux · updates itself'),
]
AND = ('and', '/downloads/tradezoro-android-beta.apk', 'Android', 'Android 8+ · charts, paper trading, alerts')
def href(f): return f if f.startswith('/') else '/dl/%s?r=%s' % (f, VER)
def item(ic, f, label, sub):
    extra = ' download' if f.startswith('/downloads') else ' rel="noopener"'
    return '<a href="%s"%s>%s<div><b>%s</b><span>%s</span></div></a>' % (href(f), extra, ic, label, sub)
def block(head):
    d = ''.join(item(PC, f, l, s) for _, f, l, s in DESK)
    a = item(PH, AND[1], AND[2], AND[3])
    return '<p class="%s">Desktop app (Beta)</p>%s<p class="%s">Phone app (Beta)</p>%s' % (head, d, head, a)
n = 0
for f in glob.glob(os.path.join(ROOT, '**/*.html'), recursive=True):
    if 'node_modules' in f: continue
    s = open(f, encoding='utf-8').read(); o = s
    s = re.sub(r'(<div class="dl-drawer">).*?<em class="dl-beta">Beta</em></a></div>(?!<a class="dl-all")', lambda m: m.group(1) + block('dl-drawer-h') + '</div>', s, count=1, flags=re.S)  # drawer ends at the last Beta item, not at the panel's
    s = re.sub(r'(<div class="dl-panel">).*?(<a class="dl-all")', lambda m: m.group(1) + block('dl-grp') + m.group(2), s, count=1, flags=re.S)
    if s != o: open(f, 'w', encoding='utf-8').write(s); n += 1
print('menus rewritten in', n, 'files; version', VER)
