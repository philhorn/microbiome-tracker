#!/bin/bash
set -e
echo "Starting PostgreSQL Provisioning..."

# Install Postgres if not present
if ! command -v psql &> /dev/null; then
    apt-get update
    apt-get install -y postgresql postgresql-contrib
fi

# Idempotent Database & User Setup
su - postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname = 'microbiome'\" | grep -q 1 || psql -c \"CREATE DATABASE microbiome;\""
su - postgres -c "psql -c \"ALTER USER postgres WITH PASSWORD 'admin123';\""

# Enable remote connections (idempotent)
PG_CONF=$(find /etc/postgresql -name postgresql.conf | head -n 1)
PG_HBA=$(find /etc/postgresql -name pg_hba.conf | head -n 1)

sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/g" "$PG_CONF"
sed -i "s/listen_addresses = 'localhost'/listen_addresses = '*'/g" "$PG_CONF"
grep -q "0.0.0.0/0" "$PG_HBA" || echo "host    all             all             0.0.0.0/0               md5" >> "$PG_HBA"

systemctl restart postgresql
echo "✅ PostgreSQL successfully provisioned and exposed."
