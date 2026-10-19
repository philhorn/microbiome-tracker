#!/bin/bash

# 1. Calculate the new version based on current WSL time
VERSION=$(date +'%Y.%m.%d.%H.%M')

echo "Stamping build version v$VERSION..."

# 2. Write it to the tracked file
echo "export const APP_VERSION = \"$VERSION\";" > client/src/version.js

# 3. Use the first argument as the commit message, or default to a generic message
COMMIT_MSG=${1:-"Auto-bump and publish v$VERSION"}

# 4. Stage, commit, and push to GitHub
git add .
git commit -m "$COMMIT_MSG"
git push origin main

echo ""
echo "✅ v$VERSION successfully pushed to GitHub."
echo "Deploy it: ssh -J lts-jump@clr1.londontechnologyservices.com root@10.100.20.12 /var/www/microbiome-app/deploy-app.sh"
