// TradeZoro — "Allow trading with tastytrade / TradeStation" return page (/connect/tastytrade/trade-callback, /connect/tradestation/callback).
// BROKERS 3 (Owner 24 Nov 2026), admins + beta testers. Flow: strip the code from the URL at once, check the single-use state (this tab,
// same signed-in user, under 10 min, same broker), swap the code on OUR server (functions/connect/brokers/token.js; the app secret stays
// there), check the token lists at least one account (through /connect/brokers/trade), keep it in the TRADING vault entry for that
// broker ('<broker>-trade', encrypted, user-bound; never the view-only data sign-in), go back to /charts (fixed; never from the URL).
// Shows plain words only (textContent); logs the step + status to the console, never a token or a code.
(function () {
  var q = new URLSearchParams(location.search);
  var code = q.get('code'), state = q.get('state'), denied = q.get('error');
  var broker = /\/connect\/tradestation\//.test(location.pathname) ? 'tradestation' : 'tastytrade';
  var label = broker === 'tradestation' ? 'TradeStation' : 'tastytrade';
  try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
  var h = document.getElementById('b3-h'), p = document.getElementById('b3-p'), a = document.getElementById('b3-a');
  function end(title, text) { h.textContent = title; p.textContent = text; a.hidden = false; }
  if (denied || !code || !state) return end(label + ' trading was not allowed', 'You can try again from the Trade menu in the charts.');
  function user() {
    return new Promise(function (res) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; res(null); } }, 10000);
      try { firebase.auth().onAuthStateChanged(function (u) { if (done || !u) return; done = true; clearTimeout(t); res(u); }); } catch (e) { clearTimeout(t); res(null); }
    });
  }
  function note(step, e) { e = e || {}; try { console.warn('[broker-trade-callback]', JSON.stringify({ broker: broker, step: step, status: e.status === undefined ? null : e.status, code: e.code || null })); } catch (x) { /* ignore */ } }
  function reason(step, e) {
    e = e || {};
    if (step === 'token') {
      if (e.status === 503) return label + ' trading isn’t set up on TradeZoro yet.';
      if (e.status === 403) return e.message || 'Direct broker trading is for admins and beta testers only right now.';
      if (e.status === 429) return 'Too many tries. Wait a minute, then try again.';
      if (e.status === 401) return 'Your TradeZoro sign-in expired. Sign in again, then try again.';
      if (e.status === 400) return label + ' didn’t accept the sign-in. Please try again.';
      return label + ' didn’t answer. Please try again in a minute.';
    }
    if (step === 'accounts') return e.message || (label + ' didn’t send your account list. Please try again.');
    if (step === 'save') return 'Couldn’t save the sign-in on this device. Allow site storage (not private mode), then try again.';
    return 'Something went wrong. Try again from the Trade menu in the charts.';
  }
  function at(step, pr) { return pr.catch(function (e) { throw { step: step, e: e }; }); }
  user().then(function (u) {
    if (!u) return end('Sign in first', 'Sign in to TradeZoro, then allow ' + label + ' trading again.');
    return Promise.all([import('./byo-core.js?v=1302'), import('./broker-trade.js?v=1302')]).then(function (m) {
      var c = m[0], bt = m[1];
      var rec = bt.takeState(state, u.uid, broker);
      if (!rec) return end(label + ' trading was not allowed', 'The sign-in link expired. Start again from the Trade menu in the charts.');
      return at('token', u.getIdToken().then(function (idt) { return bt.swapCode(broker, code, rec.env, idt); })).then(function (creds) {
        return at('accounts', bt.accountsFor(broker, creds)).then(function (list) {
          if (!list.length) return end('No ' + label + ' account found', broker === 'tradestation' ? 'No SIM account was found on this TradeStation login.' : 'No account was found on this tastytrade login.');
          return at('save', c.bindUser(u.uid).then(function () { return bt.saveCreds(broker, creds); })).then(function () { location.replace('/charts'); });
        });
      });
    });
  }).catch(function (f) {
    var step = f && f.step ? f.step : 'other', e = f && f.step ? f.e : f;
    note(step, e);
    end(label + ' trading was not allowed', reason(step, e));
  });
})();
