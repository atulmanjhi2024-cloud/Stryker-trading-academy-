// AUTO-LIVEFIX shots: Trade menu row (account NAME + small number line), order panel footer badge, Reconnect pill. Mocked broker, sample data.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8061', OUT = process.argv[2] || '/tmp/lf';
const ACC = '123e4567-e89b-12d3-a456-426614174000', US = '0aaa1111-2222-3333-4444-555566667777';
let fail = 0; const check = (ok, m, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + m + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 500) : '')); };
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile, theme] of [[1440, 900, false, 'dark'], [1440, 900, false, 'light'], [412, 915, true, 'dark'], [390, 844, true, 'dark'], [390, 844, true, 'light']]) {
      const tag = w + '-' + theme;
      const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
      await ctx.addInitScript(stub);
      await ctx.addInitScript(({ t, US }) => { window.__stkLiveTest = { isAdmin: () => true, last: () => 28750, fastRetry: true }; window.__stkOpTest = { q: { bid: 28749.75, ask: 28750 }, quote() { return this.q; } };
        try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); localStorage.setItem('stryker_broker_sync_user_u1', US); } catch (e) {} }, { t: theme, US });
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
      let expired = false;
      await ctx.route('**/connect/finatic/**', async (r) => {
        const u = new URL(r.request().url()); let body = {}; try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
        const j = (o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
        if (u.pathname.endsWith('/session')) return j(r.request().method() === 'GET' ? { configured: true } : { portalUrl: 'http://127.0.0.1:1/p', sessionId: 's', userId: US });
        if (u.pathname.endsWith('/data')) {
          if (body.op === 'accounts') return j({ userId: US, data: [{ accountId: ACC, accountName: 'SAMPLEDEMO5551234', accountNumber: '70001234', brokerName: 'tradovate' }] });
          if (body.op === 'live') return expired ? j({ error: 'Connect again', needsConnect: true, code: 'needs_connect' }, 409) : j({ data: { positions: [], orders: [] } });
          return j({ data: [] });
        }
        if (body.op === 'env') return j({ env: 'live', enabled: true });
        if (body.op === 'schema') return j({ data: { fields: {} }, env: 'live' });
        if (body.op === 'bracket') return j({ ok: true, group: null });
        return j({ error: 'no writes in this test' }, 400);
      });
      const p = await ctx.newPage();
      await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.__stkHeavyReady && window.__stkPaper && window.__stkLive && window.__stkLive.state.accounts.length, null, { timeout: 60000 });
      await p.evaluate(async () => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 200)); if (ws.chart.market.symbol === 'futures:NQ1!') break; } });
      await p.evaluate(() => window.__stkPaper.openTradeMenu());
      await p.waitForSelector('#stkc-trade-pop:not([hidden]) [data-a=live]', { timeout: 8000 });
      await new Promise((r) => setTimeout(r, 400));
      const row = await p.evaluate(() => {
        const r = document.querySelector('#stkc-trade-pop .stktm-row [data-a=live]').closest('.stktm-row'); const q = (s) => r.querySelector(s);
        const box = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, cy: b.top + b.height / 2, sw: e.scrollWidth, cw: e.clientWidth }; };
        const nm = q('.stktm-nm'), l2 = q('.stktm-l2'), num = q('.stktm-num');
        return { nm: nm && nm.textContent, l2: l2 && l2.textContent, num: num ? num.textContent : null, nmBox: box(nm), l1: box(q('.stktm-l1')), logo: box(q('.stktm-logo, img, .stktm-ic')), row: box(r), pop: box(document.getElementById('stkc-trade-pop')), hscroll: document.documentElement.scrollWidth > innerWidth + 1 };
      });
      console.log('ROW ' + tag + ' ' + JSON.stringify(row));
      check(row.nm === 'SAMPLEDEMO5551234', tag + ': Trade menu row shows the account NAME', row);
      check(/#70001234/.test(row.l2) && row.num === null, tag + ': the number is only a small second line', row);
      check(row.nmBox.sw <= row.nmBox.cw + 1, tag + ': name not clipped', row.nmBox);
      check(!row.hscroll && row.pop.r <= w + 0.5 && row.pop.l >= -0.5, tag + ': menu inside the viewport, no horizontal scroll', row.pop);
      await p.screenshot({ path: OUT + '/menu-' + tag + '.png' });
      const pop = await p.$('#stkc-trade-pop'); if (pop) await pop.screenshot({ path: OUT + '/crop-menu-' + tag + '.png' });
      // pick the live account: header strip, badge, panel footer
      await p.evaluate((id) => document.querySelector('#stkc-trade-pop [data-a=live][data-id="' + id + '"]').click(), ACC);
      await p.waitForFunction(() => window.__stkLive.state.acct && document.querySelector('.stklv-cbadge'), null, { timeout: 10000 });
      await p.evaluate(() => window.__stkPaper.orderPanel && window.__stkPaper.orderPanel());
      await p.waitForFunction(() => { const o = document.getElementById('stkop'); return o && !o.hidden && o.getBoundingClientRect().height > 100; }, null, { timeout: 8000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 600));
      const lab = await p.evaluate(() => {
        const a = document.querySelector('#stkop .stkop-acct.live'), cb = document.querySelector('.stklv-cbadge'), btn = document.querySelector('#stkc-paper-btn .stkc-btn-l');
        const bx = (e) => { if (!e) return null; const b = e.getBoundingClientRect(), cs = getComputedStyle(e); return { w: b.width, sw: e.scrollWidth, cw: e.clientWidth, pl: parseFloat(cs.paddingLeft), pr: parseFloat(cs.paddingRight) }; };
        return { acct: a && a.textContent, ell: a && getComputedStyle(a).textOverflow, acctBox: bx(a), badge: cb && cb.textContent, badgeBox: bx(cb), btn: btn && btn.offsetParent ? btn.textContent : '(hidden)' };
      });
      console.log('LAB ' + tag + ' ' + JSON.stringify(lab));
      check(/SAMPLEDEMO5551234/.test(lab.acct || '') && /SAMPLEDEMO5551234/.test(lab.badge || '') && !/70001234|…/.test((lab.acct || '') + lab.badge), tag + ': panel footer + chart badge use the account name', lab);
      check(lab.acctBox && Math.abs(lab.acctBox.pl - lab.acctBox.pr) <= 1, tag + ': footer badge even padding', lab.acctBox);
      check(lab.acctBox && (lab.acctBox.sw <= lab.acctBox.cw + 1 || lab.ell === 'ellipsis'), tag + ': footer badge text fits (or ends in an ellipsis)', lab);
      await p.screenshot({ path: OUT + '/live-' + tag + '.png' });
      // expired connection -> quiet Reconnect pill under Connect a broker
      expired = true; await p.evaluate(() => { window.__stkLive.state.reading = false; return window.__stkLive.read(); });
      await p.waitForFunction(() => /renew/.test(window.__stkLive.state.readErr || ''), null, { timeout: 8000 }).catch(() => {});
      await p.evaluate(() => { const m = document.getElementById('stkc-trade-pop'); if (m && !m.hidden) m.hidden = true; window.__stkPaper.openTradeMenu(); });
      const rc = await p.waitForSelector('#stkc-trade-pop:not([hidden]) [data-a=reconnect]', { timeout: 6000 }).then(() => true, () => false);
      const al = rc ? await p.evaluate(() => { const r = document.querySelector('#stkc-trade-pop [data-a=reconnect]').getBoundingClientRect(), c = document.querySelector('#stkc-trade-pop [data-a=connect]').getBoundingClientRect(), svg = document.querySelector('#stkc-trade-pop [data-a=reconnect] svg').getBoundingClientRect(); return { rh: r.height, ch: c.height, iconCy: svg.top + svg.height / 2, cy: r.top + r.height / 2, rl: r.left, cl: c.left }; }) : null;
      check(rc && Math.abs(al.iconCy - al.cy) <= 1 && Math.abs(al.rl - al.cl) <= 1, tag + ': expired: a Reconnect pill (icon centred, aligned with Connect a broker)', al);
      if (pop) await (await p.$('#stkc-trade-pop')).screenshot({ path: OUT + '/crop-menu-reconnect-' + tag + '.png' });
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
