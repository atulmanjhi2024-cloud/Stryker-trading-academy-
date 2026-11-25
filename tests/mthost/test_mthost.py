"""Unit tests for the MetaTrader host: crypto, isolation, read-only refusal, endpoint auth, rate limit. No Wine, no network, no real accounts."""
import json, os, sys, tempfile, threading, unittest, base64, urllib.request, urllib.error, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools", "mthost"))
import hostd, secure, store
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization

KEY = os.urandom(32)


class FakeTerm:
    def __init__(self, ok=True): self.ok, self.unit, self.calls = ok, "u", []
    def alive(self): return self.ok
    def send(self, o): pass
    def call(self, op, a=None, timeout=25):
        self.calls.append(op)
        if op == "account": return {"ok": True, "name": "Demo", "currency": "USD", "balance": 100.0, "equity": 100.0, "trade_allowed": True, "rid": "x"}
        return {"ok": True, "rid": "x", "retcode": 10009, "order": 7}


class FakeSlots:
    def __init__(self): self.wiped, self.fail = [], False
    def prepare(self, n): pass
    def wipe(self, n): self.wiped.append(n)
    def stop(self, u): pass


class T(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(); self.st = store.Store(self.d + "/acc"); self.sl = FakeSlots()
        self.h = hostd.Host(self.st, KEY, self.sl, dict(audit=self.d + "/audit.jsonl", servers=self.d + "/s.json"))
        self.term = FakeTerm(); self.err = None
        def boot(rec, pw, timeout=120): return (None, self.err) if self.err else (self.term, None)
        self.h._boot = boot

    def link(self, uid="u1", mode="trading", login="123", pw="pw-secret-1"):
        return self.h.link(uid, {"login": login, "server": "Some-Live", "password": pw, "mode": mode})

    # crypto
    def test_crypto_roundtrip_and_aad(self):
        b = secure.seal(KEY, "hunter2", "u:a")
        self.assertNotIn("hunter2", b); self.assertEqual(secure.unseal(KEY, b, "u:a"), "hunter2")
        with self.assertRaises(Exception): secure.unseal(KEY, b, "other:a")      # copied blob does not open for another user
        with self.assertRaises(Exception): secure.unseal(os.urandom(32), b, "u:a")
        self.assertNotEqual(secure.seal(KEY, "x", "a"), secure.seal(KEY, "x", "a"))  # fresh nonce
        with self.assertRaises(RuntimeError): secure.load_key(base64.b64encode(b"short").decode())

    def test_password_never_stored_plain_or_returned(self):
        c, o = self.link(); self.assertEqual(c, 200)
        self.assertNotIn("pw-secret-1", json.dumps(o))
        raw = open(self.d + "/acc/u1/" + o["account"]["id"] + ".json").read()
        self.assertNotIn("pw-secret-1", raw)
        self.assertEqual(oct(os.stat(self.d + "/acc/u1/" + o["account"]["id"] + ".json").st_mode & 0o777), "0o600")
        self.assertNotIn("pw", o["account"]); self.assertNotIn("slot", o["account"])

    # isolation
    def test_isolation(self):
        c, o = self.link("u1"); aid = o["account"]["id"]
        self.assertEqual(self.h.st.list("u2"), [])
        self.assertEqual(self.h.op("u2", aid, "positions")[0], 404)
        self.assertEqual(self.h.unlink("u2", aid)[0], 404)
        self.assertEqual(self.h.op("u1", aid, "positions")[0], 200)
        c2, o2 = self.link("u2", login="123"); self.assertEqual(c2, 200)   # same login under another user is its own slot
        self.assertNotEqual(self.st.get("u1", aid)["slot"], self.st.get("u2", o2["account"]["id"])["slot"])
        with self.assertRaises(ValueError): self.st.get("../x", aid) or self.st._p("../x", aid)

    # read-only
    def test_read_only_refuses_orders(self):
        c, o = self.link(mode="investor"); aid = o["account"]["id"]
        for op in ("place", "modify", "cancel", "close"):
            c, r = self.h.op("u1", aid, op, {"symbol": "EURUSD", "side": "buy", "volume": 0.01})
            self.assertEqual((c, r["code"]), (403, "read_only"))
        self.assertNotIn("place", self.term.calls)
        self.assertEqual(self.h.op("u1", aid, "account")[0], 200)

    def test_broker_readonly_downgrades_mode(self):
        self.term.call = lambda op, a=None, timeout=25: {"ok": True, "name": "n", "currency": "USD", "trade_allowed": False}
        c, o = self.link(); self.assertEqual(o["account"]["mode"], "investor")

    def test_order_audit_row_no_secrets(self):
        c, o = self.link(); aid = o["account"]["id"]
        self.h.op("u1", aid, "place", {"symbol": "EURUSD", "side": "buy", "volume": 0.01, "type": "market"})
        row = json.loads(open(self.d + "/audit.jsonl").read().splitlines()[-1])
        self.assertEqual((row["uid"], row["op"], row["symbol"]), ("u1", "place", "EURUSD")); self.assertNotIn("pw-secret-1", json.dumps(row))

    def test_link_failure_cleans_up(self):
        self.err = [-6, "Authorization failed"]
        c, o = self.link(); self.assertEqual((c, o["code"]), (422, "bad_credentials"))
        self.assertEqual(self.st.list("u1"), []); self.assertTrue(self.sl.wiped)

    def test_unlink_deletes_everything(self):
        c, o = self.link(); aid = o["account"]["id"]; slot = self.st.get("u1", aid)["slot"]
        self.assertEqual(self.h.unlink("u1", aid)[0], 200)
        self.assertEqual(self.st.list("u1"), []); self.assertIn(slot, self.sl.wiped); self.assertNotIn(aid, self.h.live)

    def test_validation_and_limits(self):
        for b in ({"login": "abc", "server": "S1", "password": "x"}, {"login": "1", "server": "../etc", "password": "x"}, {"login": "1", "server": "S1", "password": ""},
                  {"login": "1", "server": "S1", "password": "x", "mode": "root"}, {"login": "1", "server": "S1", "password": "x", "platform": "mt4"}):
            self.assertEqual(self.h.link("u1", b)[0], 400)
        for i in range(5): self.assertEqual(self.link(login=str(100 + i))[0], 200)
        self.assertEqual(self.link(login="999")[0], 400)
        self.assertEqual(self.link(login="100")[0], 400)

    def test_idle_pause_and_resume(self):
        t = [1000.0]; self.h.now = lambda: t[0]
        c, o = self.link(); aid = o["account"]["id"]; self.assertIn(aid, self.h.live)
        t[0] += 7 * 3600; self.h.maintain(); self.assertNotIn(aid, self.h.live)
        self.assertEqual(self.h.op("u1", aid, "account")[0], 200); self.assertIn(aid, self.h.live)   # resumed on demand
        self.assertEqual(self.st.get("u1", aid)["state"], "linked")

    def test_crash_restart(self):
        c, o = self.link(); aid = o["account"]["id"]; self.term.ok = False
        self.h.maintain(); self.assertIn(aid, self.h.live)   # same fake comes back alive=False; restart attempted
        self.h.live.pop(aid); self.term.ok = True; self.assertEqual(self.h.op("u1", aid, "account")[0], 200)

    def test_security_fixes(self):
        # key version prefix; unknown versions refused
        b = secure.seal(KEY, "x", "a"); self.assertTrue(b.startswith("v1:"))
        with self.assertRaises(ValueError): secure.unseal(KEY, "v9:" + b[3:], "a")
        # a record whose uid does not match the caller is never used
        c, o = self.link("u1"); aid = o["account"]["id"]
        self.assertEqual(self.h.op("u2", aid, "account")[0], 404)
        # a fresh link always starts on a wiped slot
        self.assertIn(self.st.get("u1", aid)["slot"], self.sl.wiped)

    def test_busy_when_full_never_evicts_active(self):
        t = [1000.0]; self.h.now = lambda: t[0]; self.h.cfg["max_live"] = 2
        a = self.link(login="1")[1]["account"]["id"]; self.term = FakeTerm()
        b = self.link(login="2")[1]["account"]["id"]; self.term = FakeTerm()
        c, o = self.link(login="3"); self.assertEqual((c, o["code"]), (503, "busy"))   # both in use: friendly busy, nothing stopped
        self.assertIn(a, self.h.live); self.assertIn(b, self.h.live)
        t[0] += 700; self.h.op("u1", b, "account")                                       # a idle 700 s, b used now
        c, o = self.link(login="3"); self.assertEqual(c, 200)
        self.assertNotIn(a, self.h.live); self.assertIn(b, self.h.live)                   # the idle one was paused, not the active one
        self.h.free_mb = lambda: 100; t[0] += 700
        self.assertEqual(self.link(login="4")[0], 200)                                    # low RAM: pauses the idlest
        t[0] += 1; self.h.cfg["evict_idle_s"] = 10 ** 6
        self.assertEqual(self.link(login="5")[1]["code"], "busy")                         # low RAM, nothing idle: busy

    def test_bad_password_backoff(self):
        t = [1000.0]; self.h.now = lambda: t[0]
        c, o = self.link(); aid = o["account"]["id"]; self.h.live.pop(aid)
        self.err = [-6, "auth"]
        for i in range(3):
            self.assertEqual(self.h.op("u1", aid, "account")[1]["code"], "needs_login")
            self.assertEqual(self.h.op("u1", aid, "account")[1]["code"], "needs_login")      # inside the back-off: broker not asked
            t[0] += 4000
        self.assertEqual(self.st.get("u1", aid)["state"], "needs_login")
        self.err = None; self.assertEqual(self.h.op("u1", aid, "account")[0], 409)          # stays stopped until re-linked

    def test_rate_limiter_bounded(self):
        now = [0.0]; rl = secure.RateLimiter(now=lambda: now[0])
        for i in range(6000): rl.hit(("u%d" % i, "op"), 5); now[0] += 0.2
        self.assertLess(len(rl.h), 5100)

    def test_server_search(self):
        self.link(); self.assertIn("Some-Live", self.h.servers("some")); self.assertEqual(self.h.servers("zzzz"), [])


class Api(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pk = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pub = cls.pk.public_key()
        cls.d = tempfile.mkdtemp()
        cls.h = hostd.Host(store.Store(cls.d + "/a"), KEY, FakeSlots(), dict(audit=cls.d + "/au", servers=cls.d + "/s"))
        cls.h._boot = lambda rec, pw, timeout=120: (FakeTerm(), None)
        ver = secure.Verifier(certs={"k1": pub.public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()})
        ver.uid = cls._uid(ver)
        from http.server import ThreadingHTTPServer
        cls.rl = secure.RateLimiter()
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), hostd.make_handler(cls.h, ver, cls.rl, "sek"))
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def _uid(cls, ver):
        def uid(tok):
            try:
                c = jwt.decode(tok, cls.pk.public_key(), algorithms=["RS256"], audience=secure.PROJECT, issuer="https://securetoken.google.com/" + secure.PROJECT)
                return c["sub"]
            except Exception: return None
        return uid

    @classmethod
    def tearDownClass(cls): cls.srv.shutdown()

    def tok(self, uid, **kw):
        c = dict(sub=uid, aud=secure.PROJECT, iss="https://securetoken.google.com/" + secure.PROJECT, exp=int(time.time()) + 600); c.update(kw)
        return jwt.encode(c, self.pk, algorithm="RS256", headers={"kid": "k1"})

    def call(self, path, body=None, tok=None, secret="sek"):
        r = urllib.request.Request("http://127.0.0.1:%d%s" % (self.port, path), data=None if body is None else json.dumps(body).encode(), method="GET" if body is None else "POST")
        if secret: r.add_header("x-mt-secret", secret)
        if tok: r.add_header("authorization", "Bearer " + tok)
        try:
            with urllib.request.urlopen(r) as x: return x.status, json.loads(x.read())
        except urllib.error.HTTPError as e: return e.code, json.loads(e.read())

    def test_auth(self):
        self.assertEqual(self.call("/health", secret=None)[0], 403)                                  # health needs the secret too
        self.assertEqual(self.call("/health")[0], 200)
        self.assertEqual(self.call("/v1/accounts", tok=self.tok("a1"), secret="sekx")[0], 403)
        self.assertEqual(self.call("/v1/accounts", tok=self.tok("a1"), secret=None)[0], 403)       # no proxy secret
        self.assertEqual(self.call("/v1/accounts", secret="sek")[0], 401)                           # no token
        self.assertEqual(self.call("/v1/accounts", tok="junk")[0], 401)
        self.assertEqual(self.call("/v1/accounts", tok=self.tok("a1", exp=1))[0], 401)             # expired
        self.assertEqual(self.call("/v1/accounts", tok=self.tok("a1", aud="other"))[0], 401)
        self.assertEqual(self.call("/v1/accounts", tok=self.tok("a1"))[0], 200)

    def test_flow_and_uid_from_token(self):
        t1, t2 = self.tok("flowu1"), self.tok("flowu2")
        c, o = self.call("/v1/link", {"login": "55", "server": "X-Live", "password": "pw1", "mode": "trading", "uid": "flowu2"}, t1); self.assertEqual(c, 200)
        aid = o["account"]["id"]
        self.assertEqual(len(self.call("/v1/accounts", tok=t1)[1]["accounts"]), 1)
        self.assertEqual(self.call("/v1/accounts", tok=t2)[1]["accounts"], [])                      # body uid ignored
        self.assertEqual(self.call("/v1/op", {"accountId": aid, "op": "positions"}, t2)[0], 404)
        self.assertEqual(self.call("/v1/op", {"accountId": aid, "op": "positions"}, t1)[0], 200)
        self.assertEqual(self.call("/v1/op", {"accountId": aid, "op": "rm -rf"}, t1)[0], 400)
        self.assertEqual(self.call("/v1/unlink", {"accountId": aid}, t2)[0], 404)
        self.assertEqual(self.call("/v1/unlink", {"accountId": aid}, t1)[0], 200)
        self.assertEqual(self.call("/v1/servers?q=x-l", tok=t1)[1]["servers"], ["X-Live"])

    def test_bad_content_length(self):
        import http.client
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        c.putrequest("POST", "/v1/op"); c.putheader("x-mt-secret", "sek"); c.putheader("authorization", "Bearer " + self.tok("cl1")); c.putheader("content-length", "-1"); c.endheaders()
        self.assertEqual(c.getresponse().status, 413)

    def test_rate_limit(self):
        t = self.tok("rlu"); codes = [self.call("/v1/link", {"login": "x", "server": "s", "password": "p"}, t)[0] for _ in range(7)]
        self.assertIn(429, codes)


if __name__ == "__main__":
    unittest.main()
