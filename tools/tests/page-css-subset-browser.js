// Per-page CSS subsets (assets/style-{home,pricing,download,feature-charts}.css, tools/build-charts-css.py) must
// compute the same styles as the full assets/style.css on those pages: every element, every computed property,
// at 390 and 1440, dark and day. Needs the local server (STRYKER_TEST_BASE).
const { launch, BASE } = require('./lib');
const PAGES = [['/', 'style-home'], ['/pricing', 'style-pricing'], ['/download', 'style-download'], ['/features/charts', 'style-feature-charts']];
(async () => {
  const b = await launch();
  let bad = 0;
  for (const [url, sub] of PAGES) for (const w of [390, 1440]) for (const theme of ['dark', 'day']) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 }, reducedMotion: 'reduce' });
    await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t); } catch (e) {} }, theme);
    const p = await ctx.newPage();
    await p.goto(BASE + url, { waitUntil: 'load' });
    await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } scrollTo(0, 0); });
    await p.waitForTimeout(800);
    const snap = () => p.evaluate(() => {
      document.getAnimations().forEach((a) => { try { a.finish(); } catch (e) {} });
      return [...document.querySelectorAll('body *')].slice(0, 6000).map((e) => { const id = e.tagName + '.' + (e.className && e.className.baseVal === undefined ? e.className : '') + ' '; const c = getComputedStyle(e); let s = id + ';'; for (let i = 0; i < c.length; i++) s += c[i] + ':' + c.getPropertyValue(c[i]) + ';'; return s; });
    });
    const withSubset = await snap();
    // swap the subset for the full sheet IN PLACE so the cascade order is unchanged
    await p.evaluate((s) => new Promise((res) => { const l = [...document.querySelectorAll('link[rel=stylesheet]')].find((x) => x.href.includes(s)); l.onload = res; l.href = '/assets/style.css'; }), sub);
    await p.waitForTimeout(500);
    const full = await snap();
    let diff = 0, ex = '';
    // .hv-fan / the hero .cm-w are moved by scroll-driven JS: it differs even when the same sheet is swapped in (checked), so skip it
    for (let i = 0; i < full.length; i++) if (full[i] !== withSubset[i] && !/hv-fan|DIV\.cm-w /.test(full[i].split(';')[0])) { diff++; if (!ex) { const a = full[i].split(';'), c = withSubset[i].split(';'); ex = a[0] + ' ' + a.filter((x, k) => x !== c[k]).slice(0, 3).join(' | ') + ' <- subset: ' + c.filter((x, k) => x !== a[k]).slice(0, 3).join(' | '); } }
    console.log(diff ? 'FAIL' : 'ok  ', url, w, theme, 'elements', full.length, 'differing', diff, ex);
    if (diff) bad++;
    await ctx.close();
  }
  await b.close();
  process.exit(bad ? 1 : 0);
})();
