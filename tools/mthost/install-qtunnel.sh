#!/bin/bash
# TEMPORARY MT host tunnel (Owner order 24 Nov 2026): a Cloudflare QUICK tunnel (random https://*.trycloudflare.com, no DNS, no
# Cloudflare login) in front of hostd on 127.0.0.1:8787, plus the watcher that tells the site the current address.
# Usage (root, on the MT host server):
#   tools/mthost/install-qtunnel.sh            install/refresh the two services (keeps the current shared secret)
#   tools/mthost/install-qtunnel.sh --new-secret   also make NEW keys: MTHOST_SECRET (the host bearer the site sends) and
#                                              MT_PUBLISH_KEY (signs the address posts; separate so one leak is not both) into
#                                              /etc/tzmt/host.env (0600) and the GitHub repo secrets MT_HOST_SECRET / MT_PUBLISH_KEY
#                                              (stdin, never printed). deploy-site.yml copies them into Pages on the next deploy of
#                                              main (or run the "MT host secret to Pages" workflow, once it is on main).
#                                              hostd restarts with the new bearer at once: run it BEFORE the deploy, not while live.
# Later, when the token gets Zone > DNS > Edit: run mt-tunnel.yml + install-tunnel.sh (named tunnel), then
#   systemctl disable --now tzmt-qwatch tzmt-qtunnel   (the site prefers env MT_HOST_URL over the quick address).
set -euo pipefail
REPO=theelitegrey/Stryker-trading-academy-
HERE=$(cd "$(dirname "$0")" && pwd)
umask 077
install -d -m 700 /etc/tzmt; install -d -m 750 /var/log/tzmt
# /opt/tzmt/host stays 755: the per-account tzmt-N users read worker.py from it
install -d -m 755 /opt/tzmt/host; install -m 700 "$HERE/qtunnel-watch.py" /opt/tzmt/host/qtunnel-watch.py

if [ "${1:-}" = "--new-secret" ]; then
  python3 - <<'EOF'
import os, secrets
p = "/etc/tzmt/host.env"; new = {"MTHOST_SECRET": secrets.token_urlsafe(48), "MT_PUBLISH_KEY": secrets.token_urlsafe(48)}
keep = [l.rstrip("\n") for l in open(p) if l.split("=", 1)[0] not in new] if os.path.exists(p) else []
fd = os.open(p + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f: f.write("".join(l + "\n" for l in keep + [k + "=" + v for k, v in new.items()]))
os.replace(p + ".tmp", p)
EOF
  # straight from the 0600 file into gh's stdin: never on a command line, never printed
  grep '^MTHOST_SECRET=' /etc/tzmt/host.env | cut -d= -f2- | tr -d '\n' | gh secret set MT_HOST_SECRET -R "$REPO" >/dev/null
  grep '^MT_PUBLISH_KEY=' /etc/tzmt/host.env | cut -d= -f2- | tr -d '\n' | gh secret set MT_PUBLISH_KEY -R "$REPO" >/dev/null
  echo "new keys: /etc/tzmt/host.env + GitHub secrets MT_HOST_SECRET, MT_PUBLISH_KEY (values not shown)"
  systemctl restart tz-mthost-api.service
fi
chmod 600 /etc/tzmt/host.env

cat > /etc/systemd/system/tzmt-qtunnel.service <<'EOF'
[Unit]
Description=TradeZoro MT host TEMPORARY quick tunnel (https://*.trycloudflare.com -> 127.0.0.1:8787)
After=network-online.target tz-mthost-api.service
Wants=network-online.target
[Service]
ExecStart=/usr/local/bin/cloudflared tunnel --no-autoupdate --metrics 127.0.0.1:8799 --url http://127.0.0.1:8787
Restart=always
RestartSec=5
MemoryMax=300M
NoNewPrivileges=yes
StandardOutput=append:/var/log/tzmt/qtunnel.log
StandardError=append:/var/log/tzmt/qtunnel.log
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/systemd/system/tzmt-qwatch.service <<'EOF'
[Unit]
Description=TradeZoro MT host quick-tunnel watcher (publishes the address to the site, restarts a dead tunnel)
After=tzmt-qtunnel.service
Wants=tzmt-qtunnel.service
[Service]
ExecStart=/usr/bin/python3 /opt/tzmt/host/qtunnel-watch.py
Restart=always
RestartSec=10
MemoryMax=100M
StandardOutput=append:/var/log/tzmt/qwatch.log
StandardError=append:/var/log/tzmt/qwatch.log
[Install]
WantedBy=multi-user.target
EOF
# keep the tunnel log small (cloudflared appends forever)
cat > /etc/logrotate.d/tzmt-qtunnel <<'EOF'
/var/log/tzmt/qtunnel.log /var/log/tzmt/qwatch.log {
  size 5M
  rotate 2
  copytruncate
  missingok
  notifempty
}
EOF
systemctl daemon-reload
systemctl enable tzmt-qtunnel.service tzmt-qwatch.service >/dev/null 2>&1
systemctl restart tzmt-qtunnel.service tzmt-qwatch.service
echo "tzmt-qtunnel + tzmt-qwatch running; status: GET https://tradezoro.com/connect/mt/status"
