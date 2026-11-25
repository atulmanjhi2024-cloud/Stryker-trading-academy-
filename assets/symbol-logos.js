// TradeZoro — symbol logos: one round mark per symbol (search rows, watchlist, chart header pill).
//   crypto  -> the coin's own mark (assets/images/symbols/crypto/<coin>.svg|webp, top ~135 coins)
//   stocks / ETFs / OTC -> the company or fund issuer logo (assets/images/symbols/s/<TICKER>.webp, ~560 US tickers)
//   futures -> drawn icon by underlying (index number marks, metal coins, oil drop, flame, bond %, grain, two flags for FX)
//   indices -> index marks / volatility glyph / India-flag mark; forex -> two flags (fx-flags.js)
//   nothing found -> a tinted transparent circle with initials (last resort).
// Everything is self-hosted (no logo CDN at runtime), transparent (no tiles), lazy, with width/height set. The ticker->file
// lookup is ONE small JSON (images/symbols/map.json) loaded once; until it is there a row shows the badge, then swaps in place.
// Sources + licences: assets/images/symbols/LICENSES.md. Education only. Not financial advice.
import { fxMark } from './fx-flags.js?v=1298';
const DIR = '/assets/images/symbols/';
let MAP = null, loading = null;
const waiters = new Set();
function load() {
  if (MAP || loading) return loading;
  loading = fetch(DIR + 'map.json').then((r) => r.json()).then((m) => { MAP = m; waiters.forEach((f) => { try { f(); } catch (e) {} }); waiters.clear(); }).catch(() => { MAP = { s: {}, c: {} }; });
  return loading;
}
load();

const num = (txt, fill, fs) => '<circle cx="12" cy="12" r="12" fill="' + fill + '"/><text x="12" y="12" text-anchor="middle" dominant-baseline="central" font-family="-apple-system,BlinkMacSystemFont,Roboto,Segoe UI,sans-serif" font-weight="700" font-size="' + fs + '" fill="#fff">' + txt + '</text>';
const disc = (fill, inner) => '<circle cx="12" cy="12" r="12" fill="' + fill + '"/>' + inner;
// index marks (Owner 25 Nov: proper Nasdaq / S&P / Dow marks, not number badges); drawn here, nothing copied. Russell keeps its number.
const IDX = { sp: num('S&amp;P', '#d6313a', 8.4), ndx: disc('#0d2a4c', '<path d="M5.6 17.6 9.4 6.4h3.1L8.7 17.6zM15.3 17.6l3.8-11.2h-3.1l-3.8 11.2z" fill="#1fa8e0"/><path d="M11.2 8.2l2.6 8.4" stroke="#1fa8e0" stroke-width="2.3"/>'),
  dow: disc('#123a7a', '<text x="12" y="12.4" text-anchor="middle" dominant-baseline="central" font-family="Georgia,Times New Roman,serif" font-weight="700" font-size="10.5" fill="#fff">DJ</text><path d="M6.5 17.2h11" stroke="#7fb2ff" stroke-width="1"/>'), rut: num('2000', '#c9791a', 7.2) };
const GL = {
  vix: disc('#7a4fd1', '<path d="M4.5 13h3l2-5 3.5 9 2.5-6 1.2 2h3" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  oil: disc('#262a33', '<path d="M12 4.6c3.2 3.7 4.8 6.2 4.8 8.5a4.8 4.8 0 0 1-9.6 0c0-2.3 1.6-4.8 4.8-8.5z" fill="#f5a623"/><path d="M9.6 13.6a2.5 2.5 0 0 0 2 2.4" fill="none" stroke="#262a33" stroke-width="1.3" stroke-linecap="round"/>'),
  gas: disc('#1e7fd6', '<path d="M12.4 4.5c.4 2.6-2.8 4-2.8 7a2.9 2.9 0 0 0 1.6 2.6c-.6-1.8.6-2.9 1.6-3.9.2 1.2 1.2 1.6 1.2 3 0 1.1-.5 1.9-1.2 2.4 2.4-.2 3.9-1.8 3.9-4.2 0-2.7-2.3-4.6-4.3-6.9z" fill="#fff" transform="translate(-.4 1.2) scale(.97)"/>'),
  bond: disc('#3a5bd9', '<path d="M7.6 16.4l8.8-8.8" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/><circle cx="8.3" cy="8.3" r="1.9" fill="none" stroke="#fff" stroke-width="1.7"/><circle cx="15.7" cy="15.7" r="1.9" fill="none" stroke="#fff" stroke-width="1.7"/>'),
  grain: disc('#8a9a2b', '<path d="M12 19V8" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><path d="M12 8c-2.2-.2-3-1.7-3-3.2 2.2.1 3 1.4 3 3.2zM12 8c2.2-.2 3-1.7 3-3.2-2.2.1-3 1.4-3 3.2zM12 12.4c-2.2-.2-3.2-1.6-3.2-3.1 2.2 0 3.2 1.3 3.2 3.1zM12 12.4c2.2-.2 3.2-1.6 3.2-3.1-2.2 0-3.2 1.3-3.2 3.1zM12 16.6c-2.2-.2-3.2-1.6-3.2-3.1 2.2 0 3.2 1.3 3.2 3.1zM12 16.6c2.2-.2 3.2-1.6 3.2-3.1-2.2 0-3.2 1.3-3.2 3.1z" fill="#fff"/>'),
  cu: disc('#c46b3a', '<circle cx="12" cy="12" r="7.8" fill="none" stroke="#f6d3bd" stroke-width="1.5"/>'),
  pt: disc('#8d99a8', '<circle cx="12" cy="12" r="7.8" fill="none" stroke="#e8edf3" stroke-width="1.5"/>'),
  nifty: '<clipPath id="slgin"><circle cx="12" cy="12" r="12"/></clipPath><g clip-path="url(#slgin)"><rect width="24" height="8" fill="#ff9933"/><rect y="8" width="24" height="8" fill="#fff"/><rect y="16" width="24" height="8" fill="#138808"/></g><circle cx="12" cy="12" r="3.1" fill="none" stroke="#000080" stroke-width="1"/><circle cx="12" cy="12" r=".9" fill="#000080"/>',
  bank: '<clipPath id="slgib"><circle cx="12" cy="12" r="12"/></clipPath><g clip-path="url(#slgib)"><rect width="24" height="8" fill="#ff9933"/><rect y="8" width="24" height="8" fill="#fff"/><rect y="16" width="24" height="8" fill="#138808"/></g><path d="M7.5 15h9M8.5 15v-3.6M12 15v-3.6M15.5 15v-3.6M7 11l5-3 5 3z" fill="none" stroke="#000080" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/>'
};
// futures root -> [icon]. Micros use the same icon as the big contract.
const FUT = {};
const put = (roots, v) => roots.split(' ').forEach((r) => { FUT[r] = v; });
put('ES MES EW', IDX.sp); put('NQ MNQ', IDX.ndx); put('YM MYM', IDX.dow); put('RTY M2K', IDX.rut);
put('GC MGC QO', 'fx:XAUUSD'); put('SI SIL QI', 'fx:XAGUSD'); put('HG MHG', GL.cu); put('PL PA', GL.pt);
put('CL MCL QM BZ RB HO', GL.oil); put('NG MNG QG', GL.gas);
put('ZB ZN ZF ZT UB TN ZQ SR3', GL.bond); put('ZC ZS ZW ZL ZM KE ZO', GL.grain); put('VX VXM', GL.vix);
put('6E M6E E7', 'fx:EURUSD'); put('6B M6B', 'fx:GBPUSD'); put('6J', 'fx:JPYUSD'); put('6A M6A', 'fx:AUDUSD'); put('6C', 'fx:CADUSD'); put('6S', 'fx:CHFUSD'); put('6N', 'fx:NZDUSD'); put('6M', 'fx:MXNUSD');
put('BTC MBT', 'c:btc'); put('ETH MET', 'c:eth');
const USD = '<clipPath id="slgus"><circle cx="12" cy="12" r="12"/></clipPath><g clip-path="url(#slgus)"><rect width="24" height="24" fill="#fff"/><g fill="#d6313a"><rect y="0" width="24" height="3.4"/><rect y="6.8" width="24" height="3.4"/><rect y="13.7" width="24" height="3.4"/><rect y="20.6" width="24" height="3.4"/></g><rect width="12.5" height="10.2" fill="#123a7a"/><g fill="#fff"><circle cx="3.2" cy="2.6" r=".8"/><circle cx="7" cy="2.6" r=".8"/><circle cx="10.4" cy="2.6" r=".8"/><circle cx="5.1" cy="5.2" r=".8"/><circle cx="8.7" cy="5.2" r=".8"/><circle cx="3.2" cy="7.7" r=".8"/><circle cx="7" cy="7.7" r=".8"/><circle cx="10.4" cy="7.7" r=".8"/></g></g>';   // DXY: the US flag (drawn here)
const INDEX = { DXY: USD, USDX: USD, SPX: IDX.sp, SPXW: IDX.sp, GSPC: IDX.sp, NDX: IDX.ndx, IXIC: IDX.ndx, DJI: IDX.dow, DJIA: IDX.dow, US30: IDX.dow, NAS100: IDX.ndx, US100: IDX.ndx, USTEC: IDX.ndx, SPX500: IDX.sp, US500: IDX.sp, RUT: IDX.rut, VIX: GL.vix, VVIX: GL.vix, NIFTY: GL.nifty, NIFTY50: GL.nifty, BANKNIFTY: GL.bank, NIFTYBANK: GL.bank };
const FUT_ROOTS = Object.keys(FUT).sort((a, b) => b.length - a.length);
// fund issuers: ticker -> logo file (issuer mark). Not listed -> description, then the initials badge.
const ETF = {};
const etf = (list, f) => list.split(' ').forEach((t) => { ETF[t] = f; });
etf('SPY DIA MDY SPYG SPYV SPLG GLD GLDM XLK XLF XLE XLV XLY XLP XLI XLU XLB XLRE XLC XBI XRT XOP XHB KRE KBE XME', 'SPDR');
etf('QQQ QQQM RSP QQQJ SPHD SPLV', 'IVZ');
etf('IWM IVV IWF IWD IEF IEMG EEM EFA AGG LQD TLT SHY HYG IAU SLV IBIT SOXX IYR IJH IJR ITOT IWB IWN IWO IWV IXUS IDEV EWZ EWJ EWY EWT EWH FXI MBB TIP IEI IGV ITB IYT USMV EMB JNK', 'BLK');
const BRAND = [[/ISHARES/, 'BLK'], [/SPDR/, 'SPDR'], [/INVESCO/, 'IVZ']];

const hue = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; };
const stripQ = (t) => { const x = String(t).toUpperCase().replace(/\.P$|-SWAP$|[-_/]?PERP$/, '').replace(/[-_/]/g, ''); const m = /(USDT|USDC|FDUSD|USD1|USDS|BUSD|TUSD|USD|EUR|BTC|ETH)$/.exec(x); return m && x.length > m[1].length ? x.slice(0, -m[1].length) : x; };
const CRYPTO_V = 'binance coinbase hyperliquid bybit okx bitget kraken vest'.split(' ');
const FUT_V = 'futures cme cbot cbot_mini comex nymex cme_mini'.split(' ');
const bare = (t) => String(t || '').replace(/^[^:]*:/, '').toUpperCase();

// -> { k: 'img'|'svg'|'fx'|'badge', ... } (null-safe; always something)
export function resolve(prefix, ticker, desc, type) {
  const p0 = String(prefix || '').toLowerCase(), T = bare(ticker), ty = String(type || '').toLowerCase(), D = String(desc || '').toUpperCase();
  const M = MAP || { s: {}, c: {} };
  let p = p0;
  if (!p0 && !ty) {   // a bare ticker (multi-chart cell label): read the kind from its shape
    if (/\d*!$|^[A-Z0-9]{1,3}[FGHJKMNQUVXZ]\d{1,2}$/.test(T) && FUT_ROOTS.some((x) => T.startsWith(x))) p = 'futures';
    else if (/^[A-Z]{6}$/.test(T) && fxMark(T, 8)) p = 'fx';
    else if (/(USDT|USDC|FDUSD|PERP|-USD|-SWAP)$/.test(T)) p = 'binance';
  }
  const coin = (b) => {
    let k = b.toLowerCase();
    if (!M.c[k]) k = k.replace(/^(1000000|100000|10000|1000|1m|k)/, '');
    return M.c[k] ? { k: 'img', src: DIR + 'crypto/' + k + '.' + M.c[k], t: '' } : null;
  };
  if (p === 'fx' || ty === 'forex') { const f = fxMark(T, 36); if (f) return { k: 'fx', t: T }; }
  if (FUT_V.includes(p) || ty === 'futures' && !CRYPTO_V.includes(p)) {
    const root = T.replace(/\d*!$/, '');
    const r = FUT[root] ? root : FUT_ROOTS.find((x) => root.startsWith(x) && /^[FGHJKMNQUVXZ]\d{1,4}$/.test(root.slice(x.length)));
    const v = r && FUT[r];
    if (v) {
      if (v.startsWith('fx:')) return { k: 'fx', t: v.slice(3) };
      if (v.startsWith('c:')) return coin(v.slice(2)) || { k: 'badge', t: root };
      return { k: 'svg', html: v, t: root };
    }
    return { k: 'badge', t: root };
  }
  if (CRYPTO_V.includes(p) || ty === 'crypto') {
    const b = stripQ(T), c = coin(b);
    return c || { k: 'badge', t: b, coin: 1 };
  }
  if (INDEX[T] && (ty === 'index' || p === 'idx' || p === '' || !M.s[T])) return { k: 'svg', html: INDEX[T], t: T };
  // stocks / ETFs / OTC: exchange-prefixed tickers ("NASDAQ:AAPL") and share-class dots
  let s = T.replace(/^.*:/, '');
  const alt = [s, s.replace('.', '-'), s.replace('.', '')];
  for (const a of alt) if (a in M.s) return { k: 'img', src: DIR + 's/' + a + '.webp', f: M.s[a], t: s };
  const e = ETF[s] || (BRAND.find((b) => b[0].test(D)) || [])[1];
  if (e && e in M.s) return { k: 'img', src: DIR + 's/' + e + '.webp', f: M.s[e], t: s };
  return { k: 'badge', t: s };
}

let styled = false;
function css() {
  if (styled || typeof document === 'undefined') return; styled = true;
  const st = document.createElement('style'); st.id = 'stk-slg-style';
  st.textContent = '.slg{flex:none;display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;line-height:0;box-sizing:border-box;border-radius:50%;background:transparent;overflow:hidden;}' +
    '.slg>img,.slg>svg{display:block;width:100%;height:100%;object-fit:contain;}' +
    '.slg.slg-img>img{width:86%;height:86%;}' +
    '.slg.slg-fx{overflow:visible;border-radius:0;}' +
    '.slg-b{font:700 11px/1 -apple-system,BlinkMacSystemFont,Roboto,"Segoe UI",system-ui,sans-serif;letter-spacing:.02em;color:hsl(var(--slg-h) 70% 72%);background:hsl(var(--slg-h) 60% 55% / .18);}' +
    ':root[data-theme="light"] .slg-b{color:hsl(var(--slg-h) 65% 30%);background:hsl(var(--slg-h) 60% 45% / .14);}' +
    // single-colour marks drawn white (for the dark theme) / black: lightened or darkened where they would vanish
    ':root[data-theme="light"] .slg img[data-f="w"]{filter:invert(1);}' +
    ':root:not([data-theme="light"]) .slg img[data-f="k"]{filter:invert(1);}';
  document.head.appendChild(st);
}

// size = box in px. Returns a span; never throws. A late map load repaints the same span in place.
export function symLogo(prefix, ticker, desc, type, size = 36) {
  css();
  const s = document.createElement('span');
  s.className = 'slg'; s.setAttribute('aria-hidden', 'true');
  s.style.width = s.style.height = size + 'px';
  const paint = () => {
    s.replaceChildren(); s.className = 'slg'; s.removeAttribute('style'); s.style.width = s.style.height = size + 'px';
    const r = resolve(prefix, ticker, desc, type);
    if (r.k === 'fx') { s.classList.add('slg-fx'); const f = fxMark(r.t, size); if (f) { s.appendChild(f); return; } }
    if (r.k === 'svg') { s.innerHTML = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24">' + r.html + '</svg>'; return; }
    if (r.k === 'img') {
      s.classList.add('slg-img');
      const i = new Image(); i.alt = ''; i.width = i.height = size; i.decoding = 'async'; i.loading = 'lazy';
      if (r.f) i.dataset.f = r.f;
      i.onerror = () => { s.replaceChildren(); badge(r.t || String(ticker)); };
      i.src = r.src; s.appendChild(i); return;
    }
    badge(r.t || String(ticker));
  };
  const badge = (t) => {
    const x = String(t || '?').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    s.classList.remove('slg-img'); s.classList.add('slg-b'); s.style.setProperty('--slg-h', hue(x));
    s.style.fontSize = Math.max(8, Math.round(size * .3)) + 'px'; s.textContent = x.slice(0, 3) || '?';
  };
  if (!MAP) { badge(bare(ticker)); waiters.add(paint); } else paint();
  return s;
}

// "binance:BTCUSDT" / "futures:ES1!" / "fx:EURUSD" / "stocks:NASDAQ:AAPL" / "idx:SPY"
export function symLogoOf(sym, size = 36, desc, type) {
  const m = /^([^:]+):(.*)$/.exec(String(sym || '')), ct = m && /^byo$/i.test(m[1]) && /^CT:/i.test(m[2]);   // byo:CT:<broker name>: read the kind from its shape
  const t = ct ? m[2].slice(3) : m ? m[2] : String(sym || '');
  const pre = ct ? (/^[A-Z0-9]{2,6}USDT?$/i.test(t) && !fxMark(t, 8) && !INDEX[t.toUpperCase()] ? 'binance' : '') : m ? m[1] : '';   // a cTrader crypto CFD (BTCUSD) -> its coin
  return symLogo(pre, t, desc, type, size);
}
export const logoReady = () => load();
