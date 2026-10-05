#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "Pulling latest code..."
git fetch origin main
git reset --hard origin/main

echo "Configuring PM2 logging..."
pm2 set pm2:timestamp "YYYY-MM-DD HH:mm:ss" || true

echo "Building frontend..."
cd client
npm ci --loglevel error
npm run build

echo "Restarting backend..."
cd ../api
npm ci --loglevel error

if [ ! -f .env ]; then
    echo "DATABASE_URL=postgresql://postgres:admin123@127.0.0.1:5432/microbiome" > .env
fi

pm2 restart microbiome-api || pm2 start server.js --name microbiome-api
echo "✅ App deployment completed successfully!"
