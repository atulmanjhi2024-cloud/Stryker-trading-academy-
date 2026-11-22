// thinkScript test helpers (node). Sample data only: a seeded random walk, never market data.
import assert from 'node:assert/strict';
export { assert };
let pass = 0, failN = 0;
export function t(name, fn) {
  try { fn(); pass++; } catch (e) { failN++; console.log('FAIL ' + name + ': ' + String(e && e.message || e).split('\n')[0].slice(0, 300)); }
}
export function done(label) {
  console.log(label + ': ' + pass + ' passed, ' + failN + ' failed');
  process.exit(failN ? 1 : 0);
}
// Sample data: n five-minute bars from Mon 5 Jan 2026 09:30 New York (14:30 UTC), continuous (no gaps)
export function makeBars(n, seed, stepMs) {
  let s = seed || 7, p = 100;
  const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const step = stepMs || 3e5, b = { time: [], open: [], high: [], low: [], close: [], volume: [] };
  for (let i = 0; i < n; i++) {
    const o = p; p = Math.max(1, p + (r() - 0.5) * 2);
    b.time.push(Date.UTC(2026, 0, 5, 14, 30) + i * step); b.open.push(o); b.close.push(p);
    b.high.push(Math.max(o, p) + r()); b.low.push(Math.min(o, p) - r()); b.volume.push(100 + Math.round(r() * 900));
  }
  return b;
}
// compare two series bar by bar: both missing, or within tol
export function near(got, want, tol, what) {
  assert.equal(got.length, want.length, what + ' length');
  let checked = 0;
  for (let i = 0; i < want.length; i++) {
    const g = got[i], w = want[i];
    const gm = !Number.isFinite(g), wm = !Number.isFinite(w);
    if (gm || wm) { assert.ok(gm && wm, what + ' bar ' + i + ': got ' + g + ', want ' + w); continue; }
    assert.ok(Math.abs(g - w) <= tol * Math.max(1, Math.abs(w)), what + ' bar ' + i + ': got ' + g + ', want ' + w);
    checked++;
  }
  assert.ok(checked > want.length / 2, what + ': too few values compared (' + checked + ')');
}
