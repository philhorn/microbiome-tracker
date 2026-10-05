#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "Pulling latest code..."
git fetch origin main
git reset --hard origin/main

echo "Building frontend..."
cd client
npm ci --loglevel error
npm run build

echo "Restarting backend..."
cd ../api
npm ci --loglevel error

# Ensure .env exists for Postgres connection
if [ ! -f .env ]; then
    echo "DATABASE_URL=postgresql://postgres:admin123@127.0.0.1:5432/microbiome" > .env
fi

pm2 restart microbiome-api || pm2 start server.js --name microbiome-api
echo "✅ App deployment completed successfully!"
