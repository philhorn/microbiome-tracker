#!/bin/bash
set -e
APP_DIR="/var/www/microbiome-app"

echo "Pulling latest code from GitHub..."
cd $APP_DIR
git pull origin main

echo "Rebuilding Frontend..."
cd client
npm install
npm run build
cp -r dist/* ../api/public/

echo "Restarting Backend Service..."
pm2 restart microbiome-api
echo "Update Complete!"