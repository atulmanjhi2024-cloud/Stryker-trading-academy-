#!/usr/bin/env python3
"""MT host quick-tunnel watcher (Owner order 24 Nov 2026: MT5 cloud sign-in on NOW through a TEMPORARY Cloudflare quick tunnel).

Runs as systemd service tzmt-qwatch next to tzmt-qtunnel (cloudflared tunnel --url http://127.0.0.1:8787). Every 20 s it:
  1. reads the current https://<random>.trycloudflare.com address (cloudflared metrics /quicktunnel, else the newest one in the log),
  2. checks the address really reaches OUR host daemon: GET <url>/health?n=<random> WITHOUT the secret; hostd answers 403 with a
     proof = HMAC(key derived from MTHOST_SECRET, nonce|host) that only it can make (a fake local server or a relay cannot),
  3. reads the host's own status on 127.0.0.1 (terminals running / max),
  4. posts {url, status} to https://tradezoro.com/connect/mt/hosturl, HMAC-SHA256 signed with MT_PUBLISH_KEY (a separate key; never
     sent), on every address change, on host up/down, and every 5 minutes as a heartbeat (the site drops an address after 15 min),
  5. self-check: if the address stops answering for 2 minutes, restarts tzmt-qtunnel (cloudflared then gets a NEW address,
     which step 4 publishes within ~20 s; the site re-reads it within 60 s).
Writes /run/tzmt/qtunnel.json (root only) for a local look. Prints and logs NO secret and NO address beyond the root-only log.
"""
import hashlib, hmac, json, os, re, secrets as pysecrets, subprocess, sys, time, urllib.error, urllib.request

ENV = os.environ.get("MTQ_ENV", "/etc/tzmt/host.env")
LOG = os.environ.get("MTQ_LOG", "/var/log/tzmt/qtunnel.log")
METRICS = os.environ.get("MTQ_METRICS", "http://127.0.0.1:8799")
LOCAL = os.environ.get("MTQ_LOCAL", "http://127.0.0.1:8787")
SITE = os.environ.get("MTQ_SITE", "https://tradezoro.com/connect/mt/hosturl")
UNIT = os.environ.get("MTQ_UNIT", "tzmt-qtunnel.service")
STATE = os.environ.get("MTQ_STATE", "/run/tzmt/qtunnel.json")
TICK, HEARTBEAT, DEAD_AFTER, BOOT_GRACE = 20, 300, 120, 90
QUICK = re.compile(r"https://[a-z0-9-]{3,80}\.trycloudflare\.com")
UA = "tzmt-qwatch/1"


def say(*a):
    print(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), *a, flush=True)


def secret(name="MTHOST_SECRET"):
    for line in open(ENV):
        if line.startswith(name + "="): return line.split("=", 1)[1].strip().strip("'\"")
    return ""


def get(url, headers=None, timeout=8):
    req = urllib.request.Request(url, headers=dict({"user-agent": UA}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read(65536)
    except urllib.error.HTTPError as e:
        return e.code, e.read(65536)
    except Exception:
        return 0, b""


def current_url():
    c, b = get(METRICS + "/quicktunnel", timeout=3)
    if c == 200:
        try:
            h = json.loads(b).get("hostname") or ""
            if h and QUICK.fullmatch("https://" + h): return "https://" + h
        except ValueError: pass
    try:   # fallback: the newest address cloudflared wrote to its log (last 64 KB)
        with open(LOG, "rb") as f:
            f.seek(max(0, os.path.getsize(LOG) - 65536)); found = QUICK.findall(f.read().decode("utf-8", "replace"))
        return found[-1] if found else ""
    except OSError:
        return ""


def proof(sec, nonce, host):
    k = hmac.new(sec.encode(), b"tzmt-health-proof-v1", hashlib.sha256).digest()
    return hmac.new(k, (nonce + "|" + host.lower()).encode(), hashlib.sha256).hexdigest()


def answers(url, sec):
    """True only when <url> reaches OUR hostd (challenge: it must return the proof for a fresh nonce and this host name)."""
    if not url: return False
    n = pysecrets.token_hex(16); c, b = get(url + "/health?n=" + n)
    try: got = json.loads(b).get("proof", "") if c == 403 else ""
    except ValueError: return False
    return bool(got) and hmac.compare_digest(got, proof(sec, n, url.split("://", 1)[1]))


def local_health(sec):
    c, b = get(LOCAL + "/health", {"x-mt-secret": sec}, timeout=5)
    try: return json.loads(b) if c == 200 else None
    except ValueError: return None


def sign(sec, ts, body):
    return hmac.new(sec.encode(), (ts + "." + body).encode(), hashlib.sha256).hexdigest()


def publish(sec, url, status):
    body = json.dumps({"url": url, "status": status}, separators=(",", ":")); ts = str(int(time.time()))
    req = urllib.request.Request(SITE, data=body.encode(), method="POST", headers={"content-type": "application/json", "user-agent": UA, "x-mt-ts": ts, "x-mt-sig": sign(sec, ts, body)})
    try:
        with urllib.request.urlopen(req, timeout=15) as r: return r.status == 200
    except urllib.error.HTTPError as e:
        say("publish refused, http", e.code); return False
    except Exception as e:
        say("publish failed:", type(e).__name__); return False


def write_state(o):
    try:
        os.makedirs(os.path.dirname(STATE), mode=0o700, exist_ok=True)
        fd = os.open(STATE + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f: json.dump(o, f)
        os.replace(STATE + ".tmp", STATE)
    except OSError: pass


def main():
    sec, pub = secret(), secret("MT_PUBLISH_KEY")
    if len(sec) < 32 or len(pub) < 32: sys.exit("MTHOST_SECRET / MT_PUBLISH_KEY missing or too short in " + ENV)
    last_url, url_since, last_pub, bad_since, restarts, started, last_host = "", 0, 0.0, None, 0, time.time(), None
    while True:
        now = time.time(); url = current_url(); ok = answers(url, sec); h = local_health(sec)
        if url != last_url:
            say("tunnel address changed" if last_url else "tunnel address found"); last_url, url_since, last_pub = url, int(now), 0.0
        if ok: bad_since = None
        elif bad_since is None: bad_since = now
        # self-check: the address has not answered for 2 minutes (and the tunnel has had time to start) -> restart cloudflared
        if bad_since is not None and now - bad_since >= DEAD_AFTER and now - started >= BOOT_GRACE:
            say("tunnel not answering for %ds, restarting %s" % (int(now - bad_since), UNIT))
            subprocess.run(["systemctl", "restart", UNIT], check=False); restarts += 1; bad_since, started = None, now
        status = {"tunnel": ok, "urlSince": url_since, "hostOk": bool(h and h.get("ok")), "live": int((h or {}).get("live") or 0), "max": int((h or {}).get("max") or 0), "restarts": restarts}
        if status["hostOk"] != last_host: last_host, last_pub = status["hostOk"], 0.0   # host went up/down: tell the site now
        if ok and (last_pub == 0.0 or now - last_pub >= HEARTBEAT):
            if publish(pub, url, status): last_pub = now; say("published", "(tunnel up, host %s, %d/%d terminals)" % ("ok" if status["hostOk"] else "DOWN", status["live"], status["max"]))
        write_state(dict(status, published=int(last_pub), checkedAt=int(now)))
        time.sleep(TICK)


if __name__ == "__main__":
    main()
