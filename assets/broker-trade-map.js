// TradeZoro — BROKERS 3 symbol + size mapping (pure, no network, no secrets). Shared by the browser (assets/broker-trade.js) and the
// trade route (functions/connect/brokers/*), so both sides agree on every symbol. Owner 24 Nov 2026.
//   our contract code (chart-live-core.js short form: NQZ6 = Dec 2026, front month chosen by the chart) <-> each broker's format
//   tastytrade:   /NQZ6        (leading slash, one-digit year)      equities AAPL, equity options OCC "AAPL  261218C00200000"
//   TradeStation: NQZ26        (two-digit year)                     equities AAPL, options "AAPL 261218C200"
//   OANDA:        EUR_USD, XAU_USD, NAS100_USD ... (forex, metals, CFDs; no futures: an NQ chart maps to the Nasdaq 100 CFD)
// Education only. Not financial advice.
const FUT = /^([A-Z0-9]{1,4}?)([FGHJKMNQUVXZ])(\d{1,2})$/;
const EQ = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const OCC = /^[A-Z][A-Z0-9.]{0,5} {0,5}\d{6}[CP]\d{8}$/;           // tastytrade equity option (OCC, padded root)
const TS_OPT = /^[A-Z][A-Z0-9.]{0,5} \d{6}[CP]\d+(\.\d+)?$/;       // TradeStation option "AAPL 261218C200"
export const isFut = (c) => FUT.test(String(c || '').toUpperCase());
export const isEquity = (c) => EQ.test(String(c || '').toUpperCase()) && !isFut(c);

// one-digit year -> full year: the nearest year >= this year - 1 that ends in that digit (codes are for live contracts)
export function fullYear(d, now = Date.now()) {
  const y = new Date(now).getUTCFullYear(), dd = Number(d);
  if (String(d).length === 2) return 2000 + dd;
  for (let k = y - 1; k < y + 10; k++) if (k % 10 === dd) return k;
  return y;
}
// our short code -> broker symbol. kind: 'future' | 'equity' | 'option'. -> string | '' when the broker can't take it
export function toBroker(broker, code, kind = 'future', now = Date.now()) {
  const c = String(code || '').toUpperCase().trim();
  if (broker === 'tastytrade') {
    if (kind === 'option') return OCC.test(String(code || '')) ? String(code) : '';
    if (kind === 'equity') return EQ.test(c) ? c : '';
    const m = FUT.exec(c); return m ? '/' + m[1] + m[2] + String(fullYear(m[3], now) % 10) : '';
  }
  if (broker === 'tradestation') {
    if (kind === 'option') return TS_OPT.test(String(code || '')) ? String(code) : '';
    if (kind === 'equity') return EQ.test(c) ? c : '';
    const m = FUT.exec(c); return m ? m[1] + m[2] + String(fullYear(m[3], now) % 100).padStart(2, '0') : '';
  }
  if (broker === 'oanda') return oandaInstrument(c);
  return '';
}
// broker symbol -> our short code (positions / orders read back): /NQZ6 -> NQZ6, NQZ26 -> NQZ6, AAPL -> AAPL, EUR_USD -> EURUSD
export function fromBroker(broker, sym) {
  const s = String(sym || '').trim();
  if (broker === 'oanda') return s.toUpperCase().replace(/_/g, '');
  const t = s.replace(/^\//, '').toUpperCase();
  const m = /^([A-Z0-9]{1,4}?)([FGHJKMNQUVXZ])(\d{1,2})(?::[A-Z]+)?$/.exec(t);
  if (s.startsWith('/') || (broker === 'tradestation' && m && m[3].length === 2)) { if (m) return m[1] + m[2] + m[3].slice(-1); }
  return s;   // equities / options as the broker writes them
}

// ---- OANDA: chart key -> instrument. Forex pairs and spot metals map 1:1 (the chart IS the instrument); index / oil futures map to
// OANDA's CFD (the chart price is not the CFD price, so the chart sends market orders only there, like MetaTrader).
export const OANDA_CFD = { NDX: 'NAS100_USD', SPX: 'SPX500_USD', DJI: 'US30_USD', RUT: 'US2000_USD', WTI: 'WTICO_USD', XAU: 'XAU_USD', XAG: 'XAG_USD' };
const FX = /^(USD|EUR|GBP|JPY|CHF|CAD|AUD|NZD|XAU|XAG|XPT|XPD|SEK|NOK|DKK|SGD|HKD|MXN|ZAR|TRY|PLN|CNH|HUF|CZK|THB)(USD|EUR|GBP|JPY|CHF|CAD|AUD|NZD|SEK|NOK|DKK|SGD|HKD|MXN|ZAR|TRY|PLN|CNH|HUF|CZK|THB)$/;
const ROOT_KEY = { NQ: 'NDX', MNQ: 'NDX', NDX: 'NDX', NAS100: 'NDX', US100: 'NDX', ES: 'SPX', MES: 'SPX', SPX: 'SPX', SPX500: 'SPX', US500: 'SPX', YM: 'DJI', MYM: 'DJI', US30: 'DJI', RTY: 'RUT', M2K: 'RUT', US2000: 'RUT', GC: 'XAU', MGC: 'XAU', SI: 'XAG', SIL: 'XAG', CL: 'WTI', MCL: 'WTI', WTICO: 'WTI' };
export function oandaInstrument(x) {
  const t = String(x || '').toUpperCase().replace(/^[^:]+:/, '').replace(/[12]!$/, '');
  if (/^[A-Z0-9]{2,10}_[A-Z]{3}$/.test(t)) return t;                       // already an instrument name
  const k = t.replace(/[^A-Z0-9]/g, '');
  if (FX.test(k)) return k.slice(0, 3) + '_' + k.slice(3);
  const fm = FUT.exec(k), root = fm ? fm[1] : k;
  if (ROOT_KEY[root]) return OANDA_CFD[ROOT_KEY[root]];
  if (OANDA_CFD[k]) return OANDA_CFD[k];
  const cfd = Object.values(OANDA_CFD).find((v) => v.replace('_', '') === k); return cfd || '';
}
// the name the chart's MetaTrader-style symbol picker uses for an OANDA instrument (EUR_USD -> EURUSD, NAS100_USD -> NAS100)
export const oandaDisplay = (inst) => { const s = String(inst || '').toUpperCase(); return /^(NAS100|SPX500|US30|US2000|WTICO)_USD$/.test(s) ? s.split('_')[0] : s.replace('_', ''); };
// lots <-> OANDA units (1 lot = the usual MetaTrader contract size; OANDA itself counts units)
export function oandaLotSize(inst) {
  const s = String(inst || '').toUpperCase();
  if (/^XAU_/.test(s)) return 100; if (/^XAG_/.test(s)) return 5000; if (/^WTICO_/.test(s)) return 1000;
  if (/^[A-Z]{3}_[A-Z]{3}$/.test(s) && !/^(XPT|XPD)_/.test(s)) return 100000;
  return 1;   // index CFDs: 1 unit per lot
}
// OANDA instrument record -> lot rules { min, step, max, fromSchema } (our cap capLots), units precision, price decimals
export function oandaRules(rec, capLots = 10) {
  const L = oandaLotSize(rec && rec.name), up = Number.isInteger(Number(rec && rec.tradeUnitsPrecision)) ? Number(rec.tradeUnitsPrecision) : 0;
  const unitStep = Math.pow(10, -up), step = Math.max(0.01, unitStep / L), minU = Number(rec && rec.minimumTradeSize) || unitStep;
  const maxU = Number(rec && rec.maximumOrderUnits) || Infinity;
  return { min: +Math.max(step, minU / L).toFixed(8), step: +step.toFixed(8), max: +Math.min(capLots, maxU / L).toFixed(8), fromSchema: true, lotSize: L, unitsDp: up, priceDp: Number.isInteger(Number(rec && rec.displayPrecision)) ? Number(rec.displayPrecision) : 5 };
}
export const unitsOf = (lots, r) => Number((Number(lots) * r.lotSize).toFixed(r.unitsDp || 0));

// ---- size + price rounding (all brokers)
const decOf = (t) => { const s = String(t); if (/e-/.test(s)) return Number(s.split('e-')[1]); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };
export const roundPx = (p, tick) => { const t = tick > 0 ? tick : 0.01; return Number((Math.round(Number(p) / t) * t).toFixed(Math.max(2, decOf(t)))); };
export const wholeQty = (q) => { const n = Number(q); return Number.isInteger(n) && n >= 1 ? n : 0; };
