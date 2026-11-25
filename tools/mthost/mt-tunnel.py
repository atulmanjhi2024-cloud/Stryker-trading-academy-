#!/usr/bin/env python3
"""One-time MT host tunnel setup, run by .github/workflows/mt-tunnel.yml on GitHub (never on a member's machine).
Cloudflare API only (stdlib, no cloudflared login). Prints NO secret: the tunnel token and the new shared secret leave this job
only sealed with tools/mthost/deliver.pub.pem (RSA-OAEP key wrap + AES-256-CBC + HMAC-SHA256), opened on our server by
tools/mthost/install-tunnel.sh. Exit 2 with 'MISSING PERMISSION: ...' when the API token cannot do a step."""
import base64, json, os, re, secrets, subprocess, sys, tarfile, urllib.error, urllib.request

API = "https://api.cloudflare.com/client/v4"
NAME, SUB, PORT = "tzmt-host", "mt-host", 8787
ZONES = ("tradezoro.com", "strykertrading.com")
OUT = "/tmp/mtdeliver"
PUB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "deliver.pub.pem")


def mask(v):
    if v: print("::add-mask::" + v, flush=True)


def clean(v, pat):
    m = re.findall(pat, v or "")
    return m[-1] if m else (v or "").strip()


TOKEN = clean(os.environ.get("CLOUDFLARE_API_TOKEN"), r"[A-Za-z0-9_-]{35,}"); mask(TOKEN)
ACCT = clean(os.environ.get("CLOUDFLARE_ACCOUNT_ID"), r"[0-9a-f]{32}"); mask(ACCT)


def api(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={"authorization": "Bearer " + TOKEN, "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return json.loads(r.read())
    except urllib.error.HTTPError as e:
        try: return json.loads(e.read())
        except ValueError: return {"success": False, "errors": [{"code": e.code, "message": "http %d" % e.code}]}


def need(r, what, perm):
    if r.get("success"): return r["result"]
    codes = ",".join(str(e.get("code")) for e in r.get("errors") or [])
    msgs = "; ".join(str(e.get("message"))[:120] for e in r.get("errors") or [])
    auth = any(str(e.get("code")) in ("10000", "9109", "10001", "7003", "9106") or "auth" in str(e.get("message", "")).lower() for e in r.get("errors") or [])
    print(("MISSING PERMISSION: %s (step: %s; cloudflare %s: %s)" % (perm, what, codes, msgs)) if auth else ("FAILED: %s (cloudflare %s: %s)" % (what, codes, msgs)), flush=True)
    sys.exit(2 if auth else 1)


def main():
    global ACCT
    if not TOKEN: print("FAILED: CLOUDFLARE_API_TOKEN secret missing"); sys.exit(1)
    if not re.fullmatch(r"[0-9a-f]{32}", ACCT or ""):   # same fallback as deploy-site.yml: the account that owns a Pages project
        accts = need(api("GET", "/accounts?per_page=25"), "list accounts", "Account > Account Settings > Read")
        ACCT = next((a["id"] for a in accts if api("GET", "/accounts/%s/pages/projects" % a["id"]).get("result")), "")
        mask(ACCT)
        if not ACCT: print("FAILED: no Cloudflare account with a Pages project visible to the token"); sys.exit(1)
    # Pages project (same pick as deploy-site.yml)
    projs = need(api("GET", "/accounts/%s/pages/projects" % ACCT), "list Pages projects", "Account > Cloudflare Pages > Edit")
    proj = next((p["name"] for p in projs if any(re.search("strykertrading|tradezoro", d, re.I) for d in p.get("domains") or []) or re.search("stryker", p["name"], re.I)), None)
    if not proj: print("FAILED: no Pages project"); sys.exit(1)
    print("Pages project:", proj)
    # Zone for the fixed hostname
    zone = None
    for z in ZONES:
        r = api("GET", "/zones?name=%s&per_page=1" % z)
        if r.get("success") and r.get("result"): zone = r["result"][0]; break
    if not zone:
        r = api("GET", "/zones?name=%s&per_page=1" % ZONES[0]); need(r, "read DNS zone", "Zone > Zone > Read (tradezoro.com)")
        print("MISSING PERMISSION: Zone > DNS > Edit on tradezoro.com (zone not visible to this token)"); sys.exit(2)
    host = "%s.%s" % (SUB, zone["name"]); print("Hostname:", host)
    # Preflight (read-only, changes nothing): list every missing permission at once, before any write.
    miss = []
    if not api("GET", "/accounts/%s/cfd_tunnel?per_page=1" % ACCT).get("success"): miss.append("Account > Cloudflare Tunnel > Read")
    if not api("GET", "/zones/%s/dns_records?per_page=1" % zone["id"]).get("success"): miss.append("Zone > DNS > Read/Edit (%s)" % zone["name"])
    if os.environ.get("MT_PREFLIGHT_ONLY") or miss:
        print("Preflight: Pages OK, zone visible OK" + ("; MISSING: " + ", ".join(miss) if miss else "; tunnel read OK, DNS read OK"))
        if miss: sys.exit(2)
    # Tunnel (reuse if it exists; remote-managed config)
    ts = need(api("GET", "/accounts/%s/cfd_tunnel?name=%s&is_deleted=false" % (ACCT, NAME)), "list tunnels", "Account > Cloudflare Tunnel > Edit")
    if ts: tid = ts[0]["id"]; print("Tunnel exists, reusing")
    else:
        t = need(api("POST", "/accounts/%s/cfd_tunnel" % ACCT, {"name": NAME, "config_src": "cloudflare", "tunnel_secret": base64.b64encode(secrets.token_bytes(32)).decode()}), "create tunnel", "Account > Cloudflare Tunnel > Edit")
        tid = t["id"]; print("Tunnel created")
    need(api("PUT", "/accounts/%s/cfd_tunnel/%s/configurations" % (ACCT, tid), {"config": {"ingress": [
        {"hostname": host, "service": "http://127.0.0.1:%d" % PORT, "originRequest": {"connectTimeout": 10, "noTLSVerify": False}},
        {"service": "http_status:404"}]}}), "set tunnel routes", "Account > Cloudflare Tunnel > Edit")
    ttok = need(api("GET", "/accounts/%s/cfd_tunnel/%s/token" % (ACCT, tid)), "read tunnel token", "Account > Cloudflare Tunnel > Read"); mask(ttok)
    # DNS: proxied CNAME -> <id>.cfargotunnel.com
    target = tid + ".cfargotunnel.com"
    ex = need(api("GET", "/zones/%s/dns_records?name=%s" % (zone["id"], host)), "read DNS", "Zone > DNS > Edit (%s)" % zone["name"])
    rec = {"type": "CNAME", "name": host, "content": target, "proxied": True, "ttl": 1, "comment": "TradeZoro MT host tunnel"}
    if ex: need(api("PUT", "/zones/%s/dns_records/%s" % (zone["id"], ex[0]["id"]), rec), "update DNS", "Zone > DNS > Edit (%s)" % zone["name"])
    else: need(api("POST", "/zones/%s/dns_records" % zone["id"], rec), "create DNS", "Zone > DNS > Edit (%s)" % zone["name"])
    print("DNS ok")
    # New shared secret -> Pages (production + preview), never printed
    sec = secrets.token_urlsafe(48); mask(sec)
    # wrangler (as deploy-site.yml does): sets one secret at a time, never touches the other Pages secrets
    for n, v in (("MT_HOST_URL", "https://" + host), ("MT_HOST_SECRET", sec)):
        r = subprocess.run(["npx", "--yes", "wrangler@4.138.0", "pages", "secret", "put", n, "--project-name", proj], input=v, text=True, capture_output=True,
                           env=dict(os.environ, CLOUDFLARE_API_TOKEN=TOKEN, CLOUDFLARE_ACCOUNT_ID=ACCT))
        if r.returncode: print("FAILED: set Pages secret %s (wrangler exit %d)" % (n, r.returncode)); sys.exit(1)
    print("Pages env set: MT_HOST_URL, MT_HOST_SECRET (applies from the next deploy)")
    seal(json.dumps({"tunnel_token": ttok, "secret": sec, "url": "https://" + host, "tunnel": tid}))
    print("Sealed delivery written")


def seal(payload):
    """RSA-OAEP(SHA-256) wraps 64 random bytes: 32 AES key + 32 HMAC key. Payload: AES-256-CBC, then HMAC-SHA256 over iv+ct."""
    os.makedirs(OUT, mode=0o700, exist_ok=True)
    k = secrets.token_bytes(64); iv = secrets.token_bytes(16)
    kp = os.path.join(OUT, "k.bin")
    fd = os.open(kp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600); os.write(fd, k); os.close(fd)
    subprocess.run(["openssl", "pkeyutl", "-encrypt", "-pubin", "-inkey", PUB, "-pkeyopt", "rsa_padding_mode:oaep", "-pkeyopt", "rsa_oaep_md:sha256",
                    "-pkeyopt", "rsa_mgf1_md:sha256", "-in", kp, "-out", os.path.join(OUT, "key.enc")], check=True)
    ct = subprocess.run(["openssl", "enc", "-aes-256-cbc", "-K", k[:32].hex(), "-iv", iv.hex()], input=payload.encode(), capture_output=True, check=True).stdout
    import hmac, hashlib
    open(os.path.join(OUT, "data.enc"), "wb").write(iv + ct + hmac.new(k[32:], iv + ct, hashlib.sha256).digest())
    os.remove(kp)
    with tarfile.open(os.path.join(OUT, "sealed.tar"), "w") as t:
        for n in ("key.enc", "data.enc"): t.add(os.path.join(OUT, n), arcname=n)


if __name__ == "__main__":
    main()
