// Regression: the chart's bottom bar must not churn (member GK: "icons bottom-right flicker", Nov 2026).
//   node tools/tests/chart-dev-server.mjs 8044 &
//   CHART_BASE=http://127.0.0.1:8044 flock /tmp/stryker-chrome.lock node tools/tests/chart-bottombar-stable-browser.js [shotsDir]
// Watches #vela-chart .vela-widget-bottombar for 20 s (BOTTOMBAR_SECS) with a MutationObserver and fails if the Positions & Orders,
// Trade view, Connection chip, feed row nodes are removed/re-added, if their hidden/title/aria writes repeat, if the chip's bars svg is
// rebuilt, or if the chip / Positions & Orders / settings buttons change width or move. 1440 dark, 1440 light, 390 dark.
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8044';
const OUT = process.argv[2] || '/tmp';
const SECS = +process.env.BOTTOMBAR_SECS || 20;
fs.mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };
const KEEP = ['stkpo-btn', 'stktv-btn', 'stkfeeds', 'vela-bb-tz', 'vela-bb-settings'];
async function run(b, name, { w, h, mobile, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net|[a-z0-9.-]*hyperliquid\.xyz)/, (r) => r.abort());
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('hyperliquid:BTC'); ws.active.setTimeframe('1'); await new Promise((r) => setTimeout(r, 4000)); });
  await p.waitForSelector('.stklat-chip', { state: 'attached', timeout: 20000 });
  await new Promise((r) => setTimeout(r, 5000));
  await p.screenshot({ path: OUT + '/bottombar-' + name + '.png' });
  const bbSel = '#vela-chart .vela-widget-bottombar';
  const hasBar = await p.evaluate((s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none'; }, bbSel);
  if (!hasBar) { console.log('INFO ' + name + ': no bottom bar at this width (phone layout floats the chip); watching the chip only'); }
  const r = await p.evaluate(async ({ secs, keep, bbSel }) => {
    const bar = document.querySelector(bbSel) || document.body;
    const idOf = (n) => (n.id || (n.classList && n.classList.contains('stklat-chip') ? 'stklat-chip' : '')) || '';
    const rep = { replaced: [], attr: {}, svgRebuilt: 0 };
    const mo = new MutationObserver((ms) => { for (const m of ms) {
      if (m.type === 'childList') {
        for (const n of [...m.removedNodes, ...m.addedNodes]) if (n.nodeType === 1) { const i = idOf(n); if (keep.concat(['stklat-chip']).includes(i)) rep.replaced.push(i); if (n.classList && n.classList.contains('stklat-bars')) rep.svgRebuilt++; }
      } else if (m.type === 'attributes' && m.target.nodeType === 1) {
        const i = idOf(m.target); if (i && i !== 'vela-bb-tz') { const k = i + '@' + m.attributeName; rep.attr[k] = (rep.attr[k] || 0) + 1; }
      } } });
    mo.observe(bar, { subtree: true, childList: true, attributes: true });
    const els = () => ({ chip: document.querySelector('.stklat-chip'), po: document.getElementById('stkpo-btn'), st: document.getElementById('vela-bb-settings') });
    const seen = {}; const snap = () => { const e = els(); for (const k in e) { if (!e[k]) continue; const b = e[k].getBoundingClientRect(); (seen[k] = seen[k] || { w: new Set(), x: new Set() }); seen[k].w.add(b.width.toFixed(1)); seen[k].x.add(b.x.toFixed(1)); } };
    const first = els(); const iv = setInterval(snap, 100);
    await new Promise((r) => setTimeout(r, secs * 1000));
    clearInterval(iv); mo.disconnect();
    const last = els();
    rep.same = { chip: first.chip === last.chip, po: first.po === last.po };
    rep.rects = Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, { w: [...v.w], x: [...v.x] }]));
    return rep;
  }, { secs: SECS, keep: KEEP, bbSel });
  check(r.replaced.length === 0, name + ': no bar item node removed/re-added in ' + SECS + ' s', r.replaced.slice(0, 8));
  check(r.svgRebuilt === 0, name + ': latency bars svg never rebuilt', r.svgRebuilt);
  check(r.same.chip && (r.same.po || !hasBar), name + ': chip + Positions & Orders are the same DOM nodes at the end', r.same);
  const bad = Object.entries(r.attr).filter(([k, v]) => /hidden|title|aria-label/.test(k) && !/stklat-chip@aria-label/.test(k) && v > 1);
  check(bad.length === 0, name + ': no repeated hidden/title/aria writes on bar items', bad);
  check((r.attr['stklat-chip@aria-label'] || 0) <= SECS / 2, name + ': chip aria-label written only when the reading changes', r.attr['stklat-chip@aria-label']);
  if (r.rects.chip) check(r.rects.chip.w.length === 1, name + ': latency chip width constant', r.rects.chip.w);
  if (hasBar) {
    if (r.rects.po) check(r.rects.po.w.length === 1 && r.rects.po.x.length === 1, name + ': Positions & Orders does not move or resize', r.rects.po);
    if (r.rects.st) check(r.rects.st.x.length === 1, name + ': settings gear does not shift', r.rects.st.x);
  }
  await p.screenshot({ path: OUT + '/bottombar-' + name + '-end.png' });
  await ctx.close();
}
(async () => {
  const b = await launch();
  try {
    await run(b, 'desk-dark', { w: 1440, h: 900, theme: 'dark' });
    await run(b, 'desk-light', { w: 1440, h: 900, theme: 'light' });
    await run(b, 'phone-dark', { w: 390, h: 844, mobile: true, theme: 'dark' });
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
