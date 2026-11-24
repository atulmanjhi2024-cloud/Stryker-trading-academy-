// /team browser test: empty state + sample team.json (2 mods, 5 ambassadors) at 390/412/1440, dark + light.
// Usage: serve repo (python3 -m http.server 8000) then: node tools/tests/team-page-browser.js [outDir]
const { launch, BASE } = require('./lib');
const fs = require('fs'), path = require('path');
const out = process.argv[2] || '/root/projects/stryker-notes/reports/workers/w-teampage-shots';
fs.mkdirSync(out, { recursive: true });
const SAMPLE = { moderators: [
  { name: 'Sample Mod One', tz: 'UTC+5:30', socials: { x: 'sample_one', youtube: 'samplechannel' } },
  { name: 'Sample Mod Two', tz: 'UTC-5', socials: { instagram: 'sample.two', tiktok: 'sample2', x: 'sample_two', youtube: 'sample2' } } ],
  ambassadors: ['Alex Sample', 'Bo', 'Cy Sample Longername Here', 'Dee Sample', 'Eli Sample'].map((n, i) => ({ name: n, tz: i % 2 ? 'UTC+1' : undefined, socials: i === 2 ? { x: 'cy' } : undefined })) };
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
(async () => {
  const b = await launch();
  for (const mode of ['empty', 'sample']) for (const theme of ['dark', 'light']) for (const w of [390, 412, 1440]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
    await ctx.addInitScript(t => { try { localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme);
    const p = await ctx.newPage();
    await p.route('**/assets/data/team.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(mode === 'sample' ? SAMPLE : { moderators: [], ambassadors: [] }) }));
    await p.goto(BASE + '/team.html'); await p.waitForSelector(mode === 'sample' ? '.tm-card' : '.tm-empty'); await p.waitForTimeout(300);
    const m = await p.evaluate(() => {
      const R = e => e.getBoundingClientRect(), cx = r => r.left + r.width / 2;
      const cards = [...document.querySelectorAll('.tm-card, .tm-empty')];
      const res = { hscroll: document.documentElement.scrollWidth > innerWidth, cards: cards.length, issues: [] };
      cards.forEach(c => {
        const r = R(c), cs = getComputedStyle(c);
        if (Math.abs(parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) > 1) res.issues.push('pad lr');
        [...c.children].forEach(ch => { const q = R(ch); if (Math.abs(cx(q) - cx(r)) > 1) res.issues.push('off-centre ' + ch.className); if (q.right > r.right + 0.5 || q.left < r.left - 0.5) res.issues.push('overflow ' + ch.className); });
        c.querySelectorAll('.tm-soc a').forEach(a => { const q = R(a), s = R(a.querySelector('svg')); if (Math.abs(cx(q) - cx(s)) > 1 || Math.abs((q.top + q.height / 2) - (s.top + s.height / 2)) > 1) res.issues.push('icon not centred'); if (q.width < 44 || q.height < 44) res.issues.push('tap<44'); });
        const av = c.querySelector('.tm-av'); if (av) { const q = R(av); if (Math.abs(q.width - q.height) > 0.5) res.issues.push('avatar not round'); }
        const t = c.querySelector('.tm-name'); if (t && t.scrollWidth > t.clientWidth + 1) res.issues.push('name clipped');
        const bd = c.querySelector('.tm-badge'); if (bd) { const bs = getComputedStyle(bd); if (Math.abs(parseFloat(bs.paddingLeft) - parseFloat(bs.paddingRight)) > 1) res.issues.push('badge pad'); }
      });
      document.querySelectorAll('.tm-grid').forEach(g => {
        const rs = [...g.children].map(R);
        if (Math.abs(Math.min(...rs.map(r => r.left)) - (innerWidth - Math.max(...rs.map(r => r.right)))) > 2) res.issues.push('grid not centred');
        const rows = [...new Set(rs.map(r => Math.round(r.top)))].sort((a, b) => a - b);
        const gaps = rows.slice(1).map((t, i) => t - Math.round(Math.max(...rs.filter(r => Math.round(r.top) === rows[i]).map(r => r.bottom))));
        if (new Set(gaps).size > 1) res.issues.push('row gaps differ ' + gaps);
        const lastRow = rs.filter(r => Math.round(r.top) === rows[rows.length - 1]);
        if (rows.length > 1 && Math.abs(lastRow[0].left - Math.min(...rs.map(r => r.left))) > 2 && lastRow.length * 2 < rs.filter(r => Math.round(r.top) === rows[0]).length) res.last = 'partial last row (centred by justify-content, ok)';
      });
      res.badges = [...document.querySelectorAll('.tm-badge')].map(x => x.textContent);
      res.links = [...document.querySelectorAll('.tm-soc a')].map(a => a.href);
      res.discord = [...document.querySelectorAll('.tm-cta')].map(a => a.href);
      return res;
    });
    const tag = `${mode}-${theme}-${w}`;
    ok(!m.hscroll, tag + ' horizontal scroll'); ok(!m.issues.length, tag + ' ' + [...new Set(m.issues)].join(','));
    if (mode === 'sample') { ok(m.cards === 7, tag + ' cards ' + m.cards); ok(m.badges.filter(x => x === 'Ambassador').length === 5, tag + ' badges'); ok(m.links.every(l => /^https:\/\/(x\.com|instagram\.com|youtube\.com|tiktok\.com)\//.test(l)), tag + ' links'); }
    else { ok(m.cards === 2, tag + ' empty cards'); ok(m.discord.length === 2 && m.discord.every(d => d === 'https://discord.gg/M4d4gTr5c3'), tag + ' discord link'); }
    await p.screenshot({ path: path.join(out, tag + '.png'), fullPage: true });
    await ctx.close();
  }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'team page: all passed'); process.exit(fails ? 1 : 0);
})();
