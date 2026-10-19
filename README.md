# Microbiome Tracker

Node/Express API (`api/`, PostgreSQL) serving a React/Vite client (`client/`, built to `client/dist`).

## Hosting

Runs on CT 1302 (`10.100.20.12`) in the LTS `lts-kb` tenant, published as https://microbiome.allthatfood.net
through that tenant's Cloudflare tunnel. Infrastructure, nginx/TLS, firewall and backups are in
`lts-infrastructure` (`tenants/lts-kb`, service `microbiome`).

- App: `/var/www/microbiome-app`, systemd unit `microbiome` (`deploy/microbiome.service`), user `microbiome`,
  listening on 127.0.0.1:3001. Logs: `journalctl -u microbiome`.
- Database: PostgreSQL on localhost only, role and database `microbiome`. `DATABASE_URL` is in
  `/etc/microbiome/microbiome.env` (root only, random password), written by `deploy-db.sh`.

## Develop and deploy

```bash
./publish.sh "message"      # on the workstation: stamps the version, commits, pushes main
ssh -J lts-jump@clr1.londontechnologyservices.com root@10.100.20.12 /var/www/microbiome-app/deploy-app.sh
```

`deploy-app.sh` resets to `origin/main`, builds the client, installs the API's dependencies, installs the
unit if it changed, restarts the app and waits until `/api/public-config` answers. A new host:
`deploy-db.sh`, then `deploy-app.sh` (`deploy-both.sh` runs both).
