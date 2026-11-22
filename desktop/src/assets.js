// TradeZoro Desktop 2.0: the app's own UI files (src/app) served on tzapp://app/<file>.
// Pure helpers (no Electron import) so test/core.test.js can check the path rules under plain node.
//
// The app window itself is a data: document whose base URL is https://tradezoro.com/desktop-app/ (src/main.js):
// it runs in the tradezoro.com origin, so it shares the Firebase sign-in (IndexedDB) and localStorage with the
// embedded ZoroCharts view, and the site's own APIs see a same-origin caller. Its scripts, styles and images come
// from this scheme only (the document's CSP allows no other script source).
const path = require('path');

const ROOT = path.join(__dirname, 'app');
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

// tzapp://app/<rel> -> absolute file path inside src/app, or null (wrong host, traversal, unknown type).
function fileFor(url) {
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  if (u.protocol !== 'tzapp:' || u.hostname !== 'app') return null;
  let rel;
  try { rel = decodeURIComponent(u.pathname); } catch (e) { return null; }
  if (rel.includes('\0') || rel.includes('\\')) return null;
  const abs = path.normalize(path.join(ROOT, rel));
  if (!abs.startsWith(ROOT + path.sep)) return null;
  if (!TYPES[path.extname(abs)]) return null;
  return abs;
}

function typeOf(file) { return TYPES[path.extname(file)] || 'application/octet-stream'; }

module.exports = { ROOT, fileFor, typeOf };
