// TradeZoro — forex pair marks: two round country flags (base top-left, quote bottom-right, overlapping, a gap cut
// out of the base flag around the quote flag so the two separate on any row colour). XAU / XAG are a plain gold /
// silver coin. Every flag is drawn here, simplified (no text); nothing is copied from another platform.
// Used by venue-logos.js (chart symbol button, watchlist, indicator-dialog field) and chart-search.js (list rows).
// Education only. Not financial advice.
const star = (cx, cy, r, f) => {
  let p = '';
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, d = i % 2 ? r * 0.4 : r; p += (i ? 'L' : 'M') + (cx + d * Math.cos(a)).toFixed(2) + ' ' + (cy + d * Math.sin(a)).toFixed(2); }
  return '<path d="' + p + 'Z" fill="' + f + '"/>';
};
const R = (x, y, w, h, f) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + f + '"/>';
const C = (x, y, r, f) => '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + f + '"/>';
const L = (d, w, c) => '<path d="' + d + '" stroke="' + c + '" stroke-width="' + w + '" fill="none"/>';
const UK = R(0, 0, 24, 24, '#012169') + L('M0 0L24 24M24 0L0 24', 4.8, '#fff') + L('M0 0L24 24M24 0L0 24', 1.6, '#C8102E') + R(9, 0, 6, 24, '#fff') + R(0, 9, 24, 6, '#fff') + R(10.2, 0, 3.6, 24, '#C8102E') + R(0, 10.2, 24, 3.6, '#C8102E');
const UKS = '<g transform="scale(.5)">' + UK + '</g>';   // canton for AU / NZ
const stripesH = (a, b, c) => R(0, 0, 24, 8, a) + R(0, 8, 24, 8, b) + R(0, 16, 24, 8, c);
let us = R(0, 0, 24, 24, '#fff');
for (let i = 0; i < 7; i += 2) us += R(0, i * 24 / 7, 24, 24 / 7, '#B22234');
us += R(0, 0, 12, 24 * 4 / 7, '#3C3B6E');
for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) us += C(2.4 + x * 3.6, 2.6 + y * 3.8, .85, '#fff');
const nordic = (bg, o, w, fg) => R(0, 0, 24, 24, bg) + R(o, 0, w, 24, fg) + R(0, 12 - w / 2, 24, w, fg);
let hk = R(0, 0, 24, 24, '#DE2910');
for (let k = 0; k < 5; k++) hk += '<ellipse cx="12" cy="8.4" rx="1.7" ry="3.3" fill="#fff" transform="rotate(' + k * 72 + ' 12 12)"/>';
let sg = R(0, 0, 24, 12, '#EF3340') + R(0, 12, 24, 12, '#fff') + C(7.5, 6, 3.8, '#fff') + C(9.1, 6, 3.4, '#EF3340');
for (let k = 0; k < 5; k++) sg += C(14 + 3.1 * Math.cos(-Math.PI / 2 + k * 1.2566), 6 + 3.1 * Math.sin(-Math.PI / 2 + k * 1.2566), .8, '#fff');
let eu = R(0, 0, 24, 24, '#0039A6');
for (let k = 0; k < 12; k++) eu += C(12 + 7 * Math.cos(k * Math.PI / 6), 12 + 7 * Math.sin(k * Math.PI / 6), 1.15, '#FFCC00');
const FLAG = {
  USD: us, EUR: eu, GBP: UK,
  JPY: R(0, 0, 24, 24, '#fff') + C(12, 12, 6.6, '#BC002D'),
  CHF: R(0, 0, 24, 24, '#DA291C') + R(10, 5, 4, 14, '#fff') + R(5, 10, 14, 4, '#fff'),
  CAD: R(0, 0, 24, 24, '#fff') + R(0, 0, 6, 24, '#D52B1E') + R(18, 0, 6, 24, '#D52B1E') + '<path d="M12 4L13.6 7.2 15.6 6.4 15 10.6 17.6 9 17.2 10.8 19 12.4 15.8 13.8 16.2 15.2 12.6 14.6V18.5H11.4V14.6L7.8 15.2 8.2 13.8 5 12.4 6.8 10.8 6.4 9 9 10.6 8.4 6.4 10.4 7.2Z" fill="#D52B1E"/>',
  AUD: R(0, 0, 24, 24, '#00247D') + UKS + star(6, 18, 2.8, '#fff') + star(17, 15.5, 1.5, '#fff') + star(20.5, 9.5, 1.5, '#fff') + star(14.5, 4.5, 1.5, '#fff') + star(17, 21, 1.5, '#fff'),
  NZD: R(0, 0, 24, 24, '#00247D') + UKS + [[17, 6], [20.5, 11.5], [17, 18], [13.5, 11.5]].map((p) => star(p[0], p[1], 2.4, '#fff') + star(p[0], p[1], 1.7, '#CC142B')).join(''),
  SEK: nordic('#006AA7', 6, 4, '#FECC00'),
  NOK: R(0, 0, 24, 24, '#BA0C2F') + R(5, 0, 5.4, 24, '#fff') + R(0, 9.3, 24, 5.4, '#fff') + R(6.6, 0, 2.2, 24, '#00205B') + R(0, 10.9, 24, 2.2, '#00205B'),
  DKK: nordic('#C8102E', 6.5, 3, '#fff'),
  SGD: sg, HKD: hk,
  MXN: R(0, 0, 8, 24, '#006847') + R(8, 0, 8, 24, '#fff') + R(16, 0, 8, 24, '#CE1126') + C(12, 12, 2.6, '#8C6D3F') + C(12, 12, 1.3, '#6A9A3A'),
  ZAR: R(0, 0, 24, 12, '#DE3831') + R(0, 12, 24, 12, '#002395') + L('M-2 -2L9 12L-2 26M9 12H26', 8.4, '#fff') + L('M-2 -2L9 12L-2 26M9 12H26', 5, '#007A4D') + '<path d="M0 3L10 12 0 21Z" fill="#FFB612"/><path d="M0 5.6L7 12 0 18.4Z" fill="#000"/>',
  TRY: R(0, 0, 24, 24, '#E30A17') + C(9, 12, 5.8, '#fff') + C(10.9, 12, 4.6, '#E30A17') + star(15.2, 12, 2.6, '#fff'),
  PLN: R(0, 0, 24, 12, '#fff') + R(0, 12, 24, 12, '#DC143C'),
  CNH: R(0, 0, 24, 24, '#DE2910') + star(6.5, 6.5, 4, '#FFDE00') + star(12.6, 3.2, 1.2, '#FFDE00') + star(14.6, 6.4, 1.2, '#FFDE00') + star(14.6, 10, 1.2, '#FFDE00') + star(12.6, 13, 1.2, '#FFDE00')
};
const COIN = {
  XAU: ['#F7D774', '#C99A1B', '#fff3c4'],
  XAG: ['#E8EBEF', '#9AA3AE', '#ffffff']
};
const disc = (i, x, y, s, inner) => '<svg x="' + x + '" y="' + y + '" width="' + s + '" height="' + s + '" viewBox="0 0 24 24"><clipPath id="' + i + '"><circle cx="12" cy="12" r="12"/></clipPath><g clip-path="url(#' + i + ')">' + inner + '</g></svg>';
const coin = (k, id, x, y, s) => {
  const c = COIN[k];
  return disc(id, x, y, s, '<defs><linearGradient id="' + id + 'g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + c[0] + '"/><stop offset="1" stop-color="' + c[1] + '"/></linearGradient></defs>' +
    C(12, 12, 12, 'url(#' + id + 'g)') + '<circle cx="12" cy="12" r="8.6" fill="none" stroke="' + c[2] + '" stroke-opacity=".75" stroke-width="1.6"/>');
};

// "EURUSD" / "fx:EURUSD" / "OANDA:EURUSD" -> a ready span, or null when this is not a pair we can draw.
// size = the mark's box in px (same box as the venue marks: 18; 36 in the search list).
export function fxMark(ticker, size) {
  const t = String(ticker || '').replace(/^[^:]*:/, '').toUpperCase().replace(/[^A-Z]/g, '');
  if (t.length !== 6) return null;
  const b = t.slice(0, 3), q = t.slice(3), id = 'fx' + t + size;
  let inner;
  if (COIN[b] && FLAG[q]) inner = coin(b, id, 0, 0, size);
  else if (FLAG[b] && FLAG[q]) {
    const d = Math.round(size * 2 / 3 * 100) / 100, o = size - d, gap = 1.5;
    // base flag with a ring-shaped bite taken out around the quote flag (a mask, so it works on hover / selected rows too)
    const m = '<mask id="' + id + 'm"><rect width="' + size + '" height="' + size + '" fill="#fff"/><circle cx="' + (o + d / 2) + '" cy="' + (o + d / 2) + '" r="' + (d / 2 + gap) + '" fill="#000"/></mask>';
    inner = '<defs>' + m + '</defs><g mask="url(#' + id + 'm)">' + disc(id + 'b', 0, 0, d, FLAG[b]) + '</g>' + disc(id + 'q', o, o, d, FLAG[q]);
  } else return null;
  const s = document.createElement('span');
  s.className = 'fxm'; s.setAttribute('aria-hidden', 'true'); s.dataset.fx = t;
  s.style.width = s.style.height = size + 'px';
  s.innerHTML = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' + inner + '</svg>';
  return s;
}
export const fxCss = '.fxm{flex:none;display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;line-height:0;}.fxm svg{display:block;overflow:visible;}';
