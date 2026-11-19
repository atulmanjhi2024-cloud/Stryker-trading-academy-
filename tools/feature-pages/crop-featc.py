#!/usr/bin/env python3
"""Cut the 2x captures from shoot-featc.js into the FEATC feature-page webps (1x + @2x).
Run: python3 tools/feature-pages/crop-featc.py <raw-dir>      (raw-dir = the shoot-featc.js output dir)
Boxes are in 2x capture pixels (x0, y0, x1, y1); None = whole image. 1x = half the 2x size.
App views are cut below the 68 px app bar (y0 = 136) so no account/plan chrome shows.
Creator Hub: the example community page cannot be shot from the server (it reads live Firestore), so its frames are the
existing real captures in assets/images/creators/ (Harbor Lane Futures example, fixture data), re-saved at 1x/2x."""
import sys, pathlib
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
TOP = 136
JOBS = {
  'market-stats': [
    ('hero', 'hero', (0, TOP, 2880, 1800)),
    ('today', 'today', None),
    ('gap-cards', 'cards', None),
    ('sessions', 'sessions', None),
    ('initial-balance', 'initial-balance', None),
    ('opening-candle', 'opening-candle', (0, 0, 580, 516)),
    ('adr', 'adr', (0, 0, 1160, 554)),
    ('inside-outside', 'inside-outside', (0, 0, 1160, 554)),
    ('prior-day', 'prior-day', (0, 0, 1160, 554)),
  ],
  'global-monitor': [
    ('map-view', 'hero', (0, TOP, 2880, 1800)),
    ('markets-view', 'markets', (0, TOP, 2880, 1800)),
    ('map-view', 'map', (0, TOP, 2880, 1800)),
    ('wire-view', 'wire', (0, TOP, 2880, 1800)),
    ('risk-view', 'risk', (0, TOP, 2880, 1800)),
    ('brief-view', 'brief', (0, TOP, 2880, 1800)),
    ('signals', 'signals', None),
    ('markets-grid', 'markets-grid', None),
    ('finmap', 'finmap', None),
    ('calendar', 'calendar', None),
  ],
  'smart-money-desk': [
    ('hero', 'hero', (0, TOP, 2880, 1800)),
    ('overview', 'overview', None),
    ('overview', 'hill', (0, 204, 1380, 974)),
    ('overview', 'flow', (1380, 204, 2760, 974)),
    ('overview', 'tiles', (0, 0, 2760, 190)),
    ('congress', 'congress', (0, TOP, 2660, 1800)),
    ('insider', 'insider', (0, TOP, 2660, 1800)),
  ],
  'community': [
    ('hero', 'hero', (100, TOP, 1880, 1800)),
    ('setups', 'setups', (100, TOP, 1880, 1800)),
    ('replies', 'replies', (100, TOP, 1880, 1800)),
    ('composer', 'composer', (0, TOP, 2880, 1800)),
    ('badges', 'badges', (0, TOP, 2880, 1800)),
  ],
  'curriculum': [
    ('hero', 'hero', (0, TOP, 2880, 1800)),
    ('foundation', 'foundation', (0, TOP, 2880, 1800)),
    ('advanced', 'advanced', (0, TOP, 2880, 1800)),
    ('tracks', 'tracks', (0, TOP, 2880, 1800)),
    ('reader', 'reader', (0, TOP, 2880, 1800)),
    ('badges', 'badges', (0, TOP, 2880, 1800)),
    ('path', 'path', (0, 0, 1180, 222)),
  ],
}
# Creator Hub: existing real captures (single size) -> @2x = the file, 1x = half.
CREATORS = ['hero-1440', 'courses-1440', 'feed-1440', 'indicators-1440', 'discord-1440']
CREATORS_RN = ['ind1-d', 'curr-d', 'about-d', 'plan-d']


def save(im, out):
    out.parent.mkdir(parents=True, exist_ok=True)
    im = im.convert('RGB')
    im.save(out.with_name(out.name + '@2x.webp'), 'WEBP', quality=82, method=6)
    im.resize((im.width // 2, im.height // 2), Image.LANCZOS).save(out.with_name(out.name + '.webp'), 'WEBP', quality=84, method=6)
    print('wrote', out.relative_to(ROOT), im.width // 2, 'x', im.height // 2)


def main(raw):
    raw = pathlib.Path(raw)
    for page, jobs in JOBS.items():
        for src, name, box in jobs:
            f = raw / page / (src + '.png')
            if not f.exists():
                print('MISSING', f); continue
            im = Image.open(f)
            save(im.crop(box) if box else im, ROOT / f'assets/images/features/{page}/{name}')
    for n in CREATORS:
        save(Image.open(ROOT / f'assets/images/creators/{n}.webp'), ROOT / f'assets/images/features/creators/{n.replace("-1440", "")}')
    for n in CREATORS_RN:
        save(Image.open(ROOT / f'assets/images/creators/rn/{n}.webp'), ROOT / f'assets/images/features/creators/rn-{n.replace("-d", "")}')
    save(Image.open(raw / 'creators/start.png').crop((0, TOP, 2880, 1800)), ROOT / 'assets/images/features/creators/start')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '/tmp/featc-shots')
