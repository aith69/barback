#!/bin/sh
# Installs Barback as a systemd service that starts at boot and restarts on failure.
# Run it as root, after "npm install" and after creating config.local.json:
#   sh deploy/install-service.sh
set -e

[ "$(id -u)" = 0 ] || { echo "Run this as root."; exit 1; }
APP_DIR=$(cd "$(dirname "$0")/.." && pwd)
NODE=$(command -v node) || { echo "node not found in PATH."; exit 1; }
[ -d "$APP_DIR/node_modules" ] || { echo "Run 'npm install' in $APP_DIR first."; exit 1; }

cat > /etc/systemd/system/barback.service << UNIT
[Unit]
Description=Barback order management
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$NODE server/index.js
Restart=on-failure
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now barback
echo
echo "Barback is running. Logs: journalctl -u barback -f"
systemctl --no-pager --lines=0 status barback || true
