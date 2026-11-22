# Lays the chart view capture over the window capture (the chart is a separate native view in the app window).
#   python3 test/compose-shots.py <shots-dir>
import json, sys, glob, os
from PIL import Image
d = sys.argv[1]
for v in glob.glob(os.path.join(d, '*.view.png')):
    base = v.replace('.view.png', '.png'); b = json.load(open(v.replace('.view.png', '.view.json')))
    im = Image.open(base).convert('RGB'); ch = Image.open(v).convert('RGB').resize((round(b['width']), round(b['height'])))
    im.paste(ch, (round(b['x']), round(b['y']))); im.save(base)
    os.remove(v); os.remove(v.replace('.view.png', '.view.json')); print('composed', os.path.basename(base))
