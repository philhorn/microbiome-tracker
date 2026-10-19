#!/bin/bash
# Deploys origin/main: builds the client, installs the API's dependencies and
# restarts the API.
#   systemd hosts (set up by deploy-db.sh): the microbiome unit, from
#     deploy/microbiome.service, as the microbiome user with DATABASE_URL from
#     /etc/microbiome/microbiome.env
#   otherwise (legacy pm2 hosts): pm2 restart microbiome-api
set -euo pipefail
cd "$(dirname "$0")"

# git reset rewrites this file while bash is reading it, so run the new copy.
if [ -z "${MICROBIOME_DEPLOY_REEXEC:-}" ]; then
    echo "Pulling latest code..."
    git fetch origin main
    git reset --hard origin/main
    MICROBIOME_DEPLOY_REEXEC=1 exec bash "$0" "$@"
fi

echo "Building frontend..."
(cd client && npm ci --loglevel error && npm run build)

echo "Installing backend dependencies..."
(cd api && npm ci --loglevel error)

healthy() { node -e 'fetch("http://127.0.0.1:3001/api/public-config").then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))'; }

if [ -f /etc/microbiome/microbiome.env ] && command -v systemctl >/dev/null; then
    id microbiome >/dev/null 2>&1 || useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin microbiome
    if ! cmp -s deploy/microbiome.service /etc/systemd/system/microbiome.service; then
        install -m 644 deploy/microbiome.service /etc/systemd/system/microbiome.service
        systemctl daemon-reload
        systemctl enable microbiome
    fi
    echo "Restarting backend (systemd)..."
    systemctl restart microbiome
    for _ in $(seq 1 30); do healthy && break; sleep 1; done
    healthy || { journalctl -u microbiome -n 30 --no-pager >&2; echo "microbiome did not come up" >&2; exit 1; }
else
    echo "Restarting backend (pm2)..."
    pm2 set pm2:timestamp "YYYY-MM-DD HH:mm:ss" || true
    (cd api && { pm2 restart microbiome-api || pm2 start server.js --name microbiome-api; })
fi
echo "✅ App deployment completed successfully!"
