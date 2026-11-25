#!/usr/bin/env python3
"""TradeZoro MetaTrader host (tz-mthost-api). One isolated MT5 terminal per linked account (own Linux user, own Wine prefix, portable mode),
started on demand, restarted on crash, paused when idle. HTTP on 127.0.0.1 only; reached through the tunnel + Pages proxy.
Every request needs X-MT-Secret (proxy) AND a valid Firebase ID token; the uid comes from the token, never from the body."""
import json, os, re, subprocess, sys, threading, time, uuid, queue, logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from secure import load_key, seal, unseal, Verifier, RateLimiter
from store import Store, public

log = logging.getLogger("mthost")
CFG = dict(root=os.environ.get("MTHOST_ROOT", "/var/lib/tzmt"), data=os.environ.get("MTHOST_DATA", "/var/lib/tzmt/accounts"),
           max_live=int(os.environ.get("MTHOST_MAX_LIVE", "30")), per_user=int(os.environ.get("MTHOST_PER_USER", "5")),
           idle_h=float(os.environ.get("MTHOST_IDLE_H", "6")), evict_idle_s=int(os.environ.get("MTHOST_EVICT_IDLE_S", "600")),
           min_free_mb=int(os.environ.get("MTHOST_MIN_FREE_MB", "3000")), bad_login_max=3, mem="1400M", cpu="80%", audit="/var/log/tzmt/orders.jsonl", servers="/var/lib/tzmt/servers.json")
WORKER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "worker.py")
DEMO = "MetaQuotes-Demo"
BUSY = {"error": "MetaTrader is busy right now. Try again in a minute.", "code": "busy"}


def worker_cmd(n):
    """systemd service per terminal: unit name, user, memory/CPU caps. stdin/stdout piped to us."""
    u = "tz-mthost-t%d" % n
    env = ["HOME=/var/lib/tzmt/slots/%d" % n, "WINEPREFIX=/var/lib/tzmt/slots/%d/prefix" % n, "WINEDEBUG=-all",
           "WINEDLLOVERRIDES=mscoree,mshtml=", "DISPLAY=:199", "PATH=/opt/wine-stable/bin:/usr/bin:/bin"]
    c = ["systemd-run", "--pipe", "--collect", "--quiet", "--unit", u, "-p", "User=tzmt-%d" % n, "-p", "Group=tzmt",
         "-p", "MemoryMax=" + CFG["mem"], "-p", "CPUQuota=" + CFG["cpu"], "-p", "TasksMax=400", "-p", "TimeoutStopSec=8", "-p", "KillMode=control-group", "-p", "WorkingDirectory=/var/lib/tzmt/slots/%d" % n]
    for e in env: c += ["-p", "Environment=" + e]
    return c + ["/opt/wine-stable/bin/wine", "C:\\Python311\\python.exe", "Z:" + WORKER.replace("/", "\\"), "C:\\mt\\terminal64.exe"], u


class Busy(Exception): pass


class LoginFailed(ConnectionError): pass


def mem_free_mb():
    try:
        for l in open("/proc/meminfo"):
            if l.startswith("MemAvailable:"): return int(l.split()[1]) // 1024
    except OSError: pass
    return 0


class Slots:
    """Linux side of a slot: user, dirs, overlay mount. Replaced by a fake in tests."""
    def prepare(self, n):
        sd = "/var/lib/tzmt/slots/%d" % n
        subprocess.run(["id", "tzmt-%d" % n], capture_output=True) .returncode == 0 or subprocess.run(["useradd", "-M", "-g", "tzmt", "-d", sd, "-s", "/usr/sbin/nologin", "-u", str(2100 + n), "tzmt-%d" % n], check=True, capture_output=True)
        for d in ("upper", "work", "prefix"):
            os.makedirs(sd + "/" + d, exist_ok=True)
        own = "tzmt-%d:tzmt" % n
        subprocess.run(["chown", own, sd, sd + "/upper", sd + "/work", sd + "/prefix"], check=True)
        os.chmod(sd, 0o700)
        if subprocess.run(["mountpoint", "-q", sd + "/prefix"]).returncode:
            subprocess.run(["mount", "-t", "overlay", "overlay", "-o", "lowerdir=/opt/tzmt/base,upperdir=%s/upper,workdir=%s/work" % (sd, sd), sd + "/prefix"], check=True)
        if not os.path.exists(sd + "/.owned"):   # one pass per fresh slot (first write copies a file up; the base itself stays root-owned)
            subprocess.run(["chown", "-R", own, sd + "/prefix"], check=True); open(sd + "/.owned", "w").close(); subprocess.run(["chown", own, sd + "/.owned"])

    def wipe(self, n):
        sd = "/var/lib/tzmt/slots/%d" % n
        try: os.remove(sd + "/.owned")
        except OSError: pass
        subprocess.run(["umount", "-l", sd + "/prefix"], capture_output=True)
        for d in ("upper", "work"):
            subprocess.run(["rm", "-rf", sd + "/" + d], check=False)

    def start(self, n):
        cmd, unit = worker_cmd(n)
        return subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1), unit

    def stop(self, unit):
        subprocess.run(["systemctl", "stop", unit], capture_output=True, timeout=40)
        subprocess.run(["systemctl", "reset-failed", unit], capture_output=True, timeout=10)
        for _ in range(20):   # the unit name is reused by the next account on this slot: wait until it is really gone
            if subprocess.run(["systemctl", "is-active", "--quiet", unit]).returncode: break
            time.sleep(0.5)


class Term:
    """One running terminal for one account."""
    def __init__(self, proc, unit):
        self.p, self.unit, self.q, self.lk, self.t0 = proc, unit, queue.Queue(), threading.Lock(), time.time()
        self.waiting = {}
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for line in self.p.stdout:
            try: o = json.loads(line)
            except ValueError: continue
            (self.waiting.get(o.get("rid")) or self.q).put(o)
        self.q.put({"dead": True})

    def alive(self): return self.p.poll() is None

    def send(self, o): self.p.stdin.write(json.dumps(o) + "\n"); self.p.stdin.flush()

    def call(self, op, a=None, timeout=25):
        with self.lk:
            if not self.alive(): raise ConnectionError("terminal_down")
            rid = uuid.uuid4().hex[:8]; w = queue.Queue(); self.waiting[rid] = w
            try:
                self.send({"op": op, "a": a or {}, "rid": rid})
                try: return w.get(timeout=timeout)
                except queue.Empty: raise TimeoutError("no_answer")
            finally:
                self.waiting.pop(rid, None)


class Host:
    def __init__(self, store, key, slots=None, cfg=None, now=time.time, free_mb=None):
        self.st, self.key, self.slots, self.cfg, self.now = store, key, slots or Slots(), dict(CFG, **(cfg or {})), now
        self.live, self.lk, self.fails = {}, threading.RLock(), {}   # live: aid -> Term (aid = 64 random bits, unique across users)
        self.last = {}   # aid -> last use time
        self.alk = {}    # aid -> Lock: one boot per account at a time; the global lock is never held during a boot
        self.bad = {}    # aid -> (failed logins in a row, next try allowed at): a wrong password is not retried against the broker
        self.free_mb = free_mb or mem_free_mb

    # ---- slots --------------------------------------------------------------------
    def _free_slot(self):
        used = {r.get("slot") for r in self.st.all()}
        for n in range(1, 200):
            if n not in used: return n
        raise RuntimeError("no_slot")

    def _aad(self, rec): return rec["uid"] + ":" + rec["id"]

    def _alock(self, aid):
        with self.lk: return self.alk.setdefault(aid, threading.Lock())

    def _room(self):
        """capacity check (under self.lk): free a slot by pausing a terminal idle for evict_idle_s, else Busy. Never stops one in use."""
        n = len([1 for x in self.live.values() if x.alive()])
        if n < self.cfg["max_live"] and self.free_mb() >= self.cfg["min_free_mb"]: return
        idle = [a for a in self.live if self.now() - self.last.get(a, 0) >= self.cfg["evict_idle_s"]]
        if not idle: raise Busy()
        self._stop(min(idle, key=lambda a: self.last.get(a, 0)))

    def _boot(self, rec, pw, timeout=120):
        """start the terminal and wait for the login answer -> (Term|None, err)"""
        self.slots.prepare(rec["slot"])
        for attempt in range(3):   # a start that dies at once (unit name still busy, wine warming up) is retried; a wrong password is not
            proc, unit = self.slots.start(rec["slot"])
            t = Term(proc, unit)
            time.sleep(1.5)
            if t.alive(): break
            self.slots.stop(unit); time.sleep(2)
        else:
            return None, [0, "host"]   # never hand the password to a process that is not running
        t.send({"path": "C:\\mt\\terminal64.exe", "login": rec["login"], "pw": pw, "server": rec["server"], "mode": rec["mode"], "timeout": 90000})
        try: o = t.q.get(timeout=timeout)
        except queue.Empty: o = {"ready": False, "err": [0, "timeout"]}
        if o.get("ready"): return t, None
        self.slots.stop(unit); return None, o.get("err")

    def ensure(self, rec):
        """running terminal for a linked account (resumes a paused one). Busy when full; LoginFailed after a bad password."""
        aid = rec["id"]
        with self._alock(aid):
            with self.lk:
                t = self.live.get(aid)
                if t and t.alive(): self.last[aid] = self.now(); return t
                n, at = self.bad.get(aid, (0, 0))
                if n >= self.cfg["bad_login_max"] or self.now() < at: raise LoginFailed()
                self._room()
            pw = unseal(self.key, rec["pw"], self._aad(rec))
            t, err = self._boot(rec, pw)
            del pw
            with self.lk:
                if not t:
                    if (err or [0])[0] == -6: n += 1   # wrong login/password/server: stop after bad_login_max, member re-links
                    self.bad[aid] = (n, self.now() + min(60 * 2 ** n, 1800))
                    if n >= self.cfg["bad_login_max"]:
                        rec["state"] = "needs_login"; self.st.put(rec)
                    raise LoginFailed()
                self.bad.pop(aid, None); self.live[aid] = t; self.last[aid] = self.now()
                return t

    def _pause_idlest(self):
        if not self.live: return
        aid = min(self.live, key=lambda a: self.last.get(a, 0)); self._stop(aid)

    def _stop(self, aid):
        t = self.live.pop(aid, None)
        if t:
            try: t.send({"op": "quit"})
            except Exception: pass
            self.slots.stop(t.unit)

    def maintain(self):
        """called every ~30 s: pause idle accounts, restart crashed ones that were in use recently"""
        with self.lk:
            for aid, t in list(self.live.items()):
                idle = self.now() - self.last.get(aid, 0)
                if idle > self.cfg["idle_h"] * 3600: self._stop(aid); continue
                if not t.alive():
                    self.live.pop(aid, None); self.slots.stop(t.unit)
                    rec = next((r for r in self.st.all() if r["id"] == aid), None)
                    n = self.fails.get(aid, 0)
                    if rec and n < 5:
                        self.fails[aid] = n + 1
                        try: self.ensure(rec)
                        except Exception: log.warning("restart failed for %s", aid)

    # ---- account actions ------------------------------------------------------------
    def link(self, uid, b):
        login, server, mode = str(b.get("login", "")).strip(), str(b.get("server", "")).strip(), b.get("mode", "trading")
        pw = b.get("password")
        if not re.fullmatch(r"\d{1,12}", login): return 400, {"error": "Login must be the number from your broker.", "code": "bad_login"}
        if not re.fullmatch(r"[A-Za-z0-9._\- ]{2,60}", server): return 400, {"error": "Pick the server your broker gave you.", "code": "bad_server"}
        if not isinstance(pw, str) or not (1 <= len(pw) <= 100): return 400, {"error": "Enter your password.", "code": "bad_password"}
        if mode not in ("trading", "investor"): return 400, {"error": "Bad mode.", "code": "bad_mode"}
        if (b.get("platform") or "mt5") != "mt5": return 400, {"error": "MetaTrader 4 sign-in is not open yet. Use MetaTrader 5, or the Advanced guide for MT4.", "code": "mt4_not_ready"}
        with self.lk: return self._link(uid, login, server, mode, pw, b)

    def _link(self, uid, login, server, mode, pw, b):
        mine = self.st.list(uid)
        if len(mine) >= self.cfg["per_user"]: return 400, {"error": "Account limit reached. Remove one first.", "code": "limit"}
        if any(r["login"] == login and r["server"].lower() == server.lower() for r in mine): return 409, {"error": "This account is already linked.", "code": "exists"}
        try: self._room()   # capacity: refuse early with a friendly "busy" (never stops a terminal that is in use)
        except Busy: return 503, BUSY
        rec = dict(id=uuid.uuid4().hex[:16], uid=uid, platform="mt5", login=login, server=server, mode=mode, state="linking", created=int(self.now()), slot=self._free_slot())
        rec["pw"] = seal(self.key, pw, self._aad(rec))
        self.st.put(rec)   # reserves the slot (under the lock: two links never share one)
        self.lk.release()
        try:
            return self._finish_link(uid, rec, pw, mode, server)
        finally:
            self.lk.acquire()

    def _finish_link(self, uid, rec, pw, mode, server):
        try:
            self.slots.wipe(rec["slot"])   # a fresh account always starts on a clean prefix: nothing left from an earlier account
            t, err = self._boot(rec, pw)
        except Exception:
            t, err = None, [0, "host"]
        if not t:
            self.st.delete(uid, rec["id"]); self.slots.wipe(rec["slot"])
            return 422, self._login_error(err)
        with self.lk: self.live[rec["id"]] = t; self.last[rec["id"]] = self.now()
        a = t.call("account")
        rec["state"], rec["name"], rec["currency"] = "linked", a.get("name"), a.get("currency")
        if mode == "trading" and not a.get("trade_allowed"): rec["mode"] = "investor"   # broker said read-only: never pretend
        self.st.put(rec); self.remember_server(server)
        return 200, {"account": public(rec), "account_info": {k: a.get(k) for k in ("balance", "equity", "currency")}}

    @staticmethod
    def _login_error(err):
        code = (err or [0])[0]
        if code == -6: return {"error": "Login, password or server is not right. Check all three. Prop firms: use the exact server name from your email.", "code": "bad_credentials"}
        if code in (-10005, 0): return {"error": "The server did not answer in time. Check the server name and try again.", "code": "server_timeout"}
        return {"error": "Could not sign in to that account. Check login, password and server.", "code": "login_failed"}

    def unlink(self, uid, aid):
        rec = self.st.get(uid, aid)
        if not rec: return 404, {"error": "Not found", "code": "not_found"}
        with self.lk: self._stop(aid)
        self.st.delete(uid, aid); self.slots.wipe(rec["slot"])   # password blob gone with the record, terminal data gone with the slot
        return 200, {"ok": True}

    def op(self, uid, aid, op, a=None):
        rec = self.st.get(uid, aid)
        if not rec or rec.get("uid") != uid: return 404, {"error": "Not found", "code": "not_found"}
        if op in ("place", "modify", "cancel", "close") and rec["mode"] != "trading":
            self.audit(uid, rec, op, a, {"ok": False, "error": "read_only"}); return 403, {"error": "This account is read-only (investor password).", "code": "read_only"}
        try:
            t = self.ensure(rec); r = t.call(op, a)
        except Busy: return 503, BUSY
        except LoginFailed: return 409, {"error": "MetaTrader refused the saved password. Remove the account and link it again with the new password.", "code": "needs_login"}
        except ConnectionError: return 503, {"error": "Could not reach the account. Try again in a minute.", "code": "upstream"}
        except TimeoutError:
            if op in ("place", "modify", "cancel", "close"): self.audit(uid, rec, op, a, {"ok": False, "error": "unknown"}); return 503, {"error": "No clear answer. The order may or may not have gone through. Check positions.", "code": "unknown"}
            return 503, {"error": "No answer. Try again.", "code": "upstream"}
        r.pop("rid", None)
        if op in ("place", "modify", "cancel", "close"): self.audit(uid, rec, op, a, r)
        return 200, r

    def audit(self, uid, rec, op, a, r):
        a = a or {}
        row = dict(t=int(self.now()), uid=uid, acct=rec["id"], login=rec["login"], op=op, symbol=a.get("symbol"), side=a.get("side"), vol=a.get("volume"), type=a.get("type"),
                   ticket=a.get("ticket"), ok=r.get("ok"), retcode=r.get("retcode"), err=r.get("error"), order=r.get("order"), idem=a.get("idem"))
        try:
            os.makedirs(os.path.dirname(self.cfg["audit"]), exist_ok=True)
            fd = os.open(self.cfg["audit"], os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
            with os.fdopen(fd, "a") as f: f.write(json.dumps(row) + "\n")
        except OSError: log.error("audit write failed")

    # ---- server list --------------------------------------------------------------
    def remember_server(self, name):
        try:
            s = set(json.load(open(self.cfg["servers"])))
        except (OSError, ValueError): s = set()
        if name not in s:
            s.add(name); os.makedirs(os.path.dirname(self.cfg["servers"]), exist_ok=True); json.dump(sorted(s), open(self.cfg["servers"], "w"))

    def servers(self, q):
        try: s = set(json.load(open(self.cfg["servers"])))
        except (OSError, ValueError): s = set()
        s.add(DEMO); q = q.lower().strip()
        return sorted(x for x in s if q in x.lower())[:30]

    def health(self):
        live = [t for t in self.live.values() if t.alive()]
        return {"ok": True, "live": len(live), "max": self.cfg["max_live"], "accounts": len(self.st.all())}


def health_proof(secret, nonce, hosthdr):
    import hashlib, hmac
    k = hmac.new(secret.encode(), b"tzmt-health-proof-v1", hashlib.sha256).digest()   # derived key: never the bearer itself
    return hmac.new(k, (nonce + "|" + hosthdr.lower()).encode(), hashlib.sha256).hexdigest()


GATE = {"off": os.environ.get("MTHOST_OFF_FILE", "/etc/tzmt/off"), "allow": os.environ.get("MTHOST_ALLOW_FILE", "/etc/tzmt/allow.json")}


def gate(uid, path):
    """Host-side backstop to the Pages gate (admins + beta testers): /etc/tzmt/off present = MetaTrader paused for everyone;
    /etc/tzmt/allow.json {"uids": [...]} present = only those uids. Neither file = the Pages gate alone decides."""
    if os.path.exists(GATE["off"]): return {"error": "MetaTrader is paused for maintenance. Try again later.", "code": "paused"}
    try: allow = json.load(open(GATE["allow"])).get("uids")
    except (OSError, ValueError, AttributeError): allow = None
    if isinstance(allow, list) and uid not in allow: return {"error": "MetaTrader sign-in is coming soon.", "code": "not_open"}
    return None


def make_handler(host, ver, rl, secret):
    class H(BaseHTTPRequestHandler):
        server_version = "tzmt"
        timeout = 30   # slow or stuck clients never hold a thread for long
        def log_message(self, *a): pass
        def _send(self, code, o):
            b = json.dumps(o).encode(); self.send_response(code)
            self.send_header("content-type", "application/json"); self.send_header("cache-control", "no-store"); self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)
        def _go(self, method):
            path = self.path.split("?")[0]; q = self.path.split("?", 1)[1] if "?" in self.path else ""
            import hmac
            ip = self.headers.get("cf-connecting-ip") or self.client_address[0]
            if not secret or not hmac.compare_digest(self.headers.get("x-mt-secret", "").encode(), secret.encode()):
                # only a WRONG secret counts (the watcher's no-secret proof checks must never lock it out)
                if self.headers.get("x-mt-secret") is not None and not rl.hit(("badsecret", ip), 10): return self._send(429, {"error": "Too many tries", "code": "rate_limited"})
                # quick-tunnel watcher check (no secret sent): /health?n=<nonce> proves THIS hostd answered on THIS address
                # (HMAC over nonce + Host header with a key derived from the secret; a relay or a fake local server cannot make it)
                m = re.fullmatch(r"n=([A-Za-z0-9]{16,64})", q) if path == "/health" else None
                return self._send(403, dict({"error": "Forbidden", "code": "forbidden"}, **({"proof": health_proof(secret, m.group(1), self.headers.get("host", ""))} if m and secret else {})))
            if path == "/health": return self._send(200, host.health())
            h = self.headers.get("authorization", ""); uid = ver.uid(h[7:]) if h.startswith("Bearer ") else None
            if not uid: return self._send(401, {"error": "Sign in first", "code": "signed_out"})
            g = gate(uid, path)
            if g: return self._send(403, g)
            body = {}
            if method == "POST":
                try: n = int(self.headers.get("content-length") or 0)
                except ValueError: n = -1
                if n < 0 or n > 8192: return self._send(413, {"error": "Too big", "code": "bad_request"})
                try: body = json.loads(self.rfile.read(n) or b"{}")
                except ValueError: return self._send(400, {"error": "Bad request", "code": "bad_request"})
                if not isinstance(body, dict): return self._send(400, {"error": "Bad request", "code": "bad_request"})
            m = re.fullmatch(r"/v1/(servers|accounts|link|unlink|op)", path)
            if not m: return self._send(404, {"error": "Not found", "code": "not_found"})
            r = m.group(1)
            lim = {"link": 5, "unlink": 10, "op": 120}.get(r, 60)
            if not rl.hit((uid, r), lim): return self._send(429, {"error": "Too many tries. Wait a minute.", "code": "rate_limited"})
            try:
                if r == "servers" and method == "GET": return self._send(200, {"servers": host.servers(re.sub(r"^q=", "", q.split("&")[0]) if q.startswith("q=") else "")})
                if r == "accounts" and method == "GET": return self._send(200, {"accounts": [public(x) for x in host.st.list(uid)]})
                if r == "link" and method == "POST": c, o = host.link(uid, body); return self._send(c, o)
                if r == "unlink" and method == "POST": c, o = host.unlink(uid, str(body.get("accountId", ""))); return self._send(c, o)
                if r == "op" and method == "POST":
                    o = str(body.get("op", ""))
                    if o not in ("account", "live", "positions", "orders", "history", "symbols", "symbol", "tick", "place", "modify", "cancel", "close"): return self._send(400, {"error": "Not allowed", "code": "bad_request"})
                    a = body.get("args") if isinstance(body.get("args"), dict) else {}
                    c, out = host.op(uid, str(body.get("accountId", "")), o, a); return self._send(c, out)
            except ValueError: return self._send(404, {"error": "Not found", "code": "not_found"})
            except Exception: log.exception("handler"); return self._send(500, {"error": "Server error", "code": "server_error"})
            return self._send(405, {"error": "Method", "code": "method"})
        def do_GET(self): self._go("GET")
        def do_POST(self): self._go("POST")
    return H


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    host = Host(Store(CFG["data"]), load_key())
    secret = os.environ.pop("MTHOST_SECRET", "")   # out of the environment: no child process inherits it
    os.environ.pop("MT_PUBLISH_KEY", None)          # the watcher's signing key (same env file): hostd never needs it
    if len(secret) < 32: sys.exit("MTHOST_SECRET missing or too short")
    def loop():
        while True:
            time.sleep(30)
            try: host.maintain()
            except Exception: log.exception("maintain")
    threading.Thread(target=loop, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("MTHOST_PORT", "8787"))), make_handler(host, Verifier(), RateLimiter(), secret)).serve_forever()


if __name__ == "__main__":
    main()
