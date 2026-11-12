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
- Sessions: JWTs signed with `JWT_SECRET` from the same env file (generated once by `deploy-app.sh`, never
  printed), valid 30 days.

## Access rules

- Each group has managers (`group_members.is_manager`): whoever created it. Joining with the group PIN or
  being added makes you a member only. Group settings, members, accounts and other people's ticks need a
  parent who manages that group, or an admin; dietitians may edit the food list of groups they belong to.
- Anyone can tick their own column and leave a group. `/api/lists` returns the global templates and the
  caller's groups' lists only. Renaming or deleting a food rewrites only that list's logs.
- `POST /api/user/upgrade` turns a plain user into a parent: it gives control of their own groups, nothing more.
- Admin accounts sign in with an authenticator-app code after their password. An admin without one is shown a
  new key at sign-in and confirms it with a first code. From the server's shell, `node admin-totp.js <user>`
  (in `api/`, with the env file loaded) sets a new key and prints only the key; `--reset` removes it.
- Rate limits (per visitor address, from `CF-Connecting-IP`): login 20 failures / 15 min (plus the per-account
  lockout), registration 10 / hour, group PINs and personal PINs 30 / 15 min per address and 10 per account,
  at most 20 users per bulk add. CORS allows only https://microbiome.allthatfood.net.
- There is no deploy webhook: deploys are run on the container (below).

## Tests

```bash
cd api && TEST_DATABASE_URL=postgresql://user:pw@127.0.0.1:5432/throwaway npm test   # creates test-audit-* users
```

## Develop and deploy

```bash
./publish.sh "message"      # on the workstation: stamps the version, commits, pushes main
ssh -J lts-jump@clr1.londontechnologyservices.com root@10.100.20.12 /var/www/microbiome-app/deploy-app.sh
```

`deploy-app.sh` resets to `origin/main`, builds the client, installs the API's dependencies, installs the
unit if it changed, restarts the app and waits until `/api/public-config` answers. A new host:
`deploy-db.sh`, then `deploy-app.sh` (`deploy-both.sh` runs both).
