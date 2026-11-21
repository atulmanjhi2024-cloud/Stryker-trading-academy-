// Import levels: screenshot accuracy on the fixture set (tools/tests/fixtures/levels, Sample data).
// Runs the real pipeline (OCR + pixel detection) in Chromium on every fixture and checks each
// expected level is found within 1 tick. Pass: every line hit on >= 90% of the fixtures.
//   node tools/tests/levels-import-browser.js            (needs the repo served on STRYKER_TEST_PORT)
// Writes the accuracy table to tools/tests/fixtures/levels/accuracy.md.
const fs = require('fs');
const path = require('path');
const { launch, BASE, ROOT } = require('./lib');

const DIR = path.join(ROOT, 'tools/tests/fixtures/levels');

(async () => {
  const expected = JSON.parse(fs.readFileSync(path.join(DIR, 'expected.json'), 'utf8'));
  const only = process.argv[2];
  const browser = await launch();
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(BASE + '/tools/tests/fixtures/levels/expected.json');
  const rows = [];
  let pass = 0;
  for (const fx of expected) {
    if (only && !fx.file.includes(only)) continue;
    const t0 = Date.now();
    const r = await page.evaluate(async ({ file, tick }) => {
      const M = await import('/assets/chart-levels-import.js');
      const blob = await (await fetch('/tools/tests/fixtures/levels/' + file)).blob();
      const a = await M.analyzeImage(blob, { tick });
      return { levels: a.levels.map((l) => ({ price: l.price, checked: l.checked, source: l.source, label: l.label, style: l.style, color: l.color, y: l.y })), warnings: a.warnings.map((w) => w.id), log: a.fit && a.fit.log, n: a.fit && a.fit.n, debug: a.debug };
    }, fx);
    const ms = Date.now() - t0;
    const tol = fx.tick * 1.0001;
    const got = r.levels.filter((l) => l.checked);
    const miss = [], hit = [];
    for (const e of fx.levels) {
      const m = got.find((l) => Math.abs(l.price - e.price) <= tol);
      if (m) hit.push({ e, m }); else miss.push(e.price);
    }
    const extra = got.filter((l) => !fx.levels.some((e) => Math.abs(l.price - e.price) <= tol)).map((l) => l.price);
    const labelsOk = hit.filter(({ e, m }) => e.label && (m.label || '').toLowerCase().includes(e.label.toLowerCase())).length;
    const labelsWant = hit.filter(({ e }) => e.label).length;
    const styleOk = hit.filter(({ e, m }) => (e.style === 'solid') === (m.style === 'solid')).length;
    const ok = miss.length === 0;
    if (ok) pass++;
    rows.push({ file: fx.file, style: fx.style, n: fx.levels.length, hit: hit.length, miss, extra, labels: labelsOk + '/' + labelsWant, styles: styleOk + '/' + hit.length, ok, ms, axis: r.n });
    console.log((ok ? 'PASS ' : 'FAIL ') + fx.file + '  hit ' + hit.length + '/' + fx.levels.length + (miss.length ? '  missed ' + miss.join(', ') : '') + (extra.length ? '  extra ' + extra.join(', ') : '') +
      '  labels ' + labelsOk + '/' + labelsWant + '  style ' + styleOk + '/' + hit.length + '  axis labels ' + r.n + '  ' + ms + ' ms' + (r.warnings.length ? '  warn ' + r.warnings.join(',') : ''));
    if (!ok || process.env.VERBOSE) console.log('   got', JSON.stringify(r.levels.map((l) => [l.price, l.checked, l.source, l.label, l.style])));
    if (process.env.VERBOSE) console.log('   debug', JSON.stringify(r.debug));
  }
  await page.evaluate(async () => { const M = await import('/assets/chart-levels-import.js'); await M.closeOcr(); });
  await browser.close();
  const total = rows.length, pct = total ? Math.round(pass / total * 100) : 0;
  const md = ['| Fixture (Sample data) | Look | Lines | Found within 1 tick | Missed | Extra ticked | Labels read | Solid/dashed right | Time |', '|---|---|---|---|---|---|---|---|---|']
    .concat(rows.map((r) => `| ${r.file} | ${r.style} | ${r.n} | ${r.hit}/${r.n} ${r.ok ? 'PASS' : 'FAIL'} | ${r.miss.join(', ') || '-'} | ${r.extra.join(', ') || '-'} | ${r.labels} | ${r.styles} | ${(r.ms / 1000).toFixed(1)} s |`))
    .concat(['', `Every line within 1 tick on ${pass}/${total} fixtures (${pct}%). Target >= 90%.`]).join('\n');
  if (!only) fs.writeFileSync(path.join(DIR, 'accuracy.md'), md + '\n');
  console.log('\n' + md);
  process.exit(pct >= 90 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
