#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "=== Executing Full Stack Deployment ==="
bash deploy-db.sh
bash deploy-app.sh
echo "=== Full Stack Deployment Complete ==="
