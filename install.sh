#!/bin/bash
set -e
read -p "Enter the domain name (e.g., tracker.dietitian.com) or type 'local' for LAN IP: " DOMAIN_NAME
if [ "$DOMAIN_NAME" != "local" ]; then
    read -p "Enter an admin email for SSL renewal notices: " ADMIN_EMAIL
fi

echo "Installing Dependencies..."
apt-get update && apt-get install -y curl sqlite3 nginx git python3-certbot-nginx openssl
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pm2

rm -rf /var/www/microbiome-app
git clone https://github.com/philhorn/microbiome-tracker.git /var/www/microbiome-app

echo "Building Stack..."
cd /var/www/microbiome-app/api
npm install
cd ../client
npm install
npm run build
mkdir -p ../api/public
cp -r dist/* ../api/public/

echo "Configuring SSL and Nginx Baseline..."
mkdir -p /etc/ssl/private /etc/ssl/certs
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/ssl/private/nginx-selfsigned.key \
    -out /etc/ssl/certs/nginx-selfsigned.crt \
    -subj "/CN=${DOMAIN_NAME:-localhost}" 2>/dev/null

SERVER_NAME=$DOMAIN_NAME
if [ "$DOMAIN_NAME" == "local" ]; then SERVER_NAME="_"; fi

cat << 'EOF' > /etc/nginx/sites-available/microbiome
server {
    listen 80 default_server;
    server_name SERVER_NAME_PLACEHOLDER;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl default_server;
    server_name SERVER_NAME_PLACEHOLDER;

    ssl_certificate /etc/ssl/certs/nginx-selfsigned.crt;
    ssl_certificate_key /etc/ssl/private/nginx-selfsigned.key;

    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location / {
        proxy_pass http://localhost:3001;
    }
}
EOF
sed -i "s/SERVER_NAME_PLACEHOLDER/$SERVER_NAME/g" /etc/nginx/sites-available/microbiome

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/microbiome /etc/nginx/sites-enabled/
systemctl restart nginx

if [ "$DOMAIN_NAME" != "local" ]; then
    echo "Attempting to provision Let's Encrypt SSL Certificate via Certbot..."
    certbot --nginx -d "$DOMAIN_NAME" -m "$ADMIN_EMAIL" --non-interactive --agree-tos --keep-until-expiring || echo "Certbot skipped/failed. Retaining self-signed baseline."
fi

echo "Starting Application Service..."
cd /var/www/microbiome-app/api
pm2 start server.js --name "microbiome-api"
pm2 save
pm2 startup

echo "Deployment Complete!"