#!/bin/bash
set -e

# Always execute from the directory the script lives in
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
pm2 restart microbiome-api

echo "Deployment completed successfully!"
