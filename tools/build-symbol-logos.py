#!/usr/bin/env python3
"""One-off builder for assets/images/symbols/ (see LICENSES.md there). Inputs (not committed):
  SRC_NV   = clone of github.com/nvstly/icons   (ticker_icons/*.png, crypto_icons/*.png)
  SRC_SPOT = npm cryptocurrency-icons (spothq, CC0) node_modules dir
  SRC_SP   = S&P 500 constituents csv (datasets/s-and-p-500-companies)
Output: s/<TICKER>.webp (72px, transparent), crypto/<coin>.svg|webp, map.json {s:{T:flag}, c:{coin:ext}}.
flag on stocks: 'w' = mostly white mark (needs dark-only on light theme), 'k' = mostly black (needs light on dark theme)."""
import os, csv, json, sys, shutil
from PIL import Image
NV, SPOT, SP = os.environ['SRC_NV'], os.environ['SRC_SPOT'], os.environ['SRC_SP']
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'images', 'symbols')
EXTRA = """AAPL MSFT NVDA GOOGL GOOG AMZN META TSLA AVGO COST NFLX AMD PEP ADBE CSCO TMUS INTC QCOM TXN AMGN INTU AMAT ISRG BKNG HON SBUX GILD MDLZ ADP ADI VRTX REGN PANW LRCX MU KLAC SNPS CDNS MELI ASML PDD ABNB MAR CRWD CTAS ORLY CSX MRVL FTNT DASH WDAY ADSK NXPI PYPL ROP TTD DDOG TEAM ZS CHTR MNST AEP PCAR KDP EXC CPRT PAYX FAST ODFL CTSH XEL LULU ROST BIIB IDXX GEHC FANG ON CCEP BKR TTWO ANSS DXCM CDW MDB GFS ILMN WBD ARM
PLTR SOFI HOOD COIN MSTR RIVN LCID NIO XPEV LI BABA JD BIDU NTES SE SHOP SQ XYZ SNOW U RBLX ROKU SPOT UBER LYFT PINS SNAP TWLO NET OKTA DOCU ZM PATH AI SMCI IONQ RGTI QBTS RKLB ASTS JOBY ACHR OKLO SMR GME AMC BB NOK F GM T VZ BAC C WFC JPM GS MS SCHW BLK KO PEP MCD WMT TGT HD LOW NKE DIS BA LMT RTX GE CAT DE XOM CVX COP OXY SLB PFE MRK JNJ LLY ABBV UNH CVS MRNA NVAX DKNG PENN MGM LVS WYNN CCL RCL NCLH AAL DAL UAL LUV SPCE TLRY CGC SNDL MARA RIOT CLSK HUT BITF CIFR WULF CORZ IREN BTBT GLXY CRCL ETOR FIG RDDT DUOL APP AFRM UPST LMND OPEN CHWY W ETSY EBAY CVNA CAVA CELH ELF ONON DECK BRK.B BF.B TSM SONY TM HMC NVO SAP UL BP SHEL AZN GSK HSBC RY TD BNS BMO ENB CNQ SU VALE RIO BHP PBR ITUB INFY WIT HDB IBN MUFG SMFG
USO UNG GLD SLV SPDR""".split()
os.makedirs(OUT+'/s', exist_ok=True); os.makedirs(OUT+'/crypto', exist_ok=True)
have = {f[:-4]: f for f in os.listdir(NV+'/ticker_icons')}
tick = [r['Symbol'] for r in csv.DictReader(open(SP))]
want = []
for t in tick + EXTRA:
    if t not in want: want.append(t)
M = {'s': {}, 'c': {}}
def conv(src, dst, px=72):
    im = Image.open(src).convert('RGBA'); bb = im.getbbox()
    if bb: im = im.crop(bb)
    w, h = im.size; k = (px - 4) / max(w, h)
    im = im.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
    c = Image.new('RGBA', (px, px), (0, 0, 0, 0)); c.paste(im, ((px - im.width) // 2, (px - im.height) // 2), im)
    for q in (82, 70, 55):
        c.save(dst, 'WEBP', quality=q, method=6)
        if os.path.getsize(dst) <= 8000: break
    px_ = [p for p in c.getdata() if p[3] > 128]
    if not px_: return ''
    lum = sum(0.2126*p[0]+0.7152*p[1]+0.0722*p[2] for p in px_) / len(px_) / 255
    return 'w' if lum > .82 else 'k' if lum < .18 else ''
for t in want:
    f = have.get(t) or have.get(t.replace('.', '-')) or have.get(t.replace('.', ''))
    if not f: continue
    M['s'][t] = conv(NV+'/ticker_icons/'+f, OUT+'/s/'+t+'.webp')
TOP = """BTC ETH USDT BNB SOL XRP USDC DOGE ADA TRX AVAX SHIB TON DOT LINK BCH NEAR LTC MATIC POL UNI ICP APT DAI ETC XLM ATOM XMR OKB FIL HBAR ARB CRO IMX VET OP MNT INJ SUI STX GRT RNDR RENDER AAVE MKR THETA FTM SEI LDO RUNE ALGO FLOW SAND MANA AXS EGLD XTZ EOS KAS TAO PEPE WIF BONK FLOKI HYPE FET AR TIA JUP PYTH ENA ONDO WLD PENDLE JASMY NEO GALA CHZ CRV SNX COMP 1INCH ZEC DASH QNT KAVA ENS BLUR APE LRC BAT ZIL IOTA XEC XDC BSV BTT AMP FXS FRAX GMX DYDX OSMO RPL CAKE CFX ROSE MINA ZRX YFI SUSHI KSM WAVES ANKR HOT ICX ONT QTUM RVN OMG STORJ SKL CELO GLM LUNC LUNA USTC TUSD FDUSD PYUSD WBTC STETH PAXG XAUT TRUMP PNUT MOVE ME USUAL VIRTUAL AI16Z FARTCOIN GOAT ACT NEIRO POPCAT MEW BRETT TURBO WLFI PUMP ASTER XPL""".split()
spot = {f[:-4].upper(): f for f in os.listdir(SPOT+'/svg/color')}
nvc = {f[:-4].upper(): f for f in os.listdir(NV+'/crypto_icons')}
for t in TOP:
    k = t.lower()
    if t in nvc:   # newer, flat marks on transparent
        conv(NV+'/crypto_icons/'+nvc[t], OUT+'/crypto/'+k+'.webp'); M['c'][k] = 'webp'
    elif t in spot and os.path.getsize(SPOT+'/svg/color/'+spot[t]) < 8000:
        shutil.copy(SPOT+'/svg/color/'+spot[t], OUT+'/crypto/'+k+'.svg'); M['c'][k] = 'svg'
json.dump(M, open(OUT+'/map.json', 'w'), separators=(',', ':'))
print(len(M['s']), 'stocks', len(M['c']), 'crypto', sum(1 for v in M['s'].values() if v == 'w'), 'w', sum(1 for v in M['s'].values() if v == 'k'), 'k')
