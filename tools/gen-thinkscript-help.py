#!/usr/bin/env python3
"""Generate help/thinkscript-on-tradezoro.html (template = head/footer of help/desktop-bridge.html).
The supported lists come from the engine's own catalog (assets/ts/catalog.js), so the page never drifts from the code.
Run: python3 tools/gen-thinkscript-help.py"""
import html, json, os, re, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SLUG = 'thinkscript-on-tradezoro'
UPDATED = '22 November 2026'
tpl = open(os.path.join(ROOT, 'help', 'desktop-bridge.html'), encoding='utf-8').read()
head = tpl[:tpl.index('<main id="main"')]
foot = tpl[tpl.index('</main>') + len('</main>'):]

cat = json.loads(subprocess.run(['node', '-e', """
import('./assets/ts/catalog.js').then((m) => { const c = m.catalog();
  const pick = (k) => c.filter((x) => x.kind === k).map((x) => x.name);
  process.stdout.write(JSON.stringify({ f: pick('function'), s: pick('study'), c: pick('constant') })); });
"""], cwd=ROOT, capture_output=True, text=True, check=True).stdout)

title = 'thinkScript on TradeZoro'
desc = 'Paste a thinkScript study into the ZoroCharts Script Editor: how to add it, what is supported, and what is not.'
STYLE = '''<style>
.bh-card{ border:1px solid var(--line,#2c2c32); border-radius:12px; padding:16px; margin:0 0 20px; background:var(--bg-2,rgba(255,255,255,.03)); }
.bh-card ul{ margin:8px 0 8px; }
.bh-warn{ border-color:rgba(255,176,32,.6); background:rgba(255,176,32,.09); }
:root[data-theme="light"] .bh-warn{ border-color:rgba(176,112,0,.6); background:rgba(176,112,0,.08); }
.bh-small{ font-size:13px; line-height:20px; color:var(--ink-2,#8b93a0); margin:8px 0 0; }
.bh-pre{ overflow-x:auto; border:1px solid var(--line,#2c2c32); border-radius:8px; padding:12px 16px; margin:0 0 16px; background:var(--bg-2,rgba(255,255,255,.04)); font-size:13px; line-height:20px; scrollbar-width:thin; }
.bh code{ font-family:var(--font-code); font-size:.9em; overflow-wrap:anywhere; }
.bh-pre code{ white-space:pre; overflow-wrap:normal; }
.bh-names{ display:flex; flex-wrap:wrap; gap:8px; margin:0 0 20px; padding:0; list-style:none; }
.bh-names li{ margin:0; padding:4px 10px; border:1px solid var(--line,#2c2c32); border-radius:999px; font-family:var(--font-code); font-size:12.5px; line-height:16px; }
.bh-tbl{ width:100%; border-collapse:collapse; margin:0 0 20px; font-size:14px; line-height:20px; }
.bh-tbl th, .bh-tbl td{ text-align:left; vertical-align:top; padding:8px 12px; border-bottom:1px solid var(--line-soft,#24242a); }
.bh-tbl th{ color:var(--ink-2,#8b93a0); font-weight:600; font-size:12.5px; }
.bh-tbl td:first-child{ white-space:nowrap; }
@media (max-width:600px){ .bh-tbl td:first-child{ white-space:normal; } }
</style>
</head>'''

def names(xs):
    return '<ul class="bh-names">' + ''.join('<li>%s</li>' % html.escape(x) for x in xs) + '</ul>'

ns = {}
for c in cat['c']:
    k, _, v = c.partition('.')
    ns.setdefault(k, []).append(v)
consts = ''.join('<tr><td><code>%s</code></td><td>%s</td></tr>' % (html.escape(k), html.escape(', '.join(v))) for k, v in ns.items())

example = '''# A pasted study: two averages and a label
input length = 20;
input averageType = AverageType.EXPONENTIAL;
plot Avg = MovingAverage(averageType, close, length);
Avg.SetDefaultColor(Color.CYAN);
plot Cross = close crosses above Avg;
Cross.SetPaintingStrategy(PaintingStrategy.BOOLEAN_ARROW_UP);
AddLabel(yes, "Average " + Round(Avg, 2), Color.CYAN);'''

body = '''<p>thinkScript is a study language many traders already use. On ZoroCharts you can paste a thinkScript study into the Script Editor and add it to the chart. Our own engine reads the study and draws it on the chart's bars. This page explains how, and lists what works today.</p>
<div class="bh-card"><strong>In short</strong>
<ul><li><strong>Studies, not strategies.</strong> Plots, clouds, labels, bubbles, bar colours and alerts work. Orders and backtests (<code>AddOrder</code>) do not.</li>
<li><strong>It runs in your browser, in a sandbox.</strong> The study cannot reach the internet, your account or other pages. A study that runs too long is stopped.</li>
<li><strong>Inputs become settings.</strong> Every <code>input</code> shows in the indicator settings, so you can change it without editing the code.</li></ul>
<p class="bh-small">Education only. Not financial advice.</p></div>
<h2 id="add">Add a study</h2>
<ol><li>Open ZoroCharts and click the script editor button in the toolbar.</li>
<li>In the switch at the top of the editor, pick <strong>thinkScript</strong>.</li>
<li>Paste your study, or open one of the five <strong>Examples</strong>.</li>
<li>Give it a name and press <strong>Add to chart</strong>. Studies with <code>declare lower;</code> get their own pane.</li>
<li>To change an input, open the study's settings on the chart (the gear next to its name).</li></ol>
<p>Problems show under the code with a line and column, for example <code>Line 3:10 Unknown function "Averag".</code> Click a problem to jump to it. <strong>Save</strong> keeps the study in <strong>My scripts</strong> in this browser.</p>
<pre class="bh-pre"><code>%(example)s</code></pre>
<h2 id="language">Language</h2>
<table class="bh-tbl"><thead><tr><th>Part</th><th>What works</th></tr></thead><tbody>
<tr><td>Values</td><td><code>def</code>, <code>rec</code>, <code>plot</code>, numbers, text in quotes, <code>yes</code> / <code>no</code>, <code>Double.NaN</code> and <code>IsNaN()</code></td></tr>
<tr><td>Inputs</td><td>whole numbers, decimals, text, <code>yes</code>/<code>no</code>, a price (<code>close</code>, <code>hl2</code> ...), a list <code>{default a, b}</code>, <code>AverageType.X</code></td></tr>
<tr><td>Declares</td><td><code>declare lower</code>, <code>upper</code>, <code>once_per_bar</code>, <code>hide_on_intraday</code>, <code>hide_on_daily</code></td></tr>
<tr><td>Choices</td><td><code>if ... then ... else</code> values, <code>if { } else { }</code> blocks, <code>switch</code> / <code>case</code> / <code>default</code></td></tr>
<tr><td>History</td><td><code>close[1]</code> (bars ago), <code>close[-1]</code> (bars ahead), <code>GetValue</code>, <code>CompoundValue</code>, a def that reads its own past</td></tr>
<tr><td>Loops</td><td><code>fold i = 0 to n with s do ...</code>, with <code>while</code></td></tr>
<tr><td>Your own functions</td><td><code>script Name { input ...; plot ...; }</code>, called as <code>Name(1, 2).PlotName</code></td></tr>
<tr><td>Operators</td><td><code>+ - * / %%</code>, <code>== != &lt;&gt; &lt; &gt; &lt;= &gt;=</code>, <code>and or not</code>, <code>crosses</code>, <code>crosses above</code>, <code>crosses below</code></td></tr>
<tr><td>Bar data</td><td><code>open high low close volume hl2 hlc3 ohlc4 barNumber</code>, and another timeframe with <code>close(period = AggregationPeriod.DAY)</code></td></tr>
<tr><td>Display</td><td><code>SetPaintingStrategy</code>, <code>SetDefaultColor</code>, <code>AssignValueColor</code>, <code>SetLineWeight</code>, <code>SetStyle</code>, <code>Hide</code>, <code>HideBubble</code>, <code>HideTitle</code>, <code>AddCloud</code>, <code>AddLabel</code>, <code>AddChartBubble</code>, <code>AddVerticalLine</code>, <code>AssignPriceColor</code>, <code>Alert</code></td></tr>
</tbody></table>
<p>Names are not case-sensitive: <code>average</code>, <code>Average</code> and <code>AVERAGE</code> are the same. Labels from <code>AddLabel</code> sit in a row at the top of the study's pane. An <code>Alert</code> that is true on the newest bar shows a notice on the chart and plays the alert sound.</p>
<h2 id="functions">Functions (%(nf)d)</h2>
%(fn)s
<h2 id="studies">Built-in studies (%(ns)d)</h2>
<p>Call them like functions and pick a plot by name, for example <code>RSI(14)</code>, <code>MACD().Diff</code> or <code>BollingerBands(length = 20).UpperBand</code>.</p>
%(st)s
<h2 id="constants">Constants</h2>
<table class="bh-tbl"><thead><tr><th>Group</th><th>Members</th></tr></thead><tbody>%(consts)s</tbody></table>
<h2 id="not">Not supported</h2>
<div class="bh-card bh-warn"><strong>These give one clear "not supported" message.</strong>
<ul><li>Strategies and orders: <code>declare strategy</code>, <code>AddOrder</code>, <code>EntryPrice</code>, <code>GetQuantity</code> and the other position values.</li>
<li>Scan-only and watchlist-only functions, fundamentals, options chain values and account values.</li>
<li>Drawing tools that only exist on other platforms. Use plots, clouds, labels and bubbles.</li></ul></div>
<h2 id="limits">Limits</h2>
<ul><li>Up to 8 thinkScript studies per chart, 256 KB per study, 50,000 bars.</li>
<li>A <code>fold</code> can run up to 20,000 times on one bar. A study that runs longer than about 20 seconds is stopped with a message.</li>
<li>Another timeframe or symbol is loaded through the chart. It must be the chart's timeframe or longer.</li>
<li>Results can differ slightly from other platforms where the first bars of an average are seeded differently. Check a study against a chart you trust before you rely on it.</li></ul>
<p class="bh-small">thinkScript is the name of the language. TradeZoro wrote its own engine for it. Education only. Not financial advice.</p>''' % dict(example=html.escape(example), nf=len(cat['f']), fn=names(cat['f']), ns=len(cat['s']), st=names(cat['s']), consts=consts)

h = head
h = re.sub(r'<meta name="description" content="[^"]*">', '<meta name="description" content="%s">' % html.escape(desc, True), h)
for k in ('og:title', 'twitter:title'):
    h = re.sub(r'(<meta (?:property|name)="%s" content=")[^"]*' % k, lambda m: m.group(1) + html.escape(title, True), h)
for k in ('og:description', 'twitter:description'):
    h = re.sub(r'(<meta (?:property|name)="%s" content=")[^"]*' % k, lambda m: m.group(1) + html.escape(desc, True), h)
h = h.replace('og:url" content="https://tradezoro.com/help/desktop-bridge"', 'og:url" content="https://tradezoro.com/help/%s"' % SLUG)
h = h.replace('<link rel="canonical" href="https://tradezoro.com/help/desktop-bridge">', '<link rel="canonical" href="https://tradezoro.com/help/%s">' % SLUG)
h = re.sub(r'<title>[^<]*</title>', '<title>%s | TradeZoro</title>' % html.escape(title), h)
h = re.sub(r'<style>[\s\S]*?</style>\n</head>', lambda m: STYLE, h)
assert 'thinkscript-on-tradezoro' in h and STYLE in h
out = h + '<main id="main" tabindex="-1">\n<header class="site-page-hero"><div class="container"><h1 id="site-page-title">%s</h1>\n<span class="updated-note">Beta · Last updated %s</span></div></header>\n<div class="container"><div class="article-wrap"><div class="article-body bh">\n%s\n</div></div></div>\n</main>' % (title, UPDATED, body) + foot
open(os.path.join(ROOT, 'help', SLUG + '.html'), 'w', encoding='utf-8').write(out)
print('wrote help/%s.html: %d functions, %d studies' % (SLUG, len(cat['f']), len(cat['s'])))
