// Screenshots for the FEATC feature pages (19 Nov 2026): market-stats, global-monitor, smart-money-desk, community,
// creators, curriculum. Drives the REAL local pages with the repo's test stub (tools/tests/richstub.js) and fixtures, so
// every image is the tool working on sample data. Output: 2x PNGs in <outDir>/<page>/, cut to webp by
// tools/feature-pages/crop-featc.py.
//   node tools/tests/chart-dev-server.mjs 8461 &
//   tools/chrome-slot.sh env SITE=http://127.0.0.1:8461 node tools/feature-pages/shoot-featc.js <outDir> [page...]
// Data: Market Stats = tools/tests/fixtures/market-stats (recorded scan files); Global Monitor and Smart Money read their
// public JSON files at shoot time (public filings / public news); the community floor uses the sample posts below, not
// the stub's own (those quote results and firm names). Creator Hub = the public example page tradezoro.com/c/tradezoro
// (member counts hidden, as in tools/creator/rn-shots.js). Vendor/source captions are hidden before every shot, and
// people's names on the Smart Money tape are blurred.
const fs = require('fs');
const path = require('path');
const { launch } = require('../tests/lib.js');
let stub = require('../tests/richstub.js');
const SITE = process.env.SITE || 'http://127.0.0.1:8461';
const OUT = process.argv[2] || '/tmp/featc-shots';
const ONLY = process.argv.slice(3);
const FIX = path.join(__dirname, '..', 'tests', 'fixtures', 'market-stats');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sample posts for the Trading Floor shots: study notes and questions only (no results, no firm names).
const POSTS = [
  ['c1', 'u9', 'Ravi K.', 'Elite', 'Marked the Asia range high and low before London. Price ran the high first, then left a 5m fair value gap on the way back. Saving this one for my journal review. #fvg', 0, 14, 3, 'general', 'setup'],
  ['c2', 'u4', 'Meera S.', 'Pro', 'Week three of writing the plan before the open. The checklist in chapter 12 is the part that finally made it stick.', 0, 31, 7, 'general', null],
  ['c3', 'u5', 'Tom B.', 'Starter', 'Question for the room: when the daily order block and the 4h order block disagree, which one do you give more weight to while studying?', 1, 9, 14, 'general', 'question'],
  ['c4', 'u2', 'Aisha R.', 'Pro', 'Replayed ten Judas swing mornings in Kronos this weekend. Notes are in my playbook if anyone wants to pick them apart. #judas', 1, 48, 11, 'general', 'setup'],
  ['c5', 'u7', 'Daniel O.', 'Elite', 'CPI is out in 40 minutes. If you are on an evaluation account, re-read your news rules before the open.', 2, 22, 5, 'propfirm', null],
];
const REPLIES = [
  { authorUid: 'u4', authorName: 'Meera S.', authorPlan: 'Pro', text: 'Same here. I mark it before the open now and only then look at the 5m.' },
  { authorUid: 'u7', authorName: 'Daniel O.', authorPlan: 'Elite', text: 'Chapter 14 covers that gap behaviour, worth a re-read with this chart open.' },
];
stub = stub.replace(/communityPosts: \[[\s\S]*?\n      \],\n      liveSessions/, 'communityPosts: [' +
  POSTS.map((p) => 'post(' + p.map((v) => JSON.stringify(v)).join(', ') + ')').join(',\n') + '],\n      replies: ' + JSON.stringify(REPLIES) + '.map((r, i) => Object.assign({ id: \'r\' + i, createdAt: ts(0) }, r)),\n      liveSessions');
if (!/Marked the Asia range/.test(stub)) throw new Error('post swap failed');
stub = stub.replace("price: 12999, chapterLimit: 0, archived: true", "price: 12999, chapterLimit: 0");
// The reader needs one chapter body (Firestore chapterBodies/05 in production): taken from the repo's chapter source.
{
  const vm = require('vm'); const c = {}; vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'content', 'chapters-data.js'), 'utf8') + ';this.X = CHAPTERS_SEED', c);
  const ch = c.X.find((x) => x.num === '05');
  stub = stub.replace('settings: {', () => 'chapterBodies: { "05": ' + JSON.stringify({ bodyHtml: ch.bodyHtml || '', paragraphs: ch.paragraphs || [], lessons: ch.lessons || [], video: '' }) + ' },\n      settings: {');
}

const HIDE = `.rv,.fpg-rv{opacity:1!important;transform:none!important} *{animation:none!important;transition:none!important}
  .gm-side-note,#gm-tv-quotes,.gm-wire-src,.gm-pred-meta span:first-child,[data-tab="streams"],.cookie-notice,#cookie-notice,.cn-bar,.install-prompt,.push-prompt,.toast,#toast-root{display:none!important}
  .sm-line2,.sm-who,.sm-name{filter:blur(4px)}`;

async function ctxFor(b, { w = 1440, h = 900, dsf = 2 } = {}) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try {
    localStorage.setItem('tz_consent', JSON.stringify({ v: 1, essential: true, analytics: false, at: new Date().toISOString() }));
    localStorage.setItem('stryker_theme', 'night');
    ['install', 'push'].forEach((k) => localStorage.setItem('stryker_' + k + '_prompt_shown_u1', '1'));
  } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|raw\.githubusercontent\.com|book-recorder\.)/, (r) => r.abort());
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/scan/, (r) => {
    const part = new URL(r.request().url()).searchParams.get('part'); const f = path.join(FIX, part + '.json.gz');
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: 'no data' });
    r.fulfill({ status: 200, headers: { 'content-type': 'application/octet-stream', 'x-scan-gzip': '1', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-scan-gzip, x-scan-t' }, body: fs.readFileSync(f) });
  });
  return ctx;
}
async function open(ctx, url, wait = 7000) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('  pageerror', String(e).slice(0, 140)));
  await p.goto(SITE + url, { waitUntil: 'domcontentloaded' });
  await sleep(wait);
  await p.addStyleTag({ content: HIDE });
  await p.evaluate(() => { document.querySelectorAll('.gate-pending').forEach((e) => e.classList.remove('gate-pending')); });
  await sleep(400);
  return p;
}
function mk(dir) { const d = path.join(OUT, dir); fs.mkdirSync(d, { recursive: true }); return d; }
async function el(p, sel, file, pad = 0) {
  const e = await p.$(sel);
  if (!e) { console.log('  MISSING', sel); return; }
  await e.scrollIntoViewIfNeeded(); await sleep(300);
  if (!pad) { await e.screenshot({ path: file }); console.log('  ok', path.basename(file)); return; }
  const b = await e.boundingBox();
  await p.screenshot({ path: file, clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 } });
  console.log('  ok', path.basename(file));
}
async function view(p, file) { await p.evaluate(() => scrollTo(0, 0)); await sleep(300); await p.screenshot({ path: file }); console.log('  ok', path.basename(file)); }
async function clickText(p, sel, text) { await p.evaluate(([s, t]) => { const b = [...document.querySelectorAll(s)].find((x) => x.textContent.trim().startsWith(t)); if (b) b.click(); }, [sel, text]); await sleep(1200); }

const SCENES = {
  async 'market-stats'(b) {
    const d = mk('market-stats'); const ctx = await ctxFor(b); const p = await open(ctx, '/market-stats.html', 9000);
    await view(p, d + '/hero.png');
    await el(p, '.ms-today', d + '/today.png', 8);
    await el(p, '.ms-grid', d + '/gap-cards.png', 8);
    for (const [rep, name] of [['oc', 'opening-candle'], ['ib', 'initial-balance'], ['prior', 'prior-day'], ['io', 'inside-outside'], ['adr', 'adr']]) {
      await p.evaluate((r) => { const t = document.querySelector('[data-rep="' + r + '"]'); if (t) t.click(); }, rep); await sleep(1500);
      await el(p, '.ms-grid', d + '/' + name + '.png', 8);
    }
    await p.evaluate(() => { const t = document.querySelector('[data-rep="gap"]'); if (t) t.click(); }); await sleep(1200);
    await p.evaluate(() => { const t = document.querySelector('[data-view="dow"]'); if (t) t.click(); }); await sleep(1500);
    await el(p, '.ms-grid, .ms-table, .ms-tgrid', d + '/by-weekday.png', 8);
    await p.evaluate(() => { const t = document.querySelector('[data-view="cards"]'); if (t) t.click(); }); await sleep(1200);
    await p.evaluate(() => { const t = document.querySelector('[data-card]'); if (t) t.click(); }); await sleep(1800);
    await el(p, '.ms-sheet', d + '/sessions.png');
    await ctx.close();
  },
  async 'global-monitor'(b) {
    const d = mk('global-monitor'); const ctx = await ctxFor(b); const p = await open(ctx, '/global-monitor.html', 12000);
    for (const [tab, name] of [['markets', 'markets'], ['map', 'map'], ['wire', 'wire'], ['risk', 'risk'], ['ai', 'brief']]) {
      await p.evaluate((t) => { const x = document.querySelector('.term-tab[data-tab="' + t + '"]'); if (x) x.click(); }, tab); await sleep(2500);
      await view(p, d + '/' + name + '-view.png');
      await el(p, '.gm-panel[data-tab="' + tab + '"]', d + '/' + name + '.png');
    }
    await p.evaluate(() => { const x = document.querySelector('.term-tab[data-tab="markets"]'); if (x) x.click(); }); await sleep(2000);
    await el(p, '#gm-signals', d + '/signals.png', 12);
    await el(p, '#gm-markets-grid', d + '/markets-grid.png', 4);
    await el(p, '#gm-fin-map', d + '/finmap.png', 4);
    await el(p, '#gm-cal-list', d + '/calendar.png', 8);
    await el(p, '#gm-predict-trend', d + '/predict.png', 8);
    await ctx.close();
  },
  async 'smart-money-desk'(b) {
    const d = mk('smart-money-desk'); const ctx = await ctxFor(b); const p = await open(ctx, '/smart-money.html', 12000);
    await view(p, d + '/hero.png');
    await el(p, '#sm-overview', d + '/overview.png', 4);
    await el(p, '#sm-congress-list', d + '/congress.png', 4);
    await el(p, '#sm-insider-list', d + '/insider.png', 4);
    await p.fill('#sm-congress-q', 'NVDA'); await sleep(1500);
    await el(p, '#sm-congress-list', d + '/search.png', 4);
    await ctx.close();
  },
  async community(b) {
    const d = mk('community'); const ctx = await ctxFor(b);
    let p = await open(ctx, '/trading-floor.html', 8000);
    await view(p, d + '/hero.png');
    await clickText(p, '.floor-pill', 'Setups'); await view(p, d + '/setups.png');
    await clickText(p, '.floor-pill', 'Setups');
    await p.evaluate(() => { const x = document.querySelector('[data-action="toggle-replies"]'); if (x) x.click(); }); await sleep(1800);
    await view(p, d + '/replies.png');
    await p.evaluate(() => { const x = document.getElementById('floor-fab-btn'); if (x) x.click(); }); await sleep(1500);
    await view(p, d + '/composer.png');
    await p.close();
    p = await open(ctx, '/achievements.html', 7000); await view(p, d + '/badges.png'); await p.close();
    p = await open(ctx, '/messages.html', 8000); await view(p, d + '/messages.png'); await p.close();
    await ctx.close();
  },
  async curriculum(b) {
    const d = mk('curriculum'); const ctx = await ctxFor(b);
    let p = await open(ctx, '/courses.html', 8000);
    await view(p, d + '/hero.png');
    for (const [f, name] of [['foundation', 'foundation'], ['advanced', 'advanced'], ['tracks', 'tracks']]) {
      await p.evaluate((k) => { const x = [...document.querySelectorAll('button,a')].find((e) => (e.dataset.level || e.dataset.filter) === k); if (x) x.click(); }, f); await sleep(1500);
      await view(p, d + '/' + name + '.png');
    }
    await p.close();
    p = await open(ctx, '/chapter.html?ch=05', 8000); await view(p, d + '/reader.png'); await p.close();
    p = await open(ctx, '/dashboard-user.html', 9000); await el(p, '#gp-path', d + '/path.png', 12); await view(p, d + '/dashboard.png'); await p.close();
    p = await open(ctx, '/achievements.html', 7000); await view(p, d + '/badges.png'); await p.close();
    await ctx.close();
  },
  async creators(b) {
    const d = mk('creators');
    let ctx = await ctxFor(b); let p = await open(ctx, '/creator-new.html', 7000); await view(p, d + '/start.png');
    p = await open(ctx, '/creator-hub.html', 9000); await view(p, d + '/hub.png'); await ctx.close();
    if (process.env.NO_LIVE) return;
    // the public example community, live (same as tools/creator/rn-shots.js)
    ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await ctx.addInitScript(() => { try { localStorage.setItem('stryker_theme', 'night'); localStorage.setItem('tz_consent', JSON.stringify({ v: 1, essential: true, analytics: false, at: new Date().toISOString() })); } catch (e) {} });
    p = await ctx.newPage();
    await p.goto('https://tradezoro.com/c/tradezoro', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.cp-stat', { timeout: 30000 }); await sleep(4000);
    await p.addStyleTag({ content: HIDE + ' .cp-stat:first-child,.cp-chip.demo{display:none!important}' }); await sleep(400);
    await view(p, d + '/page.png');
    for (const t of ['Indicators', 'Courses', 'Events', 'Feed']) {
      const ok = await p.evaluate((name) => { const x = [...document.querySelectorAll('.cp-tabs button, .cp-tabs a')].find((e) => e.textContent.trim().startsWith(name)); if (x) { x.click(); return true; } return false; }, t);
      if (!ok) { console.log('  no tab', t); continue; }
      await sleep(2500); await view(p, d + '/tab-' + t.toLowerCase() + '.png');
    }
    await ctx.close();
  },
};

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const k of Object.keys(SCENES)) {
      if (ONLY.length && !ONLY.includes(k)) continue;
      console.log('==', k);
      try { await SCENES[k](b); } catch (e) { console.log('  FAIL', k, String(e).slice(0, 300)); }
    }
  } finally { await b.close(); }
})();
