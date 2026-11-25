"""Runs under Wine Python, one process per hosted MT5 account. Talks JSON lines on stdin/stdout.
Line 1 = {path, login, pw, server, mode, hold}. The password arrives on stdin only (never argv/env) and is dropped after login.
Defence in depth: in investor (read-only) mode every trading op is refused here too."""
import sys, json, time, os
import MetaTrader5 as m

READ = {"live", "ping", "account", "positions", "orders", "history", "symbols", "symbol", "tick"}
TF_DONE = {}


def nt(x):
    return x._asdict() if hasattr(x, "_asdict") else x


def rows(t, keys=None):
    return [{k: v for k, v in nt(r).items() if not keys or k in keys} for r in (t or [])]


def scrub(path):
    # the MetaTrader5 package writes the startup config with the password in clear; blank it once the terminal has read it
    p = os.path.join(os.path.dirname(path), "s.ini")
    try:
        t = open(p, "rb").read().decode("latin1").replace("\r", "")
        t = "\r\n".join(("Password=" if l.lower().startswith("password=") else l) for l in t.split("\n"))
        open(p, "wb").write(t.encode("latin1"))
    except OSError:
        pass


def deal_to_dict(d):
    return {k: nt(d)[k] for k in ("ticket", "order", "time", "type", "entry", "symbol", "volume", "price", "profit", "commission", "swap", "position_id", "comment", "magic")}


def retmsg(r):
    if r is None:
        return {"ok": False, "error": "no_answer", "detail": str(m.last_error())}
    ok = r.retcode in (m.TRADE_RETCODE_DONE, m.TRADE_RETCODE_PLACED, m.TRADE_RETCODE_DONE_PARTIAL)
    return {"ok": ok, "retcode": r.retcode, "comment": r.comment, "order": r.order, "deal": r.deal, "volume": r.volume, "price": r.price}


def place(a):
    sym = a["symbol"]; info = m.symbol_info(sym)
    if info is None or not m.symbol_select(sym, True):
        return {"ok": False, "error": "symbol_unknown"}
    buy = a["side"] == "buy"; typ = a.get("type", "market")
    tick = m.symbol_info_tick(sym)
    req = {"symbol": sym, "volume": float(a["volume"]), "deviation": 30, "magic": 26112, "comment": "tz",
           "type_time": m.ORDER_TIME_GTC}
    fm = info.filling_mode
    req["type_filling"] = m.ORDER_FILLING_FOK if fm & 1 else m.ORDER_FILLING_IOC if fm & 2 else m.ORDER_FILLING_RETURN
    if typ == "market":
        req.update(action=m.TRADE_ACTION_DEAL, type=m.ORDER_TYPE_BUY if buy else m.ORDER_TYPE_SELL, price=tick.ask if buy else tick.bid)
    else:
        px = float(a["price"]); ask, bid = tick.ask, tick.bid
        if typ == "limit": t = m.ORDER_TYPE_BUY_LIMIT if buy else m.ORDER_TYPE_SELL_LIMIT
        else: t = m.ORDER_TYPE_BUY_STOP if buy else m.ORDER_TYPE_SELL_STOP
        req.update(action=m.TRADE_ACTION_PENDING, type=t, price=px, type_filling=m.ORDER_FILLING_RETURN)
    if a.get("sl"): req["sl"] = float(a["sl"])
    if a.get("tp"): req["tp"] = float(a["tp"])
    return retmsg(m.order_send(req))


def modify(a):
    o = m.orders_get(ticket=int(a["ticket"]))
    if o:
        o = o[0]
        req = {"action": m.TRADE_ACTION_MODIFY, "order": o.ticket, "price": float(a.get("price") or o.price_open),
               "sl": float(a["sl"]) if a.get("sl") is not None else o.sl, "tp": float(a["tp"]) if a.get("tp") is not None else o.tp,
               "type_time": m.ORDER_TIME_GTC}
        return retmsg(m.order_send(req))
    p = m.positions_get(ticket=int(a["ticket"]))
    if not p:
        return {"ok": False, "error": "not_found"}
    p = p[0]
    return retmsg(m.order_send({"action": m.TRADE_ACTION_SLTP, "position": p.ticket, "symbol": p.symbol,
                                "sl": float(a["sl"]) if a.get("sl") is not None else p.sl, "tp": float(a["tp"]) if a.get("tp") is not None else p.tp}))


def cancel(a):
    return retmsg(m.order_send({"action": m.TRADE_ACTION_REMOVE, "order": int(a["ticket"])}))


def close(a):
    p = m.positions_get(ticket=int(a["ticket"]))
    if not p:
        return {"ok": False, "error": "not_found"}
    p = p[0]; buy = p.type == m.POSITION_TYPE_BUY; t = m.symbol_info_tick(p.symbol); info = m.symbol_info(p.symbol)
    vol = float(a.get("volume") or p.volume)
    fm = info.filling_mode
    return retmsg(m.order_send({"action": m.TRADE_ACTION_DEAL, "symbol": p.symbol, "position": p.ticket, "volume": vol,
                                "type": m.ORDER_TYPE_SELL if buy else m.ORDER_TYPE_BUY, "price": t.bid if buy else t.ask, "deviation": 30, "magic": 26112,
                                "type_filling": m.ORDER_FILLING_FOK if fm & 1 else m.ORDER_FILLING_IOC if fm & 2 else m.ORDER_FILLING_RETURN}))


def handle(c, mode):
    op, a = c.get("op"), c.get("a") or {}
    if op in ("place", "modify", "cancel", "close") and mode != "trading":
        return {"ok": False, "error": "read_only"}
    if op == "ping":
        ti = m.terminal_info(); return {"ok": True, "connected": bool(ti and ti.connected)}
    if op == "account":
        x = m.account_info()
        if x is None: return {"ok": False, "error": "no_account"}
        d = nt(x); return {"ok": True, **{k: d[k] for k in ("login", "server", "name", "currency", "balance", "equity", "margin", "margin_free", "profit", "leverage", "trade_allowed", "company")}}
    if op == "live":
        return {"ok": True, "positions": handle({"op": "positions"}, mode)["positions"], "orders": handle({"op": "orders"}, mode)["orders"]}
    if op == "positions":
        return {"ok": True, "positions": rows(m.positions_get(), ("ticket", "symbol", "type", "volume", "price_open", "price_current", "sl", "tp", "profit", "swap", "time", "comment"))}
    if op == "orders":
        return {"ok": True, "orders": rows(m.orders_get(), ("ticket", "symbol", "type", "volume_current", "price_open", "sl", "tp", "time_setup", "state", "comment"))}
    if op == "history":
        t1 = int(a.get("to") or time.time()) + 86400; t0 = int(a.get("from") or t1 - 90 * 86400)
        d = m.history_deals_get(t0, t1)
        return {"ok": True, "deals": [deal_to_dict(x) for x in (d or [])][-int(a.get("limit") or 2000):]}
    if op == "symbols":
        q = str(a.get("q") or "").lower()
        if a.get("names"):
            return {"ok": True, "symbols": [s.name for s in (m.symbols_get() or []) if not q or q in s.name.lower()][: int(a.get("limit") or 5000)]}
        out = [{"name": s.name, "desc": s.description, "path": s.path, "digits": s.digits, "min": s.volume_min, "step": s.volume_step, "max": s.volume_max} for s in (m.symbols_get() or []) if not q or q in s.name.lower() or q in (s.description or "").lower()]
        return {"ok": True, "symbols": out[: int(a.get("limit") or 200)]}
    if op == "symbol":
        s = m.symbol_info(a["symbol"])
        if s is None: return {"ok": False, "error": "symbol_unknown"}
        return {"ok": True, "name": s.name, "digits": s.digits, "min": s.volume_min, "step": s.volume_step, "max": s.volume_max, "point": s.point, "trade_mode": s.trade_mode}
    if op == "tick":
        m.symbol_select(a["symbol"], True); t = m.symbol_info_tick(a["symbol"]); return {"ok": bool(t), "bid": t and t.bid, "ask": t and t.ask, "time": t and t.time}
    if op == "place": return place(a)
    if op == "modify": return modify(a)
    if op == "cancel": return cancel(a)
    if op == "close": return close(a)
    return {"ok": False, "error": "bad_op"}


def out(o):
    sys.stdout.write(json.dumps(o, default=str) + "\n"); sys.stdout.flush()


def main():
    cfg = json.loads(sys.stdin.readline())
    mode = cfg.get("mode", "investor")
    ok = m.initialize(path=cfg["path"], login=int(cfg["login"]), password=cfg.pop("pw"), server=cfg["server"], portable=True, timeout=int(cfg.get("timeout", 90000)))
    cfg.clear()
    if not ok:
        out({"ready": False, "err": list(m.last_error())}); return
    scrub(sys.argv[1] if len(sys.argv) > 1 else r"C:\mt\terminal64.exe")
    a = m.account_info()
    out({"ready": True, "mode_real": "trading" if a and a.trade_allowed else "investor"})
    for line in sys.stdin:
        line = line.strip()
        if not line: continue
        try:
            c = json.loads(line); r = handle(c, mode)
        except Exception as e:
            r = {"ok": False, "error": "worker_error", "detail": type(e).__name__}
        r["rid"] = c.get("rid") if isinstance(c, dict) else None
        out(r)
        if isinstance(c, dict) and c.get("op") == "quit": break
    m.shutdown()


if __name__ == "__main__":
    main()
