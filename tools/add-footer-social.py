#!/usr/bin/env python3
"""Footer social row (Owner 24 Nov). The footer is copy-pasted into every page (no generator), so this
script inserts the row as the last child of .footer-grid. Idempotent. Run: python3 tools/add-footer-social.py [--check]
Glyph paths: simple-icons (CC0). Links open in a new tab."""
import glob, os, re, sys
LINKS = [("X", "https://x.com/thetradezoro", "M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z"),
         ("Instagram", "https://www.instagram.com/thetradezoro/", None),
         ("YouTube", "https://www.youtube.com/@tradezoro", None),
         ("Discord", "https://discord.gg/M4d4gTr5c3", None)]
SI = os.environ.get("SI_DIR")  # dir holding x/instagram/youtube/discord .svg from simple-icons
def path(n, d):
    return d or re.search(r' d="([^"]+)"', open(f"{SI}/{n.lower()}.svg").read()).group(1)
def block():
    a = "".join(f'<a href="{u}" target="_blank" rel="noopener me" aria-label="TradeZoro on {n}"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="{path(n,d)}"/></svg></a>' for n, u, d in LINKS)
    return f'      <div class="fs-row" role="group" aria-label="TradeZoro on social media">{a}</div>\n'
MARK = '    </div>\n    <div class="footer-bottom">'
CSS = """/* footer social row (add-footer-social.py) */
.footer-grid .fs-row{ display:flex; gap:8px; margin:16px 0 0 -10px; grid-column:1; grid-row:2; align-self:start; }
.footer-grid > div:nth-child(n+2):not(.fs-row){ grid-row:1 / span 2; }
@media (min-width:801px){ .footer-grid:has(.fs-row){ row-gap:0; grid-template-rows:auto 1fr; } }
.footer-grid .fs-row a{ display:inline-flex; align-items:center; justify-content:center; width:40px; height:40px; margin:0; border-radius:50%; color:var(--ink-2); opacity:.7; transition:color .15s ease, opacity .15s ease, background-color .15s ease; }
.footer-grid .fs-row a:hover, .footer-grid .fs-row a:focus-visible{ color:var(--gold); opacity:1; background:color-mix(in srgb,var(--gold) 12%,transparent); }
.footer-grid .fs-row a:focus-visible{ outline:2px solid var(--gold); outline-offset:2px; }
.footer-grid .fs-row svg{ width:20px; height:20px; display:block; }
@media (max-width:800px){ .footer-grid .fs-row{ grid-column:1 / -1; grid-row:auto; justify-content:center; margin:24px 0 0; }
 .footer-grid > div:nth-child(n+2):not(.fs-row){ grid-row:auto; } }
"""
def main():
    chk = "--check" in sys.argv
    n = bad = 0
    for f in glob.glob("**/*.html", recursive=True):
        if "node_modules" in f: continue
        s = open(f, encoding="utf-8").read()
        m = re.search(r"<footer.*?</footer>", s, re.S)
        if not m or "footer-grid" not in m.group(0): continue
        ft = m.group(0)
        if ft.count('class="fs-row"') == 1: n += 1; continue
        if chk or ft.count(MARK) != 1: bad += 1; print("MISSING", f); continue
        open(f, "w", encoding="utf-8").write(s.replace(ft, ft.replace(MARK, block() + MARK)))
        n += 1
    print("pages with row:", n, "problems:", bad)
    if not chk:
        for c in ["style", "style-home", "style-feature-charts", "style-download", "style-pricing"]:
            p = f"assets/{c}.css"; s = open(p).read()
            if "/* footer social row" not in s: open(p, "a").write("\n" + CSS)
    sys.exit(1 if bad else 0)
main()
