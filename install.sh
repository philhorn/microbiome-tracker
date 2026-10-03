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
apt-get install -y curl sqlite3 nginx git python3-certbot-nginx openssl
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
        CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT DEFAULT 'user', family_id INTEGER, display_name TEXT, link_code TEXT, sort_order INTEGER DEFAULT 0);
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
    const rawUsername = req.body.username;
    if (!rawUsername) return res.status(400).json({ error: 'Username required' });
    const lowerUsername = rawUsername.toLowerCase();
    const displayName = req.body.displayName || rawUsername;
    const hash = await bcrypt.hash(req.body.password, 10);
    const role = req.body.isParent ? 'parent' : 'user';
    const linkCode = crypto.randomInt(100000, 1000000).toString();
    
    const existing = await db.get('SELECT id FROM users WHERE LOWER(username) = ?', [lowerUsername]);
    if (existing) return res.status(400).json({ error: 'Username already exists' });

    try { 
        const result = await db.run('INSERT INTO users (username, password, role, display_name, link_code) VALUES (?, ?, ?, ?, ?)', [lowerUsername, hash, role, displayName, linkCode]); 
        await db.run('UPDATE users SET family_id = ? WHERE id = ?', [result.lastID, result.lastID]);
        res.json({ success: true }); 
    } catch (e) { res.status(400).json({ error: 'Username already exists' }); }
});

app.post('/api/login', async (req, res) => {
    if (!req.body.username) return res.status(400).json({ error: 'Username required' });
    const lowerUsername = req.body.username.toLowerCase();
    const user = await db.get('SELECT * FROM users WHERE LOWER(username) = ?', [lowerUsername]);
    if (user && await bcrypt.compare(req.body.password, user.password)) {
        res.json({ token: jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET), id: user.id, username: user.username, role: user.role, name: user.display_name, link_code: user.link_code });
    } else { res.status(401).json({ error: 'Invalid credentials' }); }
});

app.get('/api/weeks', authenticate, async (req, res) => {
    const weeks = await db.all('SELECT id, week_start_date FROM active_week ORDER BY id DESC');
    res.json(weeks);
});

app.get('/api/family/grid', authenticate, async (req, res) => {
    const weekId = req.query.weekId || (await db.get('SELECT MAX(id) as id FROM active_week')).id;
    const me = await db.get('SELECT family_id FROM users WHERE id = ?', [req.userId]);
    const members = await db.all('SELECT id, display_name as name, sort_order FROM users WHERE family_id = ? ORDER BY sort_order ASC, id ASC', [me.family_id]);
    
    const ids = members.map(f => f.id);
    const placeholders = ids.map(() => '?').join(',');
    const logs = ids.length > 0 ? await db.all(`SELECT user_id, food_item FROM logs WHERE week_id = ? AND user_id IN (${placeholders})`, [weekId, ...ids]) : [];
    
    const grid = {};
    ids.forEach(id => grid[id] = []);
    logs.forEach(l => grid[l.user_id].push(l.food_item));
    res.json({ members, grid });
});

app.post('/api/family/create', authenticate, async (req, res) => {
    if (req.userRole !== 'parent') return res.status(403).json({error: 'Not a parent'});
    const me = await db.get('SELECT family_id FROM users WHERE id = ?', [req.userId]);
    const rawUsername = req.body.username;
    if (!rawUsername) return res.status(400).json({ error: 'Username required' });
    
    const lowerUsername = rawUsername.toLowerCase();
    const displayName = req.body.displayName || rawUsername;
    const hash = await bcrypt.hash(req.body.password, 10);
    const linkCode = crypto.randomInt(100000, 1000000).toString();
    
    const existing = await db.get('SELECT id FROM users WHERE LOWER(username) = ?', [lowerUsername]);
    if (existing) return res.status(400).json({ error: 'Username already exists' });

    try {
        await db.run('INSERT INTO users (username, password, role, display_name, link_code, family_id) VALUES (?, ?, ?, ?, ?, ?)', [lowerUsername, hash, 'user', displayName, linkCode, me.family_id]);
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: 'Username already exists' }); }
});

app.post('/api/family/link', authenticate, async (req, res) => {
    if (req.userRole !== 'parent') return res.status(403).json({error: 'Not a parent'});
    const me = await db.get('SELECT family_id FROM users WHERE id = ?', [req.userId]);
    const targetUsername = (req.body.username || '').toLowerCase();
    const target = await db.get('SELECT id FROM users WHERE LOWER(username) = ? AND link_code = ?', [targetUsername, req.body.linkCode]);
    if (!target) return res.status(404).json({error: 'Invalid username or connection PIN'});
    
    await db.run('UPDATE users SET family_id = ? WHERE id = ?', [me.family_id, target.id]);
    res.json({ success: true });
});

app.post('/api/family/reorder', authenticate, async (req, res) => {
    if (req.userRole !== 'parent') return res.status(403).json({error: 'Not a parent'});
    const { order } = req.body;
    for (let i = 0; i < order.length; i++) {
        await db.run('UPDATE users SET sort_order = ? WHERE id = ? AND family_id = (SELECT family_id FROM users WHERE id = ?)', [i, order[i], req.userId]);
    }
    res.json({ success: true });
});

app.post('/api/toggle/:targetId', authenticate, async (req, res) => {
    const targetId = parseInt(req.params.targetId);
    const weekId = req.body.weekId || (await db.get('SELECT MAX(id) as id FROM active_week')).id;
    if (req.body.checked) { await db.run('INSERT INTO logs (user_id, week_id, food_item) VALUES (?, ?, ?)', [targetId, weekId, req.body.item]); } 
    else { await db.run('DELETE FROM logs WHERE user_id = ? AND week_id = ? AND food_item = ?', [targetId, weekId, req.body.item]); }
    res.json({ success: true });
});

app.get('/api/admin/dashboard', authenticate, async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    const weekId = req.query.weekId || (await db.get('SELECT MAX(id) as id FROM active_week')).id;
    res.json(await db.all(`SELECT u.display_name as username, COUNT(l.id) as current_score FROM users u LEFT JOIN logs l ON u.id = l.user_id AND l.week_id = ? WHERE u.role != 'admin' GROUP BY u.id`, [weekId]));
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
  "dependencies": { "react": "^18.2.0", "react-dom": "^18.2.0" },
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

const defaultFoods = ["Almonds", "Amaranth", "Apples", "Apricots", "Artichokes", "Arugula", "Asparagus", "Avocado", "Bamboo Shoots", "Bananas", "Barley", "Beets", "Bell Peppers", "Black Beans", "Blackberries", "Blueberries", "Bok Choy", "Broccoli", "Brussels Sprouts", "Buckwheat", "Cabbage", "Cannellini Beans", "Carrots", "Cashews", "Cauliflower", "Celery", "Chia Seeds", "Chickpeas", "Cilantro", "Cocoa", "Coconut", "Collard Greens", "Cranberries", "Cucumbers", "Dandelion Greens", "Dates", "Edamame", "Eggplant", "Endive", "Fennel", "Flaxseed", "Garlic", "Ginger", "Grapefruit", "Grapes", "Green Beans", "Green Peas", "Guava", "Hazelnuts", "Hemp Seeds", "Jerusalem Artichokes", "Jicama", "Kale", "Kefir", "Kimchi", "Kiwi", "Kohlrabi", "Kombucha", "Leeks", "Lemon", "Lentils", "Lima Beans", "Macadamia Nuts", "Mango", "Millet", "Mint", "Miso", "Mushrooms", "Mustard Greens", "Natto", "Navy Beans", "Oats", "Okra", "Olive Oil", "Olives", "Onions", "Oranges", "Papaya", "Parsley", "Parsnips", "Peaches", "Pears", "Pecans", "Pine Nuts", "Pineapple", "Pinto Beans", "Pistachios", "Plums", "Pomegranate", "Potatoes", "Pumpkin", "Pumpkin Seeds", "Quinoa", "Radicchio", "Radishes", "Raspberries", "Red Wine", "Rhubarb", "Rutabaga", "Rye", "Sauerkraut", "Scallions", "Seaweed", "Sesame Seeds", "Shallots", "Sorghum", "Soybeans", "Spinach", "Sprouts", "Squash", "Strawberries", "Sunflower Seeds", "Sweet Potatoes", "Swiss Chard", "Teff", "Tempeh", "Tomatoes", "Turnips", "Walnuts", "Watermelon", "Wild Rice", "Yogurt", "Zucchini"];

const columnColors = ['#f0f9ff', '#f0fdf4', '#fefce8', '#fff1f2', '#f3e8ff', '#ecfeff', '#fdf4ff'];

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [role, setRole] = useState(localStorage.getItem('role'));
  const [myLinkCode, setMyLinkCode] = useState(localStorage.getItem('linkCode'));
  
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [isParentReg, setIsParentReg] = useState(false);
  
  const [createUsername, setCreateUsername] = useState('');
  const [createDisplayName, setCreateDisplayName] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  
  const [linkUsername, setLinkUsername] = useState('');
  const [linkCodeInput, setLinkCodeInput] = useState('');
  
  const [weeks, setWeeks] = useState([]);
  const [selectedWeek, setSelectedWeek] = useState(null);
  
  const [familyMembers, setFamilyMembers] = useState([]);
  const [gridData, setGridData] = useState({});
  const [clientScores, setClientScores] = useState([]);
  const [isLoginView, setIsLoginView] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const hardReset = () => { localStorage.clear(); window.location.reload(); };

  useEffect(() => {
    if (token) {
        fetch('/api/weeks', { headers: { Authorization: `Bearer ${token}` } })
            .then(r => { if (!r.ok) { hardReset(); throw new Error('Auth failed'); } return r.json(); })
            .then(data => {
                setWeeks(data);
                if (data.length > 0 && !selectedWeek) setSelectedWeek(data[0].id);
            })
            .catch(() => {});
    }
  }, [token]);

  useEffect(() => {
    if (!token || !selectedWeek) return;
    if (role === 'admin') {
      fetch(`/api/admin/dashboard?weekId=${selectedWeek}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => { if (!r.ok) hardReset(); return r.json(); })
        .then(d => setClientScores(Array.isArray(d) ? d : []))
        .catch(hardReset);
    } else {
      fetch(`/api/family/grid?weekId=${selectedWeek}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => { if (!r.ok) hardReset(); return r.json(); })
        .then(d => { if (d && !d.error) { setFamilyMembers(d.members || []); setGridData(d.grid || {}); } })
        .catch(hardReset);
    }
  }, [token, role, selectedWeek, refreshTrigger]);

  const authSubmit = async (e) => {
    e.preventDefault();
    const endpoint = isLoginView ? '/api/login' : '/api/register';
    const body = isLoginView ? { username, password } : { username, displayName, password, isParent: isParentReg };
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.token) {
        localStorage.setItem('token', data.token); localStorage.setItem('role', data.role); localStorage.setItem('linkCode', data.link_code);
        setToken(data.token); setRole(data.role); setMyLinkCode(data.link_code);
      } else if (!isLoginView && data.success) {
        setIsLoginView(true); alert("Registered! Please log in.");
      } else { alert(data.error); }
    } catch(err) { alert("Network Error"); }
  };

  const createMember = async (e) => {
    e.preventDefault();
    if (!createUsername.trim() || !createPassword.trim()) return;
    const res = await fetch('/api/family/create', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, 
      body: JSON.stringify({ username: createUsername.trim(), displayName: createDisplayName.trim() || createUsername.trim(), password: createPassword }) 
    });
    const data = await res.json();
    if (data.success) {
      setCreateUsername(''); setCreateDisplayName(''); setCreatePassword('');
      setRefreshTrigger(prev => prev + 1);
    } else alert(data.error);
  };

  const linkUser = async (e) => {
    e.preventDefault();
    if (!linkUsername.trim() || !linkCodeInput.trim()) return;
    const res = await fetch('/api/family/link', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, 
      body: JSON.stringify({ username: linkUsername.trim(), linkCode: linkCodeInput.trim() }) 
    });
    const data = await res.json();
    if (data.success) {
      setLinkUsername(''); setLinkCodeInput('');
      setRefreshTrigger(prev => prev + 1);
    } else alert(data.error);
  };

  const shiftColumn = async (index, direction) => {
    const newArr = [...familyMembers];
    if (direction === -1 && index > 0) {
      [newArr[index - 1], newArr[index]] = [newArr[index], newArr[index - 1]];
    } else if (direction === 1 && index < newArr.length - 1) {
      [newArr[index + 1], newArr[index]] = [newArr[index], newArr[index + 1]];
    } else return;
    
    setFamilyMembers(newArr);
    await fetch('/api/family/reorder', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, 
        body: JSON.stringify({ order: newArr.map(m => m.id) }) 
    });
  };

  const handleToggle = async (memberId, item) => {
    const isChecked = gridData[memberId]?.includes(item);
    setGridData(prev => {
      const memberItems = prev[memberId] || [];
      return { ...prev, [memberId]: isChecked ? memberItems.filter(i => i !== item) : [...memberItems, item] };
    });
    await fetch(`/api/toggle/${memberId}`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, 
        body: JSON.stringify({ item, checked: !isChecked, weekId: selectedWeek }) 
    });
  };

  if (!token) return (
    <div style={{ maxWidth: '400px', margin: '50px auto', fontFamily: 'system-ui', padding: '24px', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
      <h2 style={{ marginTop: 0 }}>{isLoginView ? "Login" : "Register"}</h2>
      <form onSubmit={authSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <input type="text" placeholder="Username (login)" value={username} onChange={e => setUsername(e.target.value)} required style={{ padding: '10px', borderRadius: '4px', border: '1px solid #cbd5e1' }}/>
        {!isLoginView && <input type="text" placeholder="Display Name (e.g., Phillip)" value={displayName} onChange={e => setDisplayName(e.target.value)} required style={{ padding: '10px', borderRadius: '4px', border: '1px solid #cbd5e1' }}/>}
        <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required style={{ padding: '10px', borderRadius: '4px', border: '1px solid #cbd5e1' }}/>
        {!isLoginView && <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}><input type="checkbox" checked={isParentReg} onChange={e => setIsParentReg(e.target.checked)}/> Manage Family Dashboard</label>}
        <button type="submit" style={{ padding: '10px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>Submit</button>
      </form>
      <p style={{ cursor: 'pointer', color: '#2563eb', marginTop: '16px', textAlign: 'center' }} onClick={() => setIsLoginView(!isLoginView)}>{isLoginView ? "Need an account? Register" : "Have an account? Login"}</p>
    </div>
  );

  const HeaderControls = () => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '15px' }}>
      <div>
        <h2 style={{ margin: '0 0 8px 0' }}>Microbiome Diversity Tracker</h2>
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>
          {myLinkCode && <span style={{ background: '#fef3c7', padding: '4px 8px', borderRadius: '4px', fontSize: '14px', border: '1px solid #fcd34d' }}><strong>Connection PIN:</strong> {myLinkCode}</span>}
          <select 
            value={selectedWeek || ''} 
            onChange={(e) => setSelectedWeek(e.target.value)}
            style={{ padding: '6px', borderRadius: '4px', border: '1px solid #cbd5e1', background: 'white', fontWeight: 'bold' }}
          >
            {weeks.map((w, idx) => <option key={w.id} value={w.id}>{idx === 0 ? "Current Week" : "Week of " + w.week_start_date}</option>)}
          </select>
        </div>
      </div>
      <button onClick={hardReset} style={{ padding: '6px 12px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Logout</button>
    </div>
  );

  if (role === 'admin') return (
    <div style={{ fontFamily: 'system-ui', maxWidth: '800px', margin: '0 auto', padding: '20px' }}>
      <HeaderControls />
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '20px', textAlign: 'left' }}>
        <thead><tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}><th style={{ padding: '12px' }}>Client</th><th style={{ padding: '12px' }}>Score</th></tr></thead>
        <tbody>{clientScores.map(c => <tr key={c.username} style={{ borderBottom: '1px solid #e2e8f0' }}><td style={{ padding: '12px' }}>{c.username}</td><td style={{ padding: '12px' }}>{c.current_score} / 30</td></tr>)}</tbody>
      </table>
    </div>
  );

  return (
    <div style={{ fontFamily: 'system-ui', maxWidth: '1200px', margin: '0 auto', padding: '20px' }}>
      <HeaderControls />
      
      {role === 'parent' && (
        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '20px' }}>
          <form onSubmit={createMember} style={{ display: 'flex', gap: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '15px', borderRadius: '8px', flexGrow: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <strong style={{ width: '100%' }}>Create & Link Account:</strong>
            <input type="text" placeholder="Username" value={createUsername} onChange={e => setCreateUsername(e.target.value)} required style={{ padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', width: '120px' }}/>
            <input type="text" placeholder="Display Name" value={createDisplayName} onChange={e => setCreateDisplayName(e.target.value)} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', width: '120px' }}/>
            <input type="password" placeholder="Password" value={createPassword} onChange={e => setCreatePassword(e.target.value)} required style={{ padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', width: '120px' }}/>
            <button type="submit" style={{ padding: '8px 16px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>Create</button>
          </form>

          <form onSubmit={linkUser} style={{ display: 'flex', gap: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '15px', borderRadius: '8px', flexGrow: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <strong style={{ width: '100%' }}>Link Existing Account:</strong>
            <input type="text" placeholder="Username" value={linkUsername} onChange={e => setLinkUsername(e.target.value)} required style={{ padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', width: '120px' }}/>
            <input type="text" placeholder="6-Digit PIN" value={linkCodeInput} onChange={e => setLinkCodeInput(e.target.value)} required style={{ padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', width: '90px' }}/>
            <button type="submit" style={{ padding: '8px 16px', background: '#10b981', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>Connect</button>
          </form>
        </div>
      )}

      <div style={{ maxHeight: '75vh', overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', background: 'white' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', textAlign: 'center' }}>
          <thead>
            <tr>
              <th style={{ position: 'sticky', left: 0, top: 0, background: '#f8fafc', padding: '12px', borderBottom: '2px solid #cbd5e1', borderRight: '2px solid #cbd5e1', textAlign: 'left', zIndex: 30, minWidth: '180px' }}>Food Item</th>
              {familyMembers.map((m, idx) => (
                <th key={m.id} style={{ position: 'sticky', top: 0, background: columnColors[idx % columnColors.length], padding: '12px', borderBottom: '2px solid #cbd5e1', borderRight: '1px solid #e2e8f0', zIndex: 20, minWidth: '130px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    {role === 'parent' ? <button onClick={() => shiftColumn(idx, -1)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8' }}>&lt;</button> : <span></span>}
                    <span style={{ fontWeight: 'bold' }}>{m.name}</span>
                    {role === 'parent' ? <button onClick={() => shiftColumn(idx, 1)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8' }}>&gt;</button> : <span></span>}
                  </div>
                  <span style={{ fontSize: '0.85em', fontWeight: 'normal', color: '#64748b' }}>Score: {gridData[m.id]?.length || 0}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {defaultFoods.map(food => (
              <tr key={food}>
                <td style={{ position: 'sticky', left: 0, background: 'white', padding: '10px 12px', borderBottom: '1px solid #f1f5f9', borderRight: '2px solid #cbd5e1', textAlign: 'left', zIndex: 10, fontWeight: '500' }}>{food}</td>
                {familyMembers.map((m, idx) => (
                  <td key={m.id} style={{ padding: '10px', background: columnColors[idx % columnColors.length], borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #e2e8f0' }}>
                    <input type="checkbox" checked={gridData[m.id]?.includes(food) || false} onChange={() => handleToggle(m.id, food)} style={{ width: '22px', height: '22px', cursor: 'pointer' }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
EOF

npm install --no-fund --no-audit --loglevel=error
npm run build
mkdir -p ../api/public
cp -r dist/* ../api/public/

# ==========================================
# SSL & NGINX SETUP
# ==========================================
echo "Configuring SSL and Nginx..."

# Generate a fallback self-signed certificate so Nginx always has HTTPS available locally
mkdir -p /etc/ssl/private /etc/ssl/certs
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/ssl/private/nginx-selfsigned.key \
    -out /etc/ssl/certs/nginx-selfsigned.crt \
    -subj "/CN=${DOMAIN_NAME:-localhost}" 2>/dev/null

cat << EOF > /etc/nginx/sites-available/microbiome
server {
    listen 80 default_server;
    server_name _;
    # Force HTTP to HTTPS redirect
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl default_server;
    server_name _;

    ssl_certificate /etc/ssl/certs/nginx-selfsigned.crt;
    ssl_certificate_key /etc/ssl/private/nginx-selfsigned.key;

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
    echo "Attempting to provision Let's Encrypt SSL Certificate via Certbot..."
    # --keep-until-expiring prevents hitting rate limits if the cert exists.
    # We quote "$ADMIN_EMAIL" to prevent AssertionError crashes on empty or special character inputs.
    certbot --nginx -d "$DOMAIN_NAME" -m "$ADMIN_EMAIL" --non-interactive --agree-tos --redirect --keep-until-expiring || echo "Certbot encountered an issue. Falling back to the Self-Signed cert for HTTPS access."
fi

echo "Starting Application Service..."
cd ../api
pm2 start server.js --name "microbiome-api"
pm2 save
pm2 startup

echo "========================================="
echo "Deployment Complete!"
echo "========================================="
