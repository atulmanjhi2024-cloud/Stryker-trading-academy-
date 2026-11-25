// TradeZoro — CONTRACT-MONTH chart header (25 Nov). On a month chart (futures:MESZ2026) the statusline reads
// "MES · Dec 2026 · CME · 15m" with an "Expires 18 Dec" chip; in the last ROLL_DAYS days before expiry a "Rolls to Mar 2027"
// button switches that chart to the next month in one tap. A month with no prices yet says so instead of an empty chart.
// Continuous charts (MES1!) are never touched. Same re-attach pattern as chart-data-dot.js (MutationObserver on #vela-chart).
// Uses: ws.context().cells, ws.cell(id).setSymbol / .chart.orchestrator.rawBars; fut-months.js. Education only. Not financial advice.
import { monthOfSym } from './chart-sym.js?v=1296';
import { label, fmtExpiry, expiryOf, rollInfo, rollOf, chartSym } from './fut-months.js?v=1296';

export const EMPTY_NOTE = 'Prices for this month start closer to expiry';
const EMPTY_WAIT_MS = 6000;   // a slow first page is not "no prices": wait this long after the switch before saying so

export function installFutMonth(ws, opts = {}) {
  const host = document.getElementById('vela-chart');
  if (!host) return null;
  const since = new Map();   // cell id -> { sym, at } of the last symbol switch (for the empty note)
  if (opts.loadFeed) opts.loadFeed().then(() => schedule());

  function cellOf(id) { try { return ws.cell(id); } catch (e) { return null; } }
  function barsOf(id) { const c = cellOf(id); try { return c.chart.orchestrator.rawBars.length; } catch (e) { return -1; } }

  function sync() {
    let cells = [];
    try { cells = ws.context().cells; } catch (e) { return; }
    const now = Date.now();
    cells.forEach((c) => {
      const node = host.querySelector('.vela-cell[data-cell-id="' + c.id + '"]');
      if (!node) return;
      const sl = node.querySelector('.vela-statusline');
      const mo = monthOfSym(c.symbol);
      let box = sl && sl.querySelector('.stkc-fm');
      let note = node.querySelector(':scope > .stkc-fm-empty');
      if (!mo || !sl) { if (box) box.remove(); if (note) note.remove(); if (sl) sl.classList.remove('stkc-is-month'); return; }
      const sym = sl.querySelector('.vela-sl-symbol'), meta = sl.querySelector('.vela-sl-meta');
      // "MES" + "· Dec 2026 · CME · 15m": keep Vela's interval tail, replace its provider word
      if (sym && sym.textContent !== mo.root) { sym.textContent = mo.root; sym.title = mo.code; }
      if (meta) {
        const tf = (meta.textContent.split('·').pop() || '').trim(), want = '· ' + label(mo) + ' · CME' + (tf && !/futures/i.test(tf) ? ' · ' + tf : '');
        if (meta.textContent !== want) meta.textContent = want;
      }
      sl.classList.add('stkc-is-month');
      const roll = rollOf(mo.root), exp = expiryOf(mo, roll, now), ri = rollInfo(mo, roll, now);
      if (!box) { box = document.createElement('span'); box.className = 'stkc-fm'; }
      // desktop: after the data dot ("… · 15m  ● Delayed  [Expires 18 Dec]"); phone: the dot leads the row, so right after the meta
      const dd = sl.querySelector('.stkc-dd'), anchor = dd && dd.previousElementSibling === meta ? dd : meta;
      if (anchor && box.previousElementSibling !== anchor) anchor.after(box);
      const key = mo.code + '|' + exp + '|' + (ri ? ri.to.code : '');
      if (box.dataset.k !== key) {
        box.dataset.k = key;
        box.textContent = '';
        if (exp) { const e = document.createElement('span'); e.className = 'stkc-fm-chip'; e.textContent = 'Expires ' + fmtExpiry(exp); e.title = mo.code + ' expires ' + fmtExpiry(exp) + ' ' + exp.slice(0, 4); box.appendChild(e); }
        if (ri) {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'stkc-fm-chip stkc-fm-roll';
          b.textContent = 'Rolls to ' + label(ri.to);
          b.setAttribute('aria-label', 'Switch this chart to ' + ri.to.code + ' (' + label(ri.to) + ')');
          b.dataset.to = chartSym(ri.to);
          b.addEventListener('click', (ev) => { ev.stopPropagation(); const cl = cellOf(c.id); try { (cl || ws.active).setSymbol(b.dataset.to); } catch (e) {} });
          box.appendChild(b);
        }
      }
      // empty month: say why, never an unexplained blank chart (and never the continuous contract's prices instead)
      const s = since.get(c.id);
      if (!s || s.sym !== c.symbol) since.set(c.id, { sym: c.symbol, at: now });
      const empty = barsOf(c.id) === 0 && now - since.get(c.id).at > EMPTY_WAIT_MS;
      if (empty && !note) { note = document.createElement('div'); note.className = 'stkc-venue-note stkc-fm-empty'; note.setAttribute('role', 'status'); note.textContent = EMPTY_NOTE + ' (' + mo.code + ').'; node.appendChild(note); }
      else if (!empty && note) note.remove();
    });
  }
  let raf = 0;
  function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; sync(); }); }
  const readout = (m) => { const e = m.target.nodeType === 1 ? m.target : m.target.parentElement; return !!(e && e.closest('.vela-sl-ohlc,.vela-sl-change,.vela-widget-bottombar,.stkc-fm')); };
  new MutationObserver((ms) => { if (!ms.every(readout)) schedule(); }).observe(host, { childList: true, subtree: true });
  ['state:changed', 'layout:changed', 'cell:active'].forEach((ev) => { try { ws.on(ev, schedule); } catch (e) {} });
  setInterval(() => { if (!document.hidden) sync(); }, 2000);
  schedule();
  return { sync };
}
