#!/usr/bin/env python3
"""Generates the public "Connect your broker" help pages (help/connect-broker*.html).
Run: python3 tools/gen-broker-help.py   (template = head/footer of help/desktop-bridge.html)
PUBLIC since 21 Nov 2026 (Owner decision: every signed-in member may connect their own broker and place live trades after the
one-time "Enable live trading" step). Listed in help-data.json (category rithmic) and the sitemap. No logo images, names only."""
import os, re, html

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tpl = open(os.path.join(ROOT, 'help', 'desktop-bridge.html'), encoding='utf-8').read()
head, rest = tpl.split('<main id="main"', 1)
foot = rest.split('</main>', 1)[1]
UPDATED = '21 November 2026'
DISC = '<p class="bh-small">Education only. Not financial advice. Live orders are real and use your own money. See <a href="/terms#broker-live">Broker connections and live trading</a> in the Terms. Beta.</p>'

STYLE = '''<style>
.bh-card{ border:1px solid var(--line,#2c2c32); border-radius:12px; padding:16px; margin:0 0 20px; background:var(--bg-2,rgba(255,255,255,.03)); }
.bh-card ul{ margin:8px 0 0; }
.bh-warn{ border-color:rgba(255,176,32,.6); background:rgba(255,176,32,.09); }
:root[data-theme="light"] .bh-warn{ border-color:rgba(176,112,0,.6); background:rgba(176,112,0,.08); }
.bh-small{ font-size:13px; line-height:20px; color:var(--ink-2,#8b93a0); margin:8px 0 0; }
.bh code{ font-family:var(--font-code); font-size:.9em; overflow-wrap:anywhere; }
.bh-path{ display:flex; flex-wrap:wrap; align-items:center; gap:8px; list-style:none; margin:0 0 20px; padding:0; }
.bh-path li{ display:inline-flex; align-items:center; min-height:32px; padding:0 12px; border:1px solid var(--line,#2c2c32); border-radius:999px; background:var(--bg-2,rgba(255,255,255,.04)); font-size:14px; line-height:20px; font-variant-numeric:tabular-nums; }
.bh-path li+li::before{ content:"\\203A"; margin:0 8px 0 -4px; color:var(--ink-2,#8b93a0); }
.bh-grid{ display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:16px; margin:0 0 24px; }
.bh-grid a{ display:flex; flex-direction:column; justify-content:flex-start; gap:4px; min-height:88px; padding:16px; border:1px solid var(--line,#2c2c32); border-radius:12px; background:var(--bg-2,rgba(255,255,255,.03)); text-decoration:none; color:inherit; }
.bh-grid a:hover,.bh-grid a:focus-visible{ border-color:var(--accent,#7aa2ff); }
.bh-grid b{ font-size:16px; line-height:24px; } .bh-grid span{ font-size:13px; line-height:20px; color:var(--ink-2,#8b93a0); }
.bh-tbl{ width:100%; border-collapse:collapse; margin:0 0 20px; font-size:14px; line-height:20px; }
.bh-tbl th,.bh-tbl td{ text-align:left; vertical-align:top; padding:10px 12px; border-bottom:1px solid var(--line,#2c2c32); }
.bh-tblw{ overflow-x:auto; margin:0 0 20px; } .bh-tblw .bh-tbl{ margin:0; min-width:520px; }
</style>
</head>'''

BROKERS = {
 'ibkr': dict(name='Interactive Brokers', short='IBKR', slug='connect-broker-interactive-brokers',
  blurb='Connect Interactive Brokers (IBKR): what you need, steps, what syncs.',
  login='your Interactive Brokers (IBKR) account. IBKR connects with a <strong>Flex token</strong> that you create yourself in IBKR Client Portal. It is not a normal login box.',
  types=['<strong>Live</strong> and <strong>paper</strong> IBKR accounts: the connection works from your IBKR account details. Our code does not tell live from paper, so check the account name shown in the list.',
         'Brokerage accounts with stocks, options, futures, forex or crypto. The connection service lists these product types for IBKR.'],
  auth=['Open the connect window and pick <strong>Interactive Brokers</strong>.',
        'The window asks for a <strong>Flex token</strong>. You create it in IBKR Client Portal (the window points you to IBKR\u2019s own steps; IBKR\u2019s menu names change, so follow IBKR\u2019s page). Paste the token in the window.',
        'Choose the accounts to share and finish.'],
  extra='<p><strong>Two-step login (2FA).</strong> If your IBKR account asks you to approve a login in the IBKR app when you open Client Portal, do that first. Which step asks for it is IBKR\u2019s choice, not ours, and we have not tested every case.</p>',
  syncs='The connection service lists IBKR as <strong>data only</strong>. You get your accounts, balances, positions, orders and fills to read. <strong>You cannot place or change IBKR orders from TradeZoro.</strong>',
  limits=['No order placing for IBKR. It is read only.',
          'A Flex token can expire or be removed in IBKR. Then the connection stops and you connect again.',
          'Balance is the figure IBKR last reported, not a live tick.'],
  faq=[('I cannot find where to make a Flex token.','Open IBKR Client Portal and look for the reporting or Flex area. IBKR moves menus around. The connect window links to IBKR\u2019s own steps.'),
       ('Does TradeZoro see my IBKR password?','No. You never type your IBKR password into TradeZoro. The token only gives read access to reports.'),
       ('Can I trade IBKR from the chart?','No. IBKR is read only here.')]),
 'ninjatrader': dict(name='NinjaTrader', short='NinjaTrader', slug='connect-broker-ninjatrader',
  blurb='Connect NinjaTrader: logins, steps, what syncs.',
  login='your <strong>NinjaTrader</strong> account login. You sign in on NinjaTrader\u2019s own page and approve access (an OAuth sign-in).',
  types=['NinjaTrader brokerage accounts, <strong>live</strong> and <strong>sim</strong>, that your NinjaTrader login can see.',
         'Futures and other products NinjaTrader lists for the account.',
         'Prop firm accounts that sit on the NinjaTrader platform and log in with NinjaTrader credentials may show up. If your firm gave you a Rithmic login instead, use the Rithmic guide.'],
  auth=['Open the connect window and pick <strong>NinjaTrader</strong>.','A NinjaTrader sign-in page opens. Log in with your NinjaTrader username and password there.','Approve access when NinjaTrader asks, then choose the accounts to share.'],
  extra='<p><strong>This is not the Data Bridge.</strong> The <a href="/help/desktop-bridge">Data Bridge</a> add-on only sends prices to a chart. Connecting a broker reads your account, positions, balance and fills.</p>',
  syncs='Accounts, balance, positions, orders and fills. You can also place live orders from the chart once you enable live trading for your account.',
  limits=['If your account list is empty, the login you used has no account the connection can read.','Balance can be a little behind NinjaTrader (see Troubleshooting in the hub).'],
  faq=[('Which login do I use?','The same one you use at NinjaTrader\u2019s own site or platform.'),
       ('My prop firm gave me a NinjaTrader login. Does it work?','Try it. If the sign-in page rejects it, ask your firm which platform login it is.')]),
 'rithmic': dict(name='Rithmic', short='Rithmic', slug='connect-broker-rithmic',
  blurb='Connect Rithmic: which logins work, steps, what syncs.',
  login='your <strong>Rithmic username and password</strong>, the one you use in R | Trader Pro. This is not the login for your firm\u2019s website.',
  types=['Futures accounts that log in through Rithmic: <strong>live</strong>, <strong>sim/evaluation</strong> and <strong>funded</strong> prop firm accounts.',
         'Prop firms that run on Rithmic give you a separate Rithmic username and password (for example Bulenox, as in our <a href="/help#rithmic-errors">Rithmic data guide</a>). We do not keep a checked list of every firm. If you can sign in to R | Trader Pro with it, it is a Rithmic login.',
         'Not sure? Look in your firm\u2019s welcome email or dashboard for \u201cRithmic\u201d, or ask their support.'],
  auth=['Open the connect window and pick <strong>Rithmic</strong>.','Enter your Rithmic username and password in the sign-in form. Rithmic uses a username and password, so this is the one broker here where you type them (in the secure connect window, not in TradeZoro).','Choose the accounts to share and finish.'],
  extra='<p><strong>Rithmic data vs broker connection.</strong> The chart\u2019s <em>Data source</em> then Rithmic gives futures prices. Connecting a broker here reads your account (positions, balance, fills). They are separate.</p>',
  syncs='Futures accounts: balance, positions, orders and fills. You can also place live orders from the chart once you enable live trading for your account.',
  limits=['Futures only.','A new Rithmic login must first accept the market data agreements in R | Trader Pro, or the sign-in can be refused.','Some firms must allow third-party apps on your login. If the same login works in R | Trader Pro but not here, ask your firm.'],
  faq=[('Is my Rithmic password safe?','TradeZoro never sees it. It goes to our connection service, which keeps it encrypted and uses it only to keep your session open. Disconnect removes the link.'),
       ('Which firms use Rithmic?','Ask your firm. We only know a firm uses Rithmic when it gives you a Rithmic username. We do not publish a list.')]),
 'tastytrade': dict(name='tastytrade', short='tastytrade', slug='connect-broker-tastytrade',
  blurb='Connect tastytrade: login, steps, what syncs.',
  login='your <strong>tastytrade</strong> login. You sign in on tastytrade\u2019s own page and approve access (an OAuth sign-in).',
  types=['tastytrade brokerage accounts, <strong>live</strong> and <strong>paper</strong> where tastytrade offers them on your login.','Stocks, options, futures, forex and crypto, as listed for tastytrade.'],
  auth=['Open the connect window and pick <strong>tastytrade</strong>.','A tastytrade sign-in page opens. Log in with your tastytrade username and password there.','Approve access when tastytrade asks, then choose the accounts to share.'],
  extra='',
  syncs='Accounts, balance, positions, orders and fills. You can also place live orders from the chart once you enable live trading for your account.',
  limits=['Event contracts: tastytrade offers them but they are not available through our connection.','tastytrade needs a funded and approved account before it shows anything to read.'],
  faq=[('Can I connect more than one tastytrade account?','Yes. Tick every account you want on the \u201cchoose accounts\u201d step.'),
       ('The sign-in page asks for a code.','That is tastytrade\u2019s own two-step login. Enter the code it sends or shows.')]),
 'tradovate': dict(name='Tradovate', short='Tradovate', slug='connect-broker-tradovate',
  blurb='Connect Tradovate: logins, prop firm accounts, steps, what syncs.',
  login='your <strong>Tradovate</strong> login. You sign in on Tradovate\u2019s own page and approve access (an OAuth sign-in).',
  types=['Tradovate <strong>live</strong> accounts and <strong>sim</strong> (demo) accounts on your login.','Prop firm accounts that run on Tradovate (they show as accounts under your Tradovate login). Many firms use a Tradovate login; if yours gave you a Rithmic login instead, use the Rithmic guide.','Futures, options and forex, as listed for Tradovate.'],
  auth=['Open the connect window and pick <strong>Tradovate</strong>.','A Tradovate sign-in page opens. Log in with your Tradovate username and password there.','Approve access when Tradovate asks, then choose the accounts to share.'],
  extra='<p><strong>Account names.</strong> Tradovate also has a long number for each account. TradeZoro shows the account <em>name</em> from Tradovate. In the Trade menu you can rename an account with <strong>Edit details</strong> (label, prop firm and type: Evaluation, Funded, Live or Sim). Labels are for you only.</p>',
  syncs='Accounts, balance, positions, orders and fills. You can also place live orders from the chart once you enable live trading for your account.',
  limits=['If you have a live and a sim account, both are listed. Check the name before you use one.','Balance is the last figure Tradovate reported plus fills since then, so it can lag a little.'],
  faq=[('Do prop firm accounts show up?','If the firm\u2019s accounts sit under your Tradovate login, yes. Rename them with Edit details.'),
       ('Same login as the Tradovate app?','Yes, the one you use at Tradovate\u2019s own site.')]),
 'webull': dict(name='Webull', short='Webull', slug='connect-broker-webull',
  blurb='Connect Webull: login, steps, what syncs.',
  login='your <strong>Webull</strong> login. You sign in on Webull\u2019s own page and approve access (an OAuth sign-in).',
  types=['Webull brokerage accounts on your login.','Stocks, options, crypto, forex and futures, as listed for Webull. We have not checked which of these your own Webull account has switched on.'],
  auth=['Open the connect window and pick <strong>Webull</strong>.','A Webull sign-in page opens. Log in with your Webull login there.','Approve access when Webull asks, then choose the accounts to share.'],
  extra='',
  syncs='Accounts, balance, positions, orders and fills. You can also place live orders from the chart once you enable live trading for your account.',
  limits=['The journal import is built around futures round trips. For stocks and options, read the preview carefully before you import.','Balance can be a little behind Webull.'],
  faq=[('Webull asks me to verify.','That is Webull\u2019s own check. Finish it, then continue.'),
       ('Do I need an API application at Webull?','Our connection handles the sign-in. If Webull asks for something extra on its page, follow Webull\u2019s steps.')]),
}
ORDER = ['ibkr','ninjatrader','rithmic','tastytrade','tradovate','webull']
HUB = 'connect-broker'

def page(slug, title, desc, h1, body):
    h = head
    h = re.sub(r'<meta name="description" content="[^"]*">', '<meta name="description" content="%s">' % html.escape(desc, True), h)
    for k in ('og:title','twitter:title'):
        h = re.sub(r'(<meta (?:property|name)="%s" content=")[^"]*' % k, lambda m: m.group(1) + html.escape(title, True), h)
    for k in ('og:description','twitter:description'):
        h = re.sub(r'(<meta (?:property|name)="%s" content=")[^"]*' % k, lambda m: m.group(1) + html.escape(desc, True), h)
    h = h.replace('og:url" content="https://tradezoro.com/help/desktop-bridge"', 'og:url" content="https://tradezoro.com/help/%s"' % slug)
    h = h.replace('<link rel="canonical" href="https://tradezoro.com/help/desktop-bridge">', '<link rel="canonical" href="https://tradezoro.com/help/%s">' % slug)
    h = re.sub(r'<title>[^<]*</title>', '<title>%s | TradeZoro</title>' % html.escape(title), h)
    h = re.sub(r'<style>[\s\S]*?</style>\n</head>', lambda m: STYLE, h)
    return (h + '<main id="main" tabindex="-1">\n<header class="site-page-hero"><div class="container"><h1 id="site-page-title">%s</h1>\n<span class="updated-note">Beta · Last updated %s</span></div></header>\n<div class="container"><div class="article-wrap"><div class="article-body bh">\n%s\n</div></div></div>\n</main>' % (h1, UPDATED, body) + foot)

PATH = '<ol class="bh-path" aria-label="The steps in TradeZoro"><li>Charts</li><li>Trade menu</li><li>Connect a broker</li><li>Pick your broker</li><li>Log in</li><li>Choose accounts</li><li>Done</li></ol>'

def hub():
    cards = ''.join('<a href="/help/%s"><b>%s</b><span>%s</span></a>' % (BROKERS[k]['slug'], BROKERS[k]['name'], BROKERS[k]['blurb'].split(':')[1].strip().capitalize()) for k in ORDER)
    return '''<p>Connecting a broker links your trading account to TradeZoro. It is optional. This page explains what it does, what you need, and how to fix the common problems. Then pick your broker below for its own step by step guide.</p>
<div class="bh-card"><strong>In short</strong>
<ul><li><strong>Your broker password stays with your broker.</strong> You log in on the broker\u2019s own page, not on a TradeZoro form.</li>
<li><strong>It reads your account.</strong> Trades and fills for the journal, open positions, and your balance.</li>
<li><strong>Live orders after one step.</strong> Live trading is off until you enable it once for your account and accept the risk notice. Until then your broker accounts are view-only.</li></ul>%s</div>
<h2 id="brokers">Pick your broker</h2>
<div class="bh-grid">%s</div>
<h2 id="what">What connecting does</h2>
<div class="bh-tblw"><table class="bh-tbl"><thead><tr><th>Part</th><th>What you get</th></tr></thead><tbody>
<tr><td>Accounts</td><td>The accounts you tick in the connect window appear in the Trade menu and in the journal sync.</td></tr>
<tr><td>Journal sync</td><td>Your fills become journal trades (round trips from flat to flat). Syncing the same days twice adds nothing twice. Trades still open are not imported.</td></tr>
<tr><td>Positions</td><td>Your open position and working orders are read from the broker and shown on the chart panel.</td></tr>
<tr><td>Balance</td><td>The broker\u2019s last reported balance. If the broker\u2019s figure is old, TradeZoro adds the profit or loss of fills made after it.</td></tr>
<tr><td>Live orders</td><td>From the chart, after you enable live trading once (see below). Small limits apply: NQ, ES, MNQ and MES, at most 2 contracts, 10 orders a minute. Interactive Brokers is read only.</td></tr></tbody></table></div>
<h2 id="before">Before you start</h2>
<ul><li>An account at the broker with its login working. Log in once at the broker yourself first.</li>
<li>A computer or tablet browser is easiest. The broker page opens in a <strong>new tab</strong>, so allow pop-ups for TradeZoro.</li>
<li>Your two-step login (2FA) device, if the broker uses one.</li>
<li>For a prop firm account: the login type your firm gave you (Rithmic, Tradovate or NinjaTrader). The firm\u2019s website login is not the one to use.</li></ul>
<h2 id="how">How to connect</h2>
%s
<ol><li>Open a chart and click <strong>Trade</strong> in the toolbar. (In the order panel you can also open the account picker and choose <strong>Connect a broker\u2026</strong>.)</li>
<li>At the bottom of the menu click <strong>Connect a broker</strong>. The connect window opens.</li>
<li>Click <strong>Connect a broker</strong> in the window. A new tab opens with the broker list.</li>
<li>Pick your broker and log in there. Choose the accounts you want to share.</li>
<li>Come back to TradeZoro and click <strong>Continue</strong>. The window closes and your accounts show in the Trade menu.</li></ol>
<p>In the journal the same window is the <strong>Broker sync (beta)</strong> button. After connecting you choose an account and dates, click <strong>Load trades</strong>, check the preview and import.</p>
<h2 id="live">Enable live trading</h2>
<p>Live orders are real and use your own money at your broker. Before your first live order TradeZoro asks you once:</p>
<ol><li>In the Trade menu pick one of your broker accounts (Paper stays the default).</li>
<li>Try your first order, or click <strong>Enable live trading</strong>. A short risk notice opens.</li>
<li>Read it, tick the box and click <strong>Enable live trading</strong>. We save when you accepted it.</li></ol>
<p>After that, clicking Buy, Sell, Flatten or the order book sends a real order to your broker. There is no extra confirm step. TradeZoro is not a broker and gives no advice; you are responsible for your orders. If you click <strong>Not now</strong>, the account stays view-only. TradeZoro can switch live trading off for everyone or for one account at any time.</p>
<h2 id="disconnect">How to disconnect</h2>
<ol><li>Open the <strong>Trade</strong> menu.</li><li>Click the small gear on the account, then <strong>Disconnect</strong> (or <strong>Manage</strong> to see all accounts), then confirm.</li></ol>
<p>This removes the link. Trades already imported stay in your journal. You can connect again any time. You can also remove TradeZoro\u2019s access in your broker\u2019s own settings.</p>
<h2 id="privacy">Privacy</h2>
<ul><li><strong>We never see your broker password.</strong> You log in on the broker\u2019s own page. For Rithmic, which uses a username and password, you type them in the secure connect window, and TradeZoro does not receive or store them.</li>
<li>TradeZoro reads your accounts, balance, positions, orders and fills. It sends an order only when you click to trade, after you enabled live trading.</li>
<li>Your account details stay in your own view. We do not show them to other members.</li></ul>
<h2 id="fix">Troubleshooting</h2>
<ul><li><strong>It asks me to log in again.</strong> The saved link expired. Open the Trade menu and click <strong>Reconnect</strong>. If that does not help, click <strong>Connect a broker</strong> and sign in again.</li>
<li><strong>My account is not in the list.</strong> You did not tick it on the choose-accounts step, or the login you used cannot see it. Click <strong>Connect a broker</strong> again, sign in, tick the account. Brand new accounts can take a few minutes to appear.</li>
<li><strong>The new tab did not open.</strong> Allow pop-ups for TradeZoro and click <strong>Open the broker tab again</strong>.</li>
<li><strong>The balance looks old.</strong> Brokers refresh their balance on their own schedule. TradeZoro shows the broker\u2019s last figure plus the result of fills after it, and re-reads it every 30 seconds while the Trade menu is open. Compare with your broker\u2019s own screen.</li>
<li><strong>\u201cNo clear answer from the broker.\u201d</strong> The broker did not confirm your last order, so it may or may not be live. <strong>Check your working orders and position at the broker first</strong>. Do not send it again until you know. The chart blocks new orders until it can read the account again.</li>
<li><strong>\u201cBroker data is unavailable right now.\u201d</strong> The connection service or the broker is down for a moment. Wait a minute and try again.</li>
<li><strong>Journal import found no trades.</strong> Widen the dates. Only closed trades are imported.</li></ul>
<p>Still stuck? <a href="https://discord.gg/M4d4gTr5c3" target="_blank" rel="noopener">Get help on Discord</a> (#help-and-support channel) or <a href="/contact">contact us</a>.</p>
%s''' % (DISC, cards, PATH, DISC)

def broker(k):
    b = BROKERS[k]
    types = ''.join('<li>%s</li>' % t for t in b['types'])
    auth = ''.join('<li>%s</li>' % t for t in b['auth'])
    lim = ''.join('<li>%s</li>' % t for t in b['limits'])
    faq = ''.join('<h3>%s</h3><p>%s</p>' % (q, a) for q, a in b['faq'])
    others = ' · '.join('<a href="/help/%s">%s</a>' % (BROKERS[o]['slug'], BROKERS[o]['name']) for o in ORDER if o != k)
    return '''<p>This guide connects <strong>%(n)s</strong> to TradeZoro. Read the <a href="/help/%(hub)s">Connect your broker</a> guide first if you want the big picture.</p>
<div class="bh-card"><strong>What you need</strong><ul><li>%(login)s</li><li>The accounts you want to share, ready at %(n)s.</li><li>Pop-ups allowed for TradeZoro (the sign-in opens in a new tab).</li></ul></div>
<h2 id="accounts">Accounts that work</h2><ul>%(types)s</ul>%(extra)s
<h2 id="steps">Step by step</h2>
%(path)s
<ol><li>Open a chart and click <strong>Trade</strong>, then <strong>Connect a broker</strong> at the bottom of the menu. (Journal: <strong>Broker sync (beta)</strong>.)</li>
<li>In the connect window click <strong>Connect a broker</strong>. A new tab opens.</li>
%(auth)s
<li>Go back to the TradeZoro tab and click <strong>Continue</strong>. Your %(n)s accounts show in the Trade menu.</li>
<li>Journal only: pick the account and dates, click <strong>Load trades</strong>, check the preview, then <strong>Import</strong>.</li></ol>
<h2 id="syncs">What syncs</h2><p>%(syncs)s</p>
<h2 id="limits">Known limits</h2><ul>%(lim)s</ul>
<h2 id="disconnect">Disconnect</h2><p>Trade menu, gear on the account, <strong>Disconnect</strong>, confirm. Imported journal trades stay. You can also remove access in %(n)s\u2019s own settings.</p>
<h2 id="faq">FAQ</h2>%(faq)s
<h3>Something went wrong. Where do I look?</h3><p>See Troubleshooting in <a href="/help/%(hub)s#fix">Connect your broker</a>. If you get \u201cno clear answer from the broker\u201d, check your working orders at %(n)s before you send anything again.</p>
<p class="bh-small">Other brokers: %(others)s</p>
%(disc)s''' % dict(n=b['name'], hub=HUB, login=b['login'], types=types, extra=b['extra'], path=PATH, auth=auth, syncs=b['syncs'], lim=lim, faq=faq, others=others, disc=DISC)

def main():
    out = os.path.join(ROOT, 'help')
    open(os.path.join(out, HUB + '.html'), 'w', encoding='utf-8').write(page(HUB, 'Connect your broker', 'What connecting a broker does in TradeZoro, what you need, how to disconnect, privacy and fixes.', 'Connect your broker', hub()))
    for k in ORDER:
        b = BROKERS[k]
        open(os.path.join(out, b['slug'] + '.html'), 'w', encoding='utf-8').write(page(b['slug'], 'Connect %s: step by step' % b['name'], b['blurb'], 'Connect %s: step by step' % b['name'], broker(k)))
    print('wrote', 1 + len(ORDER), 'pages')

main()
