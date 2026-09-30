cat << 'FINAL_DEPLOY' > local_install.sh
#!/bin/bash
set -e

echo "========================================="
echo " Microbiome Tracker Deployment Installer "
echo "========================================="
read -p "Enter the domain name (e.g., tracker.dietitian.com) or type 'local' for LAN IP: " DOMAIN_NAME
if [ "$DOMAIN_NAME" != "local" ]; then
    read -p "Enter an admin email for SSL renewal notices: " ADMIN_EMAIL
    echo "CRITICAL: Ensure your DNS A-record for $DOMAIN_NAME points to this server's IP."
    read -p "Press ENTER to confirm DNS is set, or CTRL+C to abort..."
fi

echo "Installing System Dependencies..."
apt-get update
apt-get install -y curl sqlite3 nginx git python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pm2
hash -r

pm2 delete all 2>/dev/null || true
rm -rf /var/www/microbiome-app

APP_DIR="/var/www/microbiome-app"
mkdir -p $APP_DIR/api
mkdir -p $APP_DIR/client/src

# ==========================================
# BACKEND SETUP
# ==========================================
echo "Configuring Backend..."
cd $APP_DIR/api

cat << 'EOF' > package.json
{
  "name": "microbiome-api",
  "type": "module",
  "dependencies": {
    "bcrypt": "^5.1.1",
    "cors": "^2.8.5",
    "express": "^4.19.2",
    "jsonwebtoken": "^9.0.2",
    "node-cron": "^3.0.3",
    "sqlite": "^5.1.1",
    "sqlite3": "^5.1.7"
  }
}
EOF

npm install --no-fund --no-audit --loglevel=error

cat << 'EOF' > server.js
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cron from 'node-cron';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3001;
const SECRET = crypto.randomBytes(32).toString('hex');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let db;
(async () => {
    db = await open({ filename: path.join(__dirname, 'database.sqlite'), driver: sqlite3.Database });
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT DEFAULT 'user');
        CREATE TABLE IF NOT EXISTS active_week (id INTEGER PRIMARY KEY AUTOINCREMENT, week_start_date TEXT);
        CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, week_id INTEGER, food_item TEXT, FOREIGN KEY(user_id) REFERENCES users(id));
        INSERT INTO active_week (id, week_start_date) SELECT 1, date('now', 'weekday 1', '-7 days') WHERE NOT EXISTS (SELECT 1 FROM active_week WHERE id = 1);
    `);
})();

const authenticate = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    jwt.verify(token, SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ error: 'Forbidden' });
        req.userId = decoded.id; req.userRole = decoded.role; next();
    });
};

app.post('/api/register', async (req, res) => {
    const hash = await bcrypt.hash(req.body.password, 10);
    try { await db.run('INSERT INTO users (username, password) VALUES (?, ?)', [req.body.username, hash]); res.json({ success: true }); } 
    catch (e) { res.status(400).json({ error: 'Username exists' }); }
});

app.post('/api/login', async (req, res) => {
    const user = await db.get('SELECT * FROM users WHERE username = ?', [req.body.username]);
    if (user && await bcrypt.compare(req.body.password, user.password)) {
        res.json({ token: jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET), username: user.username, role: user.role });
    } else { res.status(401).json({ error: 'Invalid credentials' }); }
});

app.get('/api/checklist', authenticate, async (req, res) => {
    const activeWeek = await db.get('SELECT id FROM active_week WHERE id = (SELECT MAX(id) FROM active_week)');
    const logs = await db.all('SELECT food_item FROM logs WHERE user_id = ? AND week_id = ?', [req.userId, activeWeek.id]);
    res.json(logs.map(l => l.food_item));
});

app.post('/api/toggle', authenticate, async (req, res) => {
    const activeWeek = await db.get('SELECT id FROM active_week WHERE id = (SELECT MAX(id) FROM active_week)');
    if (req.body.checked) { await db.run('INSERT INTO logs (user_id, week_id, food_item) VALUES (?, ?, ?)', [req.userId, activeWeek.id, req.body.item]); } 
    else { await db.run('DELETE FROM logs WHERE user_id = ? AND week_id = ? AND food_item = ?', [req.userId, activeWeek.id, req.body.item]); }
    res.json({ success: true });
});

app.get('/api/admin/dashboard', authenticate, (req, res, next) => req.userRole === 'admin' ? next() : res.status(403).json({ error: 'Admin access required' }), async (req, res) => {
    const activeWeek = await db.get('SELECT id FROM active_week WHERE id = (SELECT MAX(id) FROM active_week)');
    res.json(await db.all(`SELECT u.username, COUNT(l.id) as current_score FROM users u LEFT JOIN logs l ON u.id = l.user_id AND l.week_id = ? WHERE u.role = 'user' GROUP BY u.id`, [activeWeek.id]));
});

cron.schedule('59 23 * * 0', async () => await db.run("INSERT INTO active_week (week_start_date) VALUES (date('now', 'weekday 1'))"));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`API running on port ${PORT}`));
EOF

# ==========================================
# FRONTEND SETUP
# ==========================================
echo "Building Frontend..."
cd $APP_DIR/client

cat << 'EOF' > package.json
{
  "name": "microbiome-client",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build" },
  "dependencies": { "react": "^18.2.0", "react-dom": "^18.2.0", "lucide-react": "^0.263.1" },
  "devDependencies": { "@vitejs/plugin-react": "^4.2.1", "vite": "^5.1.4" }
}
EOF

cat << 'EOF' > vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ plugins: [react()] })
EOF

cat << 'EOF' > index.html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Microbiome Tracker</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
EOF

cat << 'EOF' > src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>)
EOF

cat << 'EOF' > src/App.jsx
import React, { useState, useEffect } from 'react';
const defaultFoods = ["Artichoke", "Asparagus", "Broccoli", "Apple", "Avocado", "Blueberry", "Oats", "Quinoa", "Almonds", "Walnuts"];

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [role, setRole] = useState(localStorage.getItem('role') || 'user');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [checkedItems, setCheckedItems] = useState([]);
  const [clientScores, setClientScores] = useState([]);
  const [isLoginView, setIsLoginView] = useState(true);

  useEffect(() => {
    if (token && role === 'user') fetch('/api/checklist', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).then(d => setCheckedItems(d || []));
    if (token && role === 'admin') fetch('/api/admin/dashboard', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).then(d => setClientScores(d || []));
  }, [token, role]);

  const authSubmit = async (e) => {
    e.preventDefault();
    const res = await fetch(isLoginView ? '/api/login' : '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const data = await res.json();
    if (data.token) { localStorage.setItem('token', data.token); localStorage.setItem('role', data.role); setToken(data.token); setRole(data.role); } 
    else if (!isLoginView && data.success) { setIsLoginView(true); alert("Registered! Please log in."); } 
    else { alert(data.error); }
  };

  const handleToggle = async (item) => {
    const newState = !checkedItems.includes(item);
    setCheckedItems(prev => newState ? [...prev, item] : prev.filter(i => i !== item));
    await fetch('/api/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ item, checked: newState }) });
  };

  const logout = () => { localStorage.clear(); setToken(null); setRole('user'); };

  if (!token) return (
    <div style={{ maxWidth: '400px', margin: '50px auto', fontFamily: 'system-ui', padding: '20px' }}>
      <h2>{isLoginView ? "Login" : "Register"}</h2>
      <form onSubmit={authSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <input type="text" placeholder="Username" onChange={e => setUsername(e.target.value)} required style={{ padding: '8px' }}/>
        <input type="password" placeholder="Password" onChange={e => setPassword(e.target.value)} required style={{ padding: '8px' }}/>
        <button type="submit" style={{ padding: '10px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '4px' }}>Submit</button>
      </form>
      <p style={{ cursor: 'pointer', color: 'blue', marginTop: '10px' }} onClick={() => setIsLoginView(!isLoginView)}>{isLoginView ? "Need an account? Register" : "Have an account? Login"}</p>
    </div>
  );

  if (role === 'admin') return (
    <div style={{ fontFamily: 'system-ui', maxWidth: '800px', margin: '0 auto', padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Dietitian Dashboard</h2><button onClick={logout} style={{ padding: '6px 12px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px' }}>Logout</button>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px', textAlign: 'left' }}>
        <thead><tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}><th style={{ padding: '12px' }}>Client</th><th style={{ padding: '12px' }}>Score</th></tr></thead>
        <tbody>{clientScores.map(c => <tr key={c.username} style={{ borderBottom: '1px solid #e2e8f0' }}><td style={{ padding: '12px' }}>{c.username}</td><td style={{ padding: '12px' }}>{c.current_score} / 30</td></tr>)}</tbody>
      </table>
    </div>
  );

  return (
    <div style={{ fontFamily: 'system-ui', maxWidth: '600px', margin: '0 auto', padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>My Microbiome Tracker</h2><button onClick={logout} style={{ padding: '6px 12px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px' }}>Logout</button>
      </div>
      <div style={{ background: '#dcfce7', padding: '10px', borderRadius: '8px', marginBottom: '20px' }}><strong>Current Score: {checkedItems.length} / 30</strong></div>
      {defaultFoods.map(food => (
        <div key={food} style={{ padding: '10px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between' }}>
          <span>{food}</span><input type="checkbox" checked={checkedItems.includes(food)} onChange={() => handleToggle(food)} style={{ transform: 'scale(1.5)' }} />
        </div>
      ))}
    </div>
  );
}
EOF

npm install --no-fund --no-audit --loglevel=error
npm run build
mkdir -p ../api/public
cp -r dist/* ../api/public/

# ==========================================
# NGINX & PM2 SETUP
# ==========================================
echo "Configuring Nginx Reverse Proxy..."
SERVER_NAME=$DOMAIN_NAME
if [ "$DOMAIN_NAME" == "local" ]; then SERVER_NAME="_"; fi

cat << EOF > /etc/nginx/sites-available/microbiome
server {
    listen 80;
    server_name $SERVER_NAME;
    
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }

    location / {
        proxy_pass http://localhost:3001;
    }
}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/microbiome /etc/nginx/sites-enabled/
systemctl restart nginx

if [ "$DOMAIN_NAME" != "local" ]; then
    echo "Provisioning SSL Certificate..."
    certbot --nginx -d $DOMAIN_NAME -m$ADMIN_EMAIL --non-interactive --agree-tos --redirect
fi

echo "Starting Application Service..."
cd ../api
pm2 start server.js --name "microbiome-api"
pm2 save
pm2 startup

echo "========================================="
echo "Deployment Complete!"
echo "========================================="
FINAL_DEPLOY

chmod +x local_install.sh
./local_install.sh
