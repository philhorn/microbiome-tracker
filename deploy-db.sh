#!/bin/bash
# Provisions the app's PostgreSQL database on this host, reachable from localhost only:
#   - listen_addresses = 'localhost', and no pg_hba rule for remote hosts
#   - role "microbiome" with a random password, owning database "microbiome"
#   - DATABASE_URL in /etc/microbiome/microbiome.env (mode 600, root only), which the
#     systemd unit reads (deploy/microbiome.service)
# Safe to re-run: the password in an existing env file is kept and re-applied.
set -euo pipefail
echo "Starting PostgreSQL Provisioning..."

ENV_FILE=/etc/microbiome/microbiome.env

if ! command -v psql >/dev/null; then
    apt-get update
    apt-get install -y postgresql
fi

PG_CONF=$(find /etc/postgresql -name postgresql.conf | sort -V | tail -n 1)
PG_HBA="$(dirname "$PG_CONF")/pg_hba.conf"
sed -i -E "s/^#?[[:space:]]*listen_addresses[[:space:]]*=.*/listen_addresses = 'localhost'/" "$PG_CONF"
sed -i -E '/^host[[:space:]]+all[[:space:]]+all[[:space:]]+0\.0\.0\.0\/0/d' "$PG_HBA"
systemctl restart postgresql

pw=
[ -f "$ENV_FILE" ] && pw=$(sed -n 's#^DATABASE_URL=postgresql://microbiome:\([0-9a-f]*\)@.*#\1#p' "$ENV_FILE")
[ -n "$pw" ] || pw=$(openssl rand -hex 24) # hex needs no escaping in a URL or SQL

install -d -m 750 /etc/microbiome
(umask 077 && printf 'DATABASE_URL=postgresql://microbiome:%s@127.0.0.1:5432/microbiome\n' "$pw" > "$ENV_FILE.new")
mv -f "$ENV_FILE.new" "$ENV_FILE"

# On stdin, so the password is never on a command line.
su - postgres -c "psql -q -v ON_ERROR_STOP=1" <<SQL
SELECT 'CREATE ROLE microbiome LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'microbiome') \gexec
ALTER ROLE microbiome WITH LOGIN PASSWORD '$pw';
SELECT 'CREATE DATABASE microbiome OWNER microbiome' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'microbiome') \gexec
ALTER DATABASE microbiome OWNER TO microbiome;
\c microbiome
ALTER SCHEMA public OWNER TO microbiome;
ALTER TABLE IF EXISTS groups ADD COLUMN IF NOT EXISTS logo_url TEXT;
SQL

echo "✅ PostgreSQL provisioned on localhost; DATABASE_URL is in $ENV_FILE."
