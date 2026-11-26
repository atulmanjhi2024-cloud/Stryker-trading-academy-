#!/usr/bin/env python3
"""GLOBEX OPEN REPAIR (member UnoMas, 25 Nov 2026: the Globex open on NQ was 26325.00, TradingView 26281.75).

Cause: the tick archive behind backfill_m1.py (NQ, ES) sometimes has no trades for the first minute(s) of a session (about 1 open
in 10; checked 2026-11-22 23:00 UTC: first NQ trade 92 s late, so the 18:00 bar was missing and the 18:01 bar was a part-minute).
The chart then had no bar at 18:00 and an indicator reading the session's first bar read the open of the next one.
Fix: for each session open (18:00 New York = 22:00 or 23:00 UTC) whose first bar is missing, the minutes from the open up to
and including the first tick-built bar are taken from the REST bar vendor (it has the real 18:00 bar). Nothing is invented: a
minute the vendor does not have stays missing. Rows taken from the vendor carry null buy volume / trades (as backfill_is_m1.py).

  python3 tools/hist/fix_opens.py --symbols NQ,ES --days 366 --out /var/lib/tz-hist [--post] [--dry]
Env: INSIGHTSENTRY_ENV, FEEDER_ENV (--post). Idempotent: a day that is already complete is left alone.
"""
import argparse, datetime as dt, gzip, json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

MAX_FIX_MIN = 5   # only the first minutes of a session: a bigger hole is a data outage, not a missing open


def patch_opens(rows, vendor_rows):
    """rows: day's [t,o,h,l,c,v,bv,n] (time order); vendor_rows: {t: [t,o,h,l,c,v,..]} for that day. -> (rows, n_patched)"""
    out, patched = list(rows), 0
    have = {r[0] for r in out}
    for t in sorted(vendor_rows):
        if t % 3600 or t % 86400 not in (22 * 3600, 23 * 3600) or (t - 60) in vendor_rows:
            continue                      # not a session open: the vendor has a bar one minute earlier (or it is not 22:00/23:00 UTC)
        if t in have:
            continue
        later = [r[0] for r in out if r[0] > t]
        if not later or later[0] - t > MAX_FIX_MIN * 60:
            continue                      # no bars after the open soon enough: the session itself is missing, leave it
        last = later[0]                   # first tick-built bar: may be a part-minute (trades before it missing)
        add = [vendor_rows[m] for m in range(t, last + 60, 60) if m in vendor_rows]
        if not add:
            continue
        keep = [r for r in out if not (t <= r[0] <= last)]
        out = sorted(keep + [r[:6] + [None, None] for r in add], key=lambda r: r[0])
        have = {r[0] for r in out}; patched += 1
    return out, patched


def main():
    import backfill_is_m1 as bi
    from backfill_m1 import env_value, post
    ap = argparse.ArgumentParser()
    ap.add_argument('--symbols', default='NQ,ES')
    ap.add_argument('--days', type=int, default=3)
    ap.add_argument('--out', required=True)
    ap.add_argument('--post', action='store_true')
    ap.add_argument('--dry', action='store_true')
    a = ap.parse_args()
    key = env_value(os.environ.get('INSIGHTSENTRY_ENV', '/root/.hermes/profiles/chief-of-staff/scripts/insightsentry.env'), 'INSIGHTSENTRY_WEBSOCKET_API_KEY')
    if not key: raise SystemExit('no vendor key in INSIGHTSENTRY_ENV')
    purl = psec = ''
    if a.post and not a.dry:
        fe = os.environ.get('FEEDER_ENV', '/root/projects/book-feeder/feeder.env')
        purl, psec = env_value(fe, 'BOOK_RECORDER_URL'), env_value(fe, 'BOOK_INGEST_SECRET')
        if not (purl and len(psec) >= 32): raise SystemExit('no recorder url / ingest secret in FEEDER_ENV')
    today = dt.datetime.now(dt.timezone.utc).date()
    first = today - dt.timedelta(days=a.days - 1)
    months, m = [], first.replace(day=1)
    while m <= today:
        months.append(m.strftime('%Y-%m')); m = (m.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    for sym in [s.strip().upper() for s in a.symbols.split(',') if s.strip()]:
        n = 0
        for ym in months:
            j = bi.get_month(bi.CODES[sym] if sym in bi.CODES else 'CME_MINI:%s1!' % sym, ym, key)
            for day, vrows in sorted(bi.by_day(j.get('series') or []).items()):
                f = os.path.join(a.out, sym, day.isoformat() + '.json.gz')
                if day < first or not os.path.exists(f): continue
                with gzip.open(f, 'rt') as g: rows = json.load(g)
                new, k = patch_opens(rows, {r[0]: r for r in vrows})
                if not k: continue
                n += k; print(sym, day, 'open bar restored', k, flush=True)
                if a.dry: continue
                with gzip.open(f + '.tmp', 'wt') as g: json.dump(new, g, separators=(',', ':'))
                os.replace(f + '.tmp', f)
                if a.post: post(purl, psec, sym, day, new)
        print('DONE', sym, 'sessions fixed', n, flush=True)


if __name__ == '__main__':
    main()
