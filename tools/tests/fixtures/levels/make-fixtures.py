#!/usr/bin/env python3
"""Synthetic chart screenshots for the "Import levels" detector (assets/chart-levels-core.js).

Sample data: random-walk candles, made-up levels. Two generic platform looks (no real product is
copied): style "a" (levels drawn over the candles, coloured price boxes on the axis, labels above
the line) and style "b" (levels drawn under the candles, axis with tick marks and a separator,
no boxes). Dark and light, solid / dashed / dotted, several sizes and price scales.
Writes <name>.png + expected.json next to this file. The ZoroCharts fixtures (zc-*.png) are made by
tools/tests/levels-import-shots-browser.js from our own chart.

    python3 tools/tests/fixtures/levels/make-fixtures.py
"""
import json
import os
import random
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
FONT_B = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

THEMES = {
    'a-dark': dict(bg=(19, 23, 34), grid=(42, 46, 57), text=(178, 181, 190), up=(38, 166, 154), dn=(239, 83, 80), axis_sep=None),
    'a-light': dict(bg=(255, 255, 255), grid=(240, 243, 250), text=(19, 23, 34), up=(8, 153, 129), dn=(242, 54, 69), axis_sep=None),
    'b-dark': dict(bg=(12, 12, 14), grid=(30, 30, 34), text=(200, 200, 205), up=(3, 201, 136), dn=(229, 72, 77), axis_sep=(70, 70, 78)),
    'b-light': dict(bg=(250, 250, 248), grid=(232, 232, 228), text=(40, 40, 44), up=(20, 20, 20), dn=(20, 20, 20), axis_sep=(160, 160, 160)),
}


def fmt(v, dec):
    return f'{v:,.{dec}f}' if dec else f'{v:,.0f}'


def nice_step(span, n=8):
    raw = span / n
    for e in (0.0001, 0.001, 0.01, 0.1, 1, 10, 100, 1000):
        for m in (1, 2, 2.5, 5):
            if m * e >= raw:
                return m * e
    return raw


def make(spec):
    rnd = random.Random(spec['seed'])
    W, H = spec['size']
    th = THEMES[spec['theme']]
    style = spec['theme'][0]
    img = Image.new('RGB', (W, H), th['bg'])
    d = ImageDraw.Draw(img)
    fs = spec.get('font', 12)
    font = ImageFont.truetype(FONT, fs)
    fontb = ImageFont.truetype(FONT_B, fs)
    axis_w = spec.get('axis_w', 72)
    top, bottom = 34, H - 28
    px0, px1 = 0, W - axis_w - 1
    lo, hi, dec, tick = spec['lo'], spec['hi'], spec['dec'], spec['tick']
    yof = lambda v: top + (hi - v) / (hi - lo) * (bottom - top)
    # grid + axis labels
    step = nice_step(hi - lo)
    v = (int(lo / step) + 1) * step
    while v < hi:
        y = round(yof(v))
        d.line([(px0, y), (px1, y)], fill=th['grid'])
        t = fmt(v, dec)
        tw = d.textlength(t, font=font)
        if style == 'a':
            d.text((px1 + 8, y - fs * 0.62), t, font=font, fill=th['text'])
        else:
            d.line([(px1 + 1, y), (px1 + 5, y)], fill=th['axis_sep'])
            d.text((W - 6 - tw, y - fs * 0.62), t, font=font, fill=th['text'])
        v += step
    if th['axis_sep']:
        d.line([(px1 + 1, top - 6), (px1 + 1, bottom)], fill=th['axis_sep'])
    # time axis
    for i in range(1, 8):
        x = px1 * i // 8
        d.text((x - 14, bottom + 7), f'{8 + i:02d}:30', font=font, fill=th['text'])
    # legend
    d.text((10, 9), spec['legend'], font=fontb, fill=th['text'])

    def level_layer():
        for lv in spec['levels']:
            y = round(yof(lv['price']))
            col = tuple(lv['color'])
            w = lv.get('width', 1)
            for k in range(w):
                yy = y - (w - 1) // 2 + k
                if lv.get('style', 'solid') == 'solid':
                    d.line([(px0, yy), (px1, yy)], fill=col)
                else:
                    dash, gap = (6, 4) if lv['style'] == 'dashed' else (2, 2)
                    x = px0
                    while x <= px1:
                        d.line([(x, yy), (min(px1, x + dash - 1), yy)], fill=col)
                        x += dash + gap
            if lv.get('label'):
                lx = px0 + 8 if lv.get('label_side', 'left') == 'left' else px1 - 8 - d.textlength(lv['label'], font=font)
                d.text((lx, y - fs - 5), lv['label'], font=font, fill=col)
            if lv.get('box'):
                bh = fs + 7
                d.rectangle([(px1 + 1, y - bh // 2), (W - 1, y + bh // 2)], fill=col)
                t = fmt(lv['price'], dec)
                lumv = 0.2126 * col[0] + 0.7152 * col[1] + 0.0722 * col[2]
                tc = (255, 255, 255) if lumv < 150 else (0, 0, 0)
                d.text((px1 + 8, y - fs * 0.62), t, font=font, fill=tc)

    if style == 'b':
        level_layer()
    # candles: random walk that stays inside the range
    bw = spec.get('bar', 7)
    n = (px1 - 20) // (bw + 3)
    price = lo + (hi - lo) * rnd.uniform(0.35, 0.65)
    span = hi - lo
    for i in range(n):
        o = price
        c = o + rnd.gauss(0, span * 0.018)
        c = min(hi - span * 0.06, max(lo + span * 0.06, c))
        h = max(o, c) + abs(rnd.gauss(0, span * 0.008))
        l = min(o, c) - abs(rnd.gauss(0, span * 0.008))
        x = 10 + i * (bw + 3)
        col = th['up'] if c >= o else th['dn']
        d.line([(x + bw // 2, round(yof(h))), (x + bw // 2, round(yof(l)))], fill=col)
        y0, y1 = sorted((round(yof(o)), round(yof(c))))
        if spec['theme'] == 'b-light' and c >= o:
            d.rectangle([(x, y0), (x + bw - 1, max(y0 + 1, y1))], fill=th['bg'], outline=col)
        else:
            d.rectangle([(x, y0), (x + bw - 1, max(y0 + 1, y1))], fill=col)
        price = c
    if style == 'a':
        level_layer()
    # optional live-price line + box (style a): a dotted line in the last candle's colour
    if spec.get('last_price'):
        y = round(yof(price))
        col = th['up']
        x = px0
        while x <= px1:
            d.line([(x, y), (x + 1, y)], fill=col)
            x += 4
        bh = fs + 7
        d.rectangle([(px1 + 1, y - bh // 2), (W - 1, y + bh // 2)], fill=col)
        d.text((px1 + 8, y - fs * 0.62), fmt(round(price / tick) * tick, dec), font=font, fill=(255, 255, 255))
    name = spec['name']
    img.save(os.path.join(HERE, name + '.png'))
    return {'file': name + '.png', 'tick': tick, 'style': spec['theme'], 'sample': True,
            'perPx': round((hi - lo) / (bottom - top), 5),
            'levels': [{'price': lv['price'], 'label': lv.get('label', ''), 'style': lv.get('style', 'solid'), 'box': bool(lv.get('box'))} for lv in spec['levels']]}


BLUE, ORANGE, PURPLE, WHITE, RED, GREEN, YELLOW, BLACK = (41, 98, 255), (255, 152, 0), (156, 39, 176), (235, 235, 235), (242, 54, 69), (0, 150, 80), (230, 200, 30), (25, 25, 25)

SPECS = [
    # style a, dark, solid with boxes and labels (NQ-like, 0.25 tick)
    dict(name='a-dark-solid-boxes', theme='a-dark', seed=1, size=(1280, 720), lo=21380, hi=21560, dec=2, tick=0.25, legend='NQ1!  5  Sample data',
         levels=[dict(price=21525.25, color=BLUE, label='PDH', box=True), dict(price=21487.5, color=ORANGE, label='VWAP', box=True),
                 dict(price=21442.75, color=PURPLE, box=True, width=2), dict(price=21401.0, color=WHITE, label='PDL', box=True)], last_price=True),
    # style a, light, dashed with boxes
    dict(name='a-light-dashed-boxes', theme='a-light', seed=2, size=(1440, 800), lo=5980, hi=6060, dec=2, tick=0.25, legend='ES1!  15  Sample data',
         levels=[dict(price=6051.5, color=RED, style='dashed', box=True, label='Weekly high'), dict(price=6022.25, color=BLUE, style='dashed', box=True),
                 dict(price=5995.75, color=GREEN, style='dashed', box=True, label='ONL')]),
    # style a, dark, no boxes, solid + dotted, fine scale (ES ~0.05 pt/px)
    dict(name='a-dark-noboxes', theme='a-dark', seed=3, size=(1280, 720), lo=6005, hi=6038, dec=2, tick=0.25, legend='ES1!  1  Sample data',
         levels=[dict(price=6031.25, color=YELLOW), dict(price=6019.5, color=BLUE, style='dotted', width=1), dict(price=6011.0, color=ORANGE, width=2, label='Open')]),
    # style a, light, no boxes, labels right side
    dict(name='a-light-noboxes', theme='a-light', seed=4, size=(1200, 680), lo=2640, hi=2672, dec=1, tick=0.1, legend='GC1!  5  Sample data',
         levels=[dict(price=2667.4, color=PURPLE, label='R1', label_side='right'), dict(price=2655.0, color=BLUE, style='dashed', label='Pivot', label_side='right'),
                 dict(price=2646.3, color=RED, label='S1', label_side='right')]),
    # style b, dark, under candles, solid
    dict(name='b-dark-solid', theme='b-dark', seed=5, size=(1280, 720), lo=97200, hi=98400, dec=0, tick=1, legend='BTCUSDT  15m  Sample data',
         levels=[dict(price=98250, color=BLUE, width=2), dict(price=97810, color=ORANGE), dict(price=97355, color=(200, 60, 220))]),
    # style b, light, dashed, under candles
    dict(name='b-light-dashed', theme='b-light', seed=6, size=(1366, 768), lo=44100, hi=44400, dec=0, tick=1, legend='YM1!  5  Sample data',
         levels=[dict(price=44372, color=BLUE, style='dashed'), dict(price=44260, color=RED, style='dashed'), dict(price=44135, color=GREEN, style='dashed')]),
    # style b, dark, many levels, small screenshot (phone crop)
    dict(name='b-dark-phone', theme='b-dark', seed=7, size=(780, 900), lo=21300, hi=21420, dec=2, tick=0.25, legend='NQ  5m  Sample data', axis_w=78, font=13, bar=5,
         levels=[dict(price=21411.0, color=YELLOW), dict(price=21388.5, color=BLUE, style='dashed'), dict(price=21362.25, color=WHITE),
                 dict(price=21341.0, color=ORANGE, width=2), dict(price=21318.75, color=(240, 80, 80), style='dashed')]),
    # style b, light, big screenshot, CL (0.01 tick) on a fine scale
    dict(name='b-light-cl', theme='b-light', seed=8, size=(1600, 900), lo=68.20, hi=69.10, dec=2, tick=0.01, legend='CL1!  5  Sample data',
         levels=[dict(price=69.02, color=BLUE, width=2), dict(price=68.75, color=RED), dict(price=68.31, color=GREEN, style='dashed')]),
    # style a, dark, boxes only on some lines (mixed)
    dict(name='a-dark-mixed', theme='a-dark', seed=9, size=(1440, 810), lo=5870, hi=5940, dec=2, tick=0.25, legend='ES1!  5  Sample data',
         levels=[dict(price=5931.75, color=RED, box=True, label='PDH'), dict(price=5912.0, color=WHITE, style='dashed'),
                 dict(price=5896.5, color=BLUE, box=True), dict(price=5878.25, color=GREEN, label='PDL')]),
    # style a, light, coarse scale but boxes give exact prices
    dict(name='a-light-coarse-boxes', theme='a-light', seed=10, size=(1280, 720), lo=20800, hi=21800, dec=2, tick=0.25, legend='NQ1!  60  Sample data',
         levels=[dict(price=21712.75, color=BLUE, box=True), dict(price=21388.25, color=ORANGE, box=True, label='Gap'), dict(price=20955.5, color=PURPLE, box=True)]),
]

if __name__ == '__main__':
    out = [make(s) for s in SPECS]
    path = os.path.join(HERE, 'expected.json')
    prev = json.load(open(path)) if os.path.exists(path) else []
    keep = [e for e in prev if e['file'].startswith('zc-')]        # ZoroCharts fixtures come from the browser script
    json.dump(out + keep, open(path, 'w'), indent=1)
    print('wrote', len(out), 'synthetic fixtures (+', len(keep), 'ZoroCharts)')
