"""Quick-tunnel watcher (tools/mthost/qtunnel-watch.py): address discovery, the "is it really our host" check, signing.
Run: python3 -m unittest tests/mthost/test_qtunnel.py   (no network: local stub servers only)"""
import importlib.util, json, os, subprocess, sys, tempfile, threading, unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
spec = importlib.util.spec_from_file_location("qw", os.path.join(ROOT, "tools/mthost/qtunnel-watch.py")); qw = importlib.util.module_from_spec(spec); spec.loader.exec_module(qw)


def serve(handler):
    s = ThreadingHTTPServer(("127.0.0.1", 0), handler); threading.Thread(target=s.serve_forever, daemon=True).start(); return s


class T(unittest.TestCase):
    def test_url_from_metrics_then_log(self):
        class M(BaseHTTPRequestHandler):
            def log_message(self, *a): pass
            def do_GET(self):
                b = json.dumps({"hostname": "red-blue-green.trycloudflare.com"}).encode(); self.send_response(200); self.end_headers(); self.wfile.write(b)
        s = serve(M); qw.METRICS = "http://127.0.0.1:%d" % s.server_port
        self.assertEqual(qw.current_url(), "https://red-blue-green.trycloudflare.com"); s.shutdown()
        with tempfile.NamedTemporaryFile("w", delete=False) as f:
            f.write("INF | https://old-one.trycloudflare.com |\nINF | https://new-two.trycloudflare.com |\nhttps://evil.example.com\n")
        qw.METRICS, qw.LOG = "http://127.0.0.1:1", f.name
        self.assertEqual(qw.current_url(), "https://new-two.trycloudflare.com"); os.unlink(f.name)
        qw.LOG = "/nonexistent"; self.assertEqual(qw.current_url(), "")

    def test_answers_only_our_hostd(self):
        """the real hostd handler: the proof matches only with the right secret; a look-alike 403 fails"""
        sys.path.insert(0, os.path.join(ROOT, "tools/mthost"))
        import hostd
        from secure import RateLimiter
        sec = "q" * 48
        s = ThreadingHTTPServer(("127.0.0.1", 0), hostd.make_handler(None, None, RateLimiter(), sec)); threading.Thread(target=s.serve_forever, daemon=True).start()
        u = "http://127.0.0.1:%d" % s.server_port
        self.assertTrue(qw.answers(u, sec)); self.assertFalse(qw.answers(u, "w" * 48))
        for _ in range(12): self.assertEqual(qw.get(u + "/health", {"x-mt-secret": "bad"})[0] in (403, 429), True)
        self.assertEqual(qw.get(u + "/health", {"x-mt-secret": "bad"})[0], 429, "wrong secret throttled")
        for _ in range(15): self.assertTrue(qw.answers(u, sec), "proof checks never throttled")
        s.shutdown()
        class Fake(BaseHTTPRequestHandler):
            def log_message(self, *a): pass
            def do_GET(self):
                self.send_response(403); self.end_headers(); self.wfile.write(b'{"error":"Forbidden","code":"forbidden","proof":"' + b"a" * 64 + b'"}')
        f = serve(Fake); self.assertFalse(qw.answers("http://127.0.0.1:%d" % f.server_port, sec)); f.shutdown()
        self.assertFalse(qw.answers("", sec))

    def test_signature_matches_the_pages_function(self):
        sec, ts, body = "k" * 48, "1764000000", '{"url":"https://a-b.trycloudflare.com"}'
        js = ("import { signHost } from '%s/functions/connect/mt/[op].js'; console.log(await signHost(%s, %s, %s));"
              % (ROOT, json.dumps(sec), json.dumps(ts), json.dumps(body)))
        out = subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(out.stdout.strip(), qw.sign(sec, ts, body), out.stderr)

    def test_publish_sends_signature_not_secret(self):
        got = {}
        class P(BaseHTTPRequestHandler):
            def log_message(self, *a): pass
            def do_POST(self):
                n = int(self.headers["content-length"]); got["body"] = self.rfile.read(n).decode(); got["h"] = {k.lower(): v for k, v in self.headers.items()}
                self.send_response(200); self.end_headers(); self.wfile.write(b'{"ok":true}')
        s = serve(P); qw.SITE = "http://127.0.0.1:%d/connect/mt/hosturl" % s.server_port
        sec = "z" * 48
        self.assertTrue(qw.publish(sec, "https://a-b.trycloudflare.com", {"tunnel": True}))
        self.assertNotIn(sec, got["body"] + json.dumps(got["h"]))
        self.assertEqual(got["h"]["x-mt-sig"], qw.sign(sec, got["h"]["x-mt-ts"], got["body"])); s.shutdown()

    def test_host_gate_files(self):
        sys.path.insert(0, os.path.join(ROOT, "tools/mthost"))
        import hostd
        d = tempfile.mkdtemp(); hostd.GATE.update(off=d + "/off", allow=d + "/allow.json")
        self.assertIsNone(hostd.gate("u1", "/v1/op"))
        json.dump({"uids": ["u1"]}, open(d + "/allow.json", "w"))
        self.assertIsNone(hostd.gate("u1", "/v1/op")); self.assertEqual(hostd.gate("u2", "/v1/op")["code"], "not_open")
        open(d + "/off", "w").close(); self.assertEqual(hostd.gate("u1", "/v1/op")["code"], "paused")


if __name__ == "__main__":
    unittest.main()
