#!/bin/bash
# Server side of .github/workflows/mt-tunnel.yml: fetch the sealed artifact of a run, open it with /etc/tzmt/deliver.key (root only),
# put the shared secret into /etc/tzmt/host.env, the tunnel token into /etc/tzmt/tunnel.env, and run cloudflared as tzmt-tunnel.service.
# Usage (root): tools/mthost/install-tunnel.sh <run-id>. Prints no secret.
set -euo pipefail
RUN="${1:?run id}"; REPO=theelitegrey/Stryker-trading-academy-
umask 077
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
gh run download "$RUN" -R "$REPO" -n mt-tunnel-sealed -D "$W" >/dev/null
tar -xf "$W/sealed.tar" -C "$W"
openssl pkeyutl -decrypt -inkey /etc/tzmt/deliver.key -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -pkeyopt rsa_mgf1_md:sha256 -in "$W/key.enc" -out "$W/k.bin"
python3 - "$W" <<'EOF'
import hmac, hashlib, json, os, subprocess, sys
w = sys.argv[1]; k = open(w + "/k.bin", "rb").read(); d = open(w + "/data.enc", "rb").read()
iv, ct, tag = d[:16], d[16:-32], d[-32:]
if not hmac.compare_digest(hmac.new(k[32:], iv + ct, hashlib.sha256).digest(), tag): sys.exit("sealed file failed its integrity check")
p = json.loads(subprocess.run(["openssl", "enc", "-d", "-aes-256-cbc", "-K", k[:32].hex(), "-iv", iv.hex()], input=ct, capture_output=True, check=True).stdout)
def write(path, lines):
    fd = os.open(path + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f: f.write("".join(l + "\n" for l in lines))
    os.replace(path + ".tmp", path)
keep = [l.rstrip("\n") for l in open("/etc/tzmt/host.env") if not l.startswith("MTHOST_SECRET=")]
write("/etc/tzmt/host.env", keep + ["MTHOST_SECRET=" + p["secret"]])
write("/etc/tzmt/tunnel.env", ["TUNNEL_TOKEN=" + p["tunnel_token"]])
print("url", p["url"])
EOF
cat > /etc/systemd/system/tzmt-tunnel.service <<'EOF'
[Unit]
Description=TradeZoro MT host tunnel (Cloudflare named tunnel tzmt-host -> 127.0.0.1:8787)
After=network-online.target tz-mthost-api.service
Wants=network-online.target
[Service]
EnvironmentFile=/etc/tzmt/tunnel.env
ExecStart=/usr/local/bin/cloudflared tunnel --no-autoupdate --metrics 127.0.0.1:0 run
Restart=always
RestartSec=5
MemoryMax=300M
NoNewPrivileges=yes
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now tzmt-tunnel.service >/dev/null
systemctl restart tz-mthost-api.service tzmt-tunnel.service
echo "tzmt-tunnel + tz-mthost-api restarted"
