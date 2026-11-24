// BROKERS 3 (Owner 24 Nov 2026): the ONE place that knows which broker hosts a trading call may reach.
// Test hosts (tastytrade SANDBOX, TradeStation SIM, OANDA PRACTICE) are always allowed. A LIVE trading host is allowed only when that
// broker's own live flag is "1" in the Pages env (TASTY_TRADE_LIVE / TS_TRADE_LIVE / OANDA_TRADE_LIVE; unset = off). The CoS flips a
// flag only after the Owner has tested the broker. Every upstream call in functions/connect/brokers/* goes through guardFetch(), so
// with a flag off no request can reach that broker's live host, whatever the browser sends (tools/tests/brokers3.test.mjs proves it).
// No secrets here.
export const UA = 'tradezoro/1.0';   // tastytrade rejects a request without a "product/version" User-Agent
export const BROKERS = {
  tastytrade: {
    label: 'tastytrade', liveFlag: 'TASTY_TRADE_LIVE',
    api: { sandbox: 'https://api.cert.tastyworks.com', live: 'https://api.tastyworks.com' },
    stream: { sandbox: 'wss://streamer.cert.tastyworks.com', live: 'wss://streamer.tastyworks.com' },
    // sandbox and production are separate OAuth apps (a sandbox token never works on production)
    creds: { sandbox: ['TASTY_SANDBOX_CLIENT_ID', 'TASTY_SANDBOX_CLIENT_SECRET'], live: ['TASTY_CLIENT_ID', 'TASTY_CLIENT_SECRET'] },
    authorize: { sandbox: 'https://cert-my.staging-tasty.works/auth.html', live: 'https://my.tastytrade.com/auth.html' },
    redirect: 'https://tradezoro.com/connect/tastytrade/trade-callback', scope: 'read trade'
  },
  tradestation: {
    label: 'TradeStation', liveFlag: 'TS_TRADE_LIVE',
    api: { sandbox: 'https://sim-api.tradestation.com', live: 'https://api.tradestation.com' },
    // one sign-in (and one API key) for SIM and live; the SIM accounts are only reachable on sim-api
    creds: { sandbox: ['TS_CLIENT_ID', 'TS_CLIENT_SECRET'], live: ['TS_CLIENT_ID', 'TS_CLIENT_SECRET'] },
    authorize: { sandbox: 'https://signin.tradestation.com/authorize', live: 'https://signin.tradestation.com/authorize' },
    token: 'https://signin.tradestation.com/oauth/token', audience: 'https://api.tradestation.com',
    redirect: 'https://tradezoro.com/connect/tradestation/callback', scope: 'openid offline_access MarketData ReadAccount Trade'
  },
  oanda: {
    label: 'OANDA', liveFlag: 'OANDA_TRADE_LIVE', enableVar: 'OANDA_TRADE_ENABLED',   // personal access token: no app secret
    api: { sandbox: 'https://api-fxpractice.oanda.com', live: 'https://api-fxtrade.oanda.com' },
    stream: { sandbox: 'https://stream-fxpractice.oanda.com', live: 'https://stream-fxtrade.oanda.com' }
  }
};
// the hosts that are NOT live trading hosts (shared sign-in pages and token URLs that place nothing)
const SHARED_OK = new Set(['signin.tradestation.com']);
const hostOf = (u) => { try { return new URL(u).host; } catch (e) { return ''; } };
export const liveOn = (env, broker) => !!(BROKERS[broker] && env && env[BROKERS[broker].liveFlag] === '1');
// every live host of every broker (REST + stream)
export const LIVE_HOSTS = new Set(Object.values(BROKERS).flatMap((b) => [b.api.live, b.stream && b.stream.live].filter(Boolean).map(hostOf)));
export function allowedHost(env, broker, url) {
  const b = BROKERS[broker]; if (!b) return false;
  const h = hostOf(url); if (!h || !/^(https|wss):$/.test(new URL(url).protocol)) return false;
  if (SHARED_OK.has(h) && broker === 'tradestation') return true;
  if (h === hostOf(b.api.sandbox) || (b.stream && h === hostOf(b.stream.sandbox))) return true;
  if (h === hostOf(b.api.live) || (b.stream && h === hostOf(b.stream.live))) return liveOn(env, broker);
  return false;
}
export class LiveOff extends Error { constructor(m) { super(m); this.code = 'live_off'; this.status = 403; } }
// the only way out to a broker. fetchImpl: tests (a mock); else the platform fetch.
export async function guardFetch(env, broker, url, init = {}, fetchImpl) {
  if (!allowedHost(env, broker, url)) throw new LiveOff('Live ' + ((BROKERS[broker] || {}).label || 'broker') + ' trading is not switched on yet. Demo / practice accounts only for now.');
  return (fetchImpl || fetch)(url, { redirect: 'error', ...init });
}
export const apiBase = (broker, envName) => BROKERS[broker].api[envName === 'live' ? 'live' : 'sandbox'];
export const envOf = (v) => (v === 'live' ? 'live' : 'sandbox');
