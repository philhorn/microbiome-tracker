#!/bin/bash

echo "Creating directories..."
mkdir -p api
mkdir -p client/src

echo "Writing api/server.js..."
cat << 'EOF' > api/server.js
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
import rateLimit from 'express-rate-limit';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3001;
const SECRET = crypto.randomBytes(32).toString('hex');
const ADMIN_CRED_FILE = path.join(__dirname, 'admin_credentials.txt');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: { error: 'Too many accounts created from this IP. Try again in an hour.' } });

let db;
(async () => {
    db = await open({ filename: path.join(__dirname, 'database.sqlite'), driver: sqlite3.Database });
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT DEFAULT 'user', family_id INTEGER, display_name TEXT, link_code TEXT, sort_order INTEGER DEFAULT 0, is_suspended INTEGER DEFAULT 0, failed_attempts INTEGER DEFAULT 0, locked_until TEXT);
        CREATE TABLE IF NOT EXISTS active_week (id INTEGER PRIMARY KEY AUTOINCREMENT, week_start_date TEXT);
        CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, week_id INTEGER, food_item TEXT, FOREIGN KEY(user_id) REFERENCES users(id));
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, join_code TEXT UNIQUE);
        CREATE TABLE IF NOT EXISTS group_members (group_id INTEGER, user_id INTEGER, sort_order INTEGER DEFAULT 0, PRIMARY KEY(group_id, user_id));
        CREATE TABLE IF NOT EXISTS foods (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, category TEXT);
        
        INSERT INTO active_week (id, week_start_date) SELECT 1, date('now', 'localtime', '-7 days') WHERE NOT EXISTS (SELECT 1 FROM active_week WHERE id = 1);
        INSERT OR IGNORE INTO settings (key, value) VALUES ('max_attempts', '5'), ('lockout_mins', '15'), ('rollover_day', '0');
    `);

    const foodCount = await db.get("SELECT COUNT(*) as c FROM foods");
    if (foodCount.c === 0) {
        const defaultFoods = {
            "Vegetables": ["Artichokes", "Arugula", "Asparagus", "Bamboo Shoots", "Beets", "Bell Peppers", "Bok Choy", "Broccoli", "Brussels Sprouts", "Cabbage", "Carrots", "Cauliflower", "Celery", "Collard Greens", "Cucumbers", "Dandelion Greens", "Eggplant", "Endive", "Fennel", "Garlic", "Green Beans", "Jerusalem Artichokes", "Jicama", "Kale", "Kohlrabi", "Leeks", "Mushrooms", "Mustard Greens", "Okra", "Olives", "Onions", "Parsnips", "Potatoes", "Pumpkin", "Radicchio", "Radishes", "Rutabaga", "Scallions", "Seaweed", "Shallots", "Spinach", "Sprouts", "Squash", "Sweet Potatoes", "Swiss Chard", "Tomatoes", "Turnips", "Watercress", "Zucchini"],
            "Fruits": ["Apples", "Apricots", "Avocado", "Bananas", "Blackberries", "Blueberries", "Cherries", "Cranberries", "Dates", "Figs", "Grapefruit", "Grapes", "Guava", "Kiwi", "Lemon", "Mango", "Melon", "Oranges", "Papaya", "Peaches", "Pears", "Pineapple", "Plums", "Pomegranate", "Raspberries", "Rhubarb", "Strawberries", "Watermelon"],
            "Nuts & Seeds": ["Almonds", "Cashews", "Chia Seeds", "Coconut", "Flaxseed", "Hazelnuts", "Hemp Seeds", "Macadamia Nuts", "Peanuts", "Pecans", "Pine Nuts", "Pistachios", "Pumpkin Seeds", "Sesame Seeds", "Sunflower Seeds", "Walnuts"],
            "Legumes": ["Black Beans", "Cannellini Beans", "Chickpeas", "Edamame", "Green Peas", "Lentils", "Lima Beans", "Navy Beans", "Pinto Beans", "Soybeans"],
            "Grains": ["Amaranth", "Barley", "Brown Rice", "Buckwheat", "Millet", "Oats", "Quinoa", "Rye", "Sorghum", "Teff", "Wild Rice"],
            "Herbs & Spices": ["Basil", "Cilantro", "Cinnamon", "Dill", "Ginger", "Mint", "Oregano", "Parsley", "Rosemary", "Sage", "Thyme", "Turmeric"],
            "Fermented & Other": ["Cocoa", "Kefir", "Kimchi", "Kombucha", "Miso", "Natto", "Olive Oil", "Red Wine", "Sauerkraut", "Tempeh", "Yogurt"]
        };
        const stmt = await db.prepare("INSERT INTO foods (name, category) VALUES (?, ?)");
        for (const [cat, items] of Object.entries(defaultFoods)) {
            for (const item of items) await stmt.run([item, cat]);
        }
        await stmt.finalize();
    }

    const adminExists = await db.get("SELECT 1 FROM users WHERE role = 'admin'");
    if (!adminExists) {
        const tempPassword = crypto.randomBytes(6).toString('hex');
        const adminHash = await bcrypt.hash(tempPassword, 10);
        await db.exec(`INSERT INTO users (username, password, role, display_name) VALUES ('admin', '${adminHash}', 'admin', 'System Admin')`);
        fs.writeFileSync(ADMIN_CRED_FILE, `INITIAL SYSTEM SETUP\nUsername: admin\nTemporary Password: ${tempPassword}\n\nLog in and change immediately.\n`, { mode: 0o600 });
    }
})();

const authenticate = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    jwt.verify(token, SECRET, async (err, decoded) => {
        if (err) return res.status(403).json({ error: 'Forbidden' });
        const user = await db.get('SELECT is_suspended FROM users WHERE id = ?', [decoded.id]);
        if (!user || user.is_suspended) return res.status(403).json({ error: 'Account suspended.' });
        
        req.userId = decoded.id; req.userRole = decoded.role; 
        const impId = req.headers['x-impersonate'];
        if (impId && decoded.role === 'admin') {
            const target = await db.get('SELECT id, role FROM users WHERE id = ?', [impId]);
            if (target) { req.userId = target.id; req.userRole = target.role; }
        }
        next();
    });
};

app.get('/api/setup-status', (req, res) => { res.json({ needsSetup: fs.existsSync(ADMIN_CRED_FILE) }); });
app.get('/api/foods', authenticate, async (req, res) => {
    const rows = await db.all('SELECT name, category FROM foods ORDER BY category, name');
    const categorized = {};
    rows.forEach(r => { if (!categorized[r.category]) categorized[r.category] = []; categorized[r.category].push(r.name); });
    res.json(categorized);
});

app.post('/api/register', registerLimiter, async (req, res) => {
    const rawUsername = req.body.username;
    if (!rawUsername) return res.status(400).json({ error: 'Username required' });
    const lowerUsername = rawUsername.toLowerCase();
    const hash = await bcrypt.hash(req.body.password, 10);
    const existing = await db.get('SELECT id FROM users WHERE LOWER(username) = ?', [lowerUsername]);
    if (existing) return res.status(400).json({ error: 'Username exists' });

    try { 
        const result = await db.run('INSERT INTO users (username, password, role, display_name) VALUES (?, ?, ?, ?)', [lowerUsername, hash, req.body.isParent ? 'parent' : 'user', req.body.displayName || rawUsername]); 
        const joinCode = crypto.randomInt(100000, 1000000).toString();
        const groupRes = await db.run("INSERT INTO groups (name, join_code) VALUES ('My Family', ?)", [joinCode]);
        await db.run("INSERT INTO group_members (group_id, user_id, sort_order) VALUES (?, ?, 0)", [groupRes.lastID, result.lastID]);
        res.json({ success: true }); 
    } catch (e) { res.status(400).json({ error: 'Database error' }); }
});

app.post('/api/login', async (req, res) => {
    if (!req.body.username) return res.status(400).json({ error: 'Username required' });
    const user = await db.get('SELECT * FROM users WHERE LOWER(username) = ?', [req.body.username.toLowerCase()]);
    if (!user || user.is_suspended) return res.status(401).json({ error: 'Invalid credentials or suspended' });
    if (user.locked_until && new Date(user.locked_until) > new Date()) return res.status(403).json({ error: 'Account locked.' });

    if (await bcrypt.compare(req.body.password, user.password)) {
        await db.run('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', [user.id]);
        res.json({ token: jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET), id: user.id, username: user.username, role: user.role, name: user.display_name });
    } else { 
        const attempts = (user.failed_attempts || 0) + 1;
        const limitSettings = await db.get("SELECT value FROM settings WHERE key = 'max_attempts'");
        if (attempts >= (limitSettings ? parseInt(limitSettings.value) : 5)) {
            const minSettings = await db.get("SELECT value FROM settings WHERE key = 'lockout_mins'");
            const lockoutUntil = new Date(Date.now() + (minSettings ? parseInt(minSettings.value) : 15) * 60000).toISOString();
            await db.run('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?', [attempts, lockoutUntil, user.id]);
            return res.status(401).json({ error: 'Account locked.' }); 
        }
        await db.run('UPDATE users SET failed_attempts = ? WHERE id = ?', [attempts, user.id]);
        res.status(401).json({ error: 'Invalid credentials' }); 
    }
});

app.put('/api/user/profile', authenticate, async (req, res) => {
    if (req.body.displayName) await db.run('UPDATE users SET display_name = ? WHERE id = ?', [req.body.displayName, req.userId]);
    if (req.body.newPassword) {
        await db.run('UPDATE users SET password = ? WHERE id = ?', [await bcrypt.hash(req.body.newPassword, 10), req.userId]);
        if (req.userRole === 'admin' && !req.headers['x-impersonate'] && fs.existsSync(ADMIN_CRED_FILE)) fs.unlinkSync(ADMIN_CRED_FILE);
    }
    const user = await db.get('SELECT username, role, display_name FROM users WHERE id = ?', [req.userId]);
    res.json({ success: true, name: user.display_name });
});

app.post('/api/user/upgrade', authenticate, async (req, res) => {
    await db.run("UPDATE users SET role = 'parent' WHERE id = ?", [req.userId]);
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.userId]);
    res.json({ success: true, token: jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET), role: user.role });
});

app.delete('/api/user/delete', authenticate, async (req, res) => {
    if (req.userRole === 'admin') return res.status(403).json({ error: 'Cannot delete master admin' });
    await db.run('DELETE FROM group_members WHERE user_id = ?', [req.userId]);
    await db.run('DELETE FROM logs WHERE user_id = ?', [req.userId]);
    await db.run('DELETE FROM users WHERE id = ?', [req.userId]);
    res.json({ success: true });
});

app.get('/api/weeks', authenticate, async (req, res) => { res.json(await db.all('SELECT id, week_start_date FROM active_week ORDER BY id DESC')); });

app.get('/api/groups/grid', authenticate, async (req, res) => {
    const weekId = req.query.weekId || (await db.get('SELECT MAX(id) as id FROM active_week')).id;
    let myGroups = await db.all('SELECT group_id FROM group_members WHERE user_id = ?', [req.userId]);
    
    if (!myGroups.length) {
        const joinCode = crypto.randomInt(100000, 1000000).toString();
        const groupRes = await db.run("INSERT INTO groups (name, join_code) VALUES ('My Family', ?)", [joinCode]);
        await db.run("INSERT INTO group_members (group_id, user_id, sort_order) VALUES (?, ?, 0)", [groupRes.lastID, req.userId]);
        myGroups = [{ group_id: groupRes.lastID }];
    }
    
    const groupIds = myGroups.map(g => g.group_id);
    const groups = await db.all(`SELECT id, name, join_code FROM groups WHERE id IN (${groupIds.join(',')})`);
    const members = await db.all(`SELECT gm.group_id, u.id, u.display_name as name, gm.sort_order FROM group_members gm JOIN users u ON gm.user_id = u.id WHERE gm.group_id IN (${groupIds.join(',')}) ORDER BY gm.group_id, gm.sort_order ASC, u.id ASC`);
    const formattedGroups = groups.map(g => ({ ...g, members: members.filter(m => m.group_id === g.id) }));

    const uniqueUserIds = [...new Set(members.map(m => m.id))];
    const placeholders = uniqueUserIds.map(() => '?').join(',');
    const logs = uniqueUserIds.length > 0 ? await db.all(`SELECT user_id, food_item FROM logs WHERE week_id = ? AND user_id IN (${placeholders})`, [weekId, ...uniqueUserIds]) : [];
    const grid = {}; uniqueUserIds.forEach(id => grid[id] = []);
    logs.forEach(l => grid[l.user_id].push(l.food_item));
    res.json({ groups: formattedGroups, grid });
});

app.post('/api/groups/create', authenticate, async (req, res) => {
    if (req.userRole !== 'parent' && req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    const joinCode = crypto.randomInt(100000, 1000000).toString();
    const result = await db.run('INSERT INTO groups (name, join_code) VALUES (?, ?)', [req.body.name, joinCode]);
    await db.run('INSERT INTO group_members (group_id, user_id, sort_order) VALUES (?, ?, 0)', [result.lastID, req.userId]);
    res.json({ success: true });
});

app.post('/api/groups/join', authenticate, async (req, res) => {
    const target = await db.get('SELECT id FROM groups WHERE join_code = ?', [req.body.joinCode]);
    if (!target) return res.status(404).json({error: 'Invalid PIN'});
    const exists = await db.get('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?', [target.id, req.userId]);
    if (!exists) await db.run('INSERT INTO group_members (group_id, user_id, sort_order) VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM group_members WHERE group_id = ?))', [target.id, req.userId, target.id]);
    res.json({ success: true });
});

app.post('/api/groups/:groupId/create_user', authenticate, async (req, res) => {
    if (req.userRole !== 'parent' && req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    const access = await db.get('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?', [req.params.groupId, req.userId]);
    if (!access) return res.status(403).json({error: 'Denied'});
    const lowerUsername = req.body.username.toLowerCase();
    const existing = await db.get('SELECT id FROM users WHERE LOWER(username) = ?', [lowerUsername]);
    if (existing) return res.status(400).json({ error: 'Username exists' });

    try {
        const result = await db.run('INSERT INTO users (username, password, role, display_name) VALUES (?, ?, ?, ?)', [lowerUsername, await bcrypt.hash(req.body.password, 10), 'user', req.body.displayName || rawUsername]);
        await db.run('INSERT INTO group_members (group_id, user_id, sort_order) VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM group_members WHERE group_id = ?))', [req.params.groupId, result.lastID, req.params.groupId]);
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: 'Error' }); }
});

app.put('/api/groups/member/:id', authenticate, async (req, res) => {
    if (req.userRole !== 'parent' && req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    await db.run('UPDATE users SET display_name = ? WHERE id = ?', [req.body.displayName, req.params.id]);
    res.json({ success: true });
});

app.post('/api/groups/:groupId/reorder', authenticate, async (req, res) => {
    if (req.userRole !== 'parent' && req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    for (let i = 0; i < req.body.order.length; i++) await db.run('UPDATE group_members SET sort_order = ? WHERE user_id = ? AND group_id = ?', [i, req.body.order[i], req.params.groupId]);
    res.json({ success: true });
});

app.post('/api/toggle/:targetId', authenticate, async (req, res) => {
    const weekId = req.body.weekId || (await db.get('SELECT MAX(id) as id FROM active_week')).id;
    if (req.body.checked) { await db.run('INSERT INTO logs (user_id, week_id, food_item) VALUES (?, ?, ?)', [parseInt(req.params.targetId), weekId, req.body.item]); } 
    else { await db.run('DELETE FROM logs WHERE user_id = ? AND week_id = ? AND food_item = ?', [parseInt(req.params.targetId), weekId, req.body.item]); }
    res.json({ success: true });
});

app.get('/api/admin/users', authenticate, async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    res.json(await db.all(`SELECT id, username, display_name, role, is_suspended, failed_attempts, locked_until FROM users`));
});

app.post('/api/admin/suspend/:id', authenticate, async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    const target = await db.get('SELECT username, is_suspended FROM users WHERE id = ?', [req.params.id]);
    if (target && target.username === 'admin') return res.status(403).json({error: 'Cannot suspend master admin'});
    await db.run('UPDATE users SET is_suspended = ? WHERE id = ?', [target.is_suspended ? 0 : 1, req.params.id]);
    res.json({ success: true });
});

app.post('/api/admin/role/:id', authenticate, async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    const target = await db.get('SELECT username FROM users WHERE id = ?', [req.params.id]);
    if (target && target.username === 'admin') return res.status(403).json({error: 'Cannot modify master admin'});
    await db.run('UPDATE users SET role = ? WHERE id = ?', [req.body.role, req.params.id]);
    res.json({ success: true });
});

app.delete('/api/admin/delete/:id', authenticate, async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    const target = await db.get('SELECT username FROM users WHERE id = ?', [req.params.id]);
    if (target && target.username === 'admin') return res.status(403).json({error: 'Cannot delete master admin'});
    await db.run('DELETE FROM group_members WHERE user_id = ?', [req.params.id]);
    await db.run('DELETE FROM logs WHERE user_id = ?', [req.params.id]);
    await db.run('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ success: true });
});

app.get('/api/admin/settings', authenticate, async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    const settings = {};
    (await db.all('SELECT key, value FROM settings')).forEach(r => settings[r.key] = r.value);
    res.json(settings);
});

app.put('/api/admin/settings', authenticate, async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    for (const [key, value] of Object.entries(req.body)) await db.run('UPDATE settings SET value = ? WHERE key = ?', [value, key]);
    res.json({ success: true });
});

app.post('/api/admin/force-week', authenticate, async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    await db.run("INSERT INTO active_week (week_start_date) VALUES (date('now', 'localtime'))");
    res.json({ success: true });
});

cron.schedule('1 0 * * *', async () => {
    const setting = await db.get("SELECT value FROM settings WHERE key = 'rollover_day'");
    if (new Date().getDay() === (setting ? parseInt(setting.value) : 0)) await db.run("INSERT INTO active_week (week_start_date) VALUES (date('now', 'localtime'))");
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`API running on port ${PORT}`));
EOF

echo "Writing client/src/api.js..."
cat << 'EOF' > client/src/api.js
export const apiFetch = async (url, token, impersonatingId, options = {}) => {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    if (impersonatingId) headers['X-Impersonate'] = impersonatingId.toString();
    return fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
};
EOF

echo "Writing client/src/Auth.jsx..."
cat << 'EOF' > client/src/Auth.jsx
import React, { useState } from 'react';

export default function Auth({ setAuthData, setupNotice }) {
    const [isLoginView, setIsLoginView] = useState(true);
    const [username, setUsername] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [password, setPassword] = useState('');
    const [isParentReg, setIsParentReg] = useState(false);

    const authSubmit = async (e) => {
        e.preventDefault();
        const endpoint = isLoginView ? '/api/login' : '/api/register';
        const body = isLoginView ? { username, password } : { username, displayName, password, isParent: isParentReg };
        try {
            const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const data = await res.json();
            if (data.token) {
                setAuthData(data.token, data.role, data.name, data.username);
            } else if (!isLoginView && data.success) {
                setIsLoginView(true); alert("Registered! Please log in.");
            } else { alert(data.error); }
        } catch(err) { alert("Network Error"); }
    };

    return (
        <div style={{ maxWidth: '400px', margin: '50px auto', fontFamily: 'system-ui', padding: '24px', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
            {setupNotice && (
                <div style={{ background: '#fef3c7', padding: '12px', borderRadius: '6px', border: '1px solid #fcd34d', marginBottom: '20px', fontSize: '14px', color: '#92400e', lineHeight: '1.4' }}>
                <strong>System Initialized</strong><br/>
                A secure admin account has been created. Run this command on your server CLI to retrieve the temporary password:<br/>
                <code style={{ background: '#fde68a', padding: '4px', display: 'block', marginTop: '8px', borderRadius: '4px' }}>cat /var/www/microbiome-app/api/admin_credentials.txt</code>
                </div>
            )}
            <h2 style={{ marginTop: 0 }}>{isLoginView ? "Login" : "Register"}</h2>
            <form onSubmit={authSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <input type="text" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} required style={{ padding: '10px', borderRadius: '4px', border: '1px solid #cbd5e1' }}/>
                {!isLoginView && <input type="text" placeholder="Display Name" value={displayName} onChange={e => setDisplayName(e.target.value)} required style={{ padding: '10px', borderRadius: '4px', border: '1px solid #cbd5e1' }}/>}
                <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required style={{ padding: '10px', borderRadius: '4px', border: '1px solid #cbd5e1' }}/>
                {!isLoginView && <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}><input type="checkbox" checked={isParentReg} onChange={e => setIsParentReg(e.target.checked)}/> Manager Account</label>}
                <button type="submit" style={{ padding: '10px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>Submit</button>
            </form>
            <p style={{ cursor: 'pointer', color: '#2563eb', marginTop: '16px', textAlign: 'center' }} onClick={() => setIsLoginView(!isLoginView)}>{isLoginView ? "Need an account? Register" : "Have an account? Login"}</p>
        </div>
    );
}
EOF

echo "Writing client/src/TrackerGrid.jsx..."
cat << 'EOF' > client/src/TrackerGrid.jsx
import React, { useState, useEffect } from 'react';

const columnColors = ['#f0f9ff', '#f0fdf4', '#fefce8', '#fff1f2', '#f3e8ff', '#ecfeff', '#fdf4ff'];

export default function TrackerGrid({ displayedUsers, gridData, setGridData, categorizedFoods, activeRole, impersonatingId, selectedWeek, apiFetch, token }) {
    const [collapsedCats, setCollapsedCats] = useState({});
    const [undoMemory, setUndoMemory] = useState({});
    const [colWidths, setColWidths] = useState(() => {
        const saved = localStorage.getItem('colWidths');
        return saved ? JSON.parse(saved) : {};
    });

    useEffect(() => { localStorage.setItem('colWidths', JSON.stringify(colWidths)); }, [colWidths]);

    const handleToggle = async (memberId, item) => {
        const isChecked = gridData[memberId]?.includes(item);
        setGridData(prev => ({ ...prev, [memberId]: isChecked ? (prev[memberId] || []).filter(i => i !== item) : [...(prev[memberId] || []), item] }));
        await apiFetch(`/api/toggle/${memberId}`, token, impersonatingId, { method: 'POST', body: JSON.stringify({ item, checked: !isChecked, weekId: selectedWeek }) });
    };

    const handleCheckAll = async (item, action) => {
        const ids = displayedUsers.map(m => m.id);
        const next = { ...gridData };
        let finalCheckState = true;

        if (action === 'all') {
            const currentlyChecked = ids.filter(id => (next[id] || []).includes(item));
            setUndoMemory(prev => ({ ...prev, [item]: currentlyChecked }));
            ids.forEach(id => { if (!next[id]) next[id] = []; if (!next[id].includes(item)) next[id].push(item); });
        } else if (action === 'revert') {
            const mem = undoMemory[item] || [];
            ids.forEach(id => { next[id] = mem.includes(id) ? [...(next[id]||[]).filter(i=>i!==item), item] : (next[id]||[]).filter(i=>i!==item); });
            setUndoMemory(prev => { const n={...prev}; delete n[item]; return n; });
            finalCheckState = 'revert'; 
        } else if (action === 'clear') {
            ids.forEach(id => { if (next[id]) next[id] = next[id].filter(i => i !== item); });
            setUndoMemory(prev => { const n={...prev}; delete n[item]; return n; });
            finalCheckState = false;
        }
        setGridData(next);

        if (finalCheckState === 'revert') {
            const mem = undoMemory[item] || [];
            await Promise.all(ids.map(id => apiFetch(`/api/toggle/${id}`, token, impersonatingId, { method: 'POST', body: JSON.stringify({ item, checked: mem.includes(id), weekId: selectedWeek }) })));
        } else {
            await Promise.all(ids.map(id => apiFetch(`/api/toggle/${id}`, token, impersonatingId, { method: 'POST', body: JSON.stringify({ item, checked: finalCheckState, weekId: selectedWeek }) })));
        }
    };

    const handleDrag = (e, colId, defaultWidth) => {
        const startX = e.clientX;
        const startWidth = colWidths[colId] || defaultWidth;
        const onMouseMove = (moveEvent) => {
            const newWidth = Math.max(80, startWidth + (moveEvent.clientX - startX));
            setColWidths(prev => ({ ...prev, [colId]: newWidth }));
        };
        const onMouseUp = () => { document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    return (
        <div style={{ maxHeight: '70vh', overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', background: 'white', WebkitOverflowScrolling: 'touch' }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', textAlign: 'center' }}>
                <thead>
                    <tr>
                        <th className="food-col cell-pad top-left-corner" style={{ width: colWidths['food'] || 160, minWidth: 120, maxWidth: colWidths['food'] || 160, borderBottom: '2px solid #cbd5e1', borderRight: '2px solid #cbd5e1', textAlign: 'left' }}>
                            Food Item <div className="drag-handle" onMouseDown={(e) => handleDrag(e, 'food', 160)} />
                        </th>
                        {displayedUsers.map((m, idx) => (
                            <th key={m.id} className="person-col cell-pad" style={{ width: colWidths[m.id] || 90, minWidth: 80, maxWidth: colWidths[m.id] || 90, background: columnColors[idx % columnColors.length], borderBottom: '2px solid #cbd5e1', borderRight: '1px solid #e2e8f0' }}>
                                <span style={{ fontWeight: 'bold' }}>{m.name}</span><br/>
                                <span style={{ fontSize: '0.85em', fontWeight: 'normal', color: '#64748b' }}>Score: {gridData[m.id]?.length || 0}</span>
                                <div className="drag-handle" onMouseDown={(e) => handleDrag(e, m.id, 90)} />
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {Object.keys(categorizedFoods).map(category => (
                        <React.Fragment key={category}>
                            <tr>
                                <td onClick={() => setCollapsedCats({...collapsedCats, [category]: !collapsedCats[category]})} className="food-col cell-pad category-row" style={{ background: '#e2e8f0', borderBottom: '2px solid #cbd5e1', borderRight: '2px solid #cbd5e1', textAlign: 'left', fontWeight: 'bold', cursor: 'pointer' }}>
                                    {collapsedCats[category] ? '▶' : '▼'} {category}
                                </td>
                                {displayedUsers.map(m => (
                                    <td key={m.id} className="cell-pad category-row" style={{ background: '#f1f5f9', color: '#94a3b8', fontSize: '0.85em', textAlign: 'center', borderBottom: '2px solid #cbd5e1', borderRight: '1px solid #cbd5e1' }}>{category}</td>
                                ))}
                            </tr>
                            {!collapsedCats[category] && categorizedFoods[category].map(food => {
                                const checkedCount = displayedUsers.filter(m => (gridData[m.id] || []).includes(food)).length;
                                let allBtnText = "All", action = 'all', btnColor = '#cbd5e1', hoverTitle = "Check everyone visible";
                                if (displayedUsers.length > 0 && checkedCount === displayedUsers.length) {
                                    if (undoMemory[food]) { allBtnText = "Revert"; action = 'revert'; btnColor = '#fde047'; hoverTitle = "Undo 'All'"; } 
                                    else { allBtnText = "Clear"; action = 'clear'; btnColor = '#fca5a5'; hoverTitle = "Uncheck everyone visible"; }
                                }
                                return (
                                <tr key={food}>
                                    <td className="food-col cell-pad" style={{ borderBottom: '1px solid #f1f5f9', borderRight: '2px solid #cbd5e1', textAlign: 'left', fontWeight: '500', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span>{food}</span>
                                        {(activeRole === 'parent' || activeRole === 'admin') && displayedUsers.length > 0 && (
                                            <button onClick={() => handleCheckAll(food, action)} title={hoverTitle} style={{ fontSize: '12px', padding: '4px 8px', background: btnColor, border: 'none', borderRadius: '4px', cursor: 'pointer', minWidth: '45px' }}>{allBtnText}</button>
                                        )}
                                    </td>
                                    {displayedUsers.map((m, idx) => (
                                        <td key={m.id} className="cell-pad" onClick={() => handleToggle(m.id, food)} style={{ background: columnColors[idx % columnColors.length], borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #e2e8f0', cursor: 'pointer' }}>
                                            <input type="checkbox" checked={gridData[m.id]?.includes(food) || false} readOnly style={{ width: '22px', height: '22px', pointerEvents: 'none' }} />
                                        </td>
                                    ))}
                                </tr>
                                )
                            })}
                        </React.Fragment>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
EOF

echo "Writing client/src/GroupManager.jsx..."
cat << 'EOF' > client/src/GroupManager.jsx
import React, { useState } from 'react';

export default function GroupManager({ groups, token, impersonatingId, apiFetch, refreshTrigger }) {
    const [newGroupName, setNewGroupName] = useState('');
    const [createUsername, setCreateUsername] = useState('');
    const [createDisplayName, setCreateDisplayName] = useState('');
    const [createPassword, setCreatePassword] = useState('');
    const [linkCodeInput, setLinkCodeInput] = useState('');
    const [editingMemberId, setEditingMemberId] = useState(null);
    const [editMemberName, setEditMemberName] = useState('');

    const createGroup = async (e) => {
        e.preventDefault();
        const res = await apiFetch('/api/groups/create', token, impersonatingId, { method: 'POST', body: JSON.stringify({ name: newGroupName.trim() }) });
        const data = await res.json();
        if (data.success) { setNewGroupName(''); refreshTrigger(); alert("Group Created!"); } else alert(data.error);
    };

    const joinGroup = async (e) => {
        e.preventDefault();
        const res = await apiFetch('/api/groups/join', token, impersonatingId, { method: 'POST', body: JSON.stringify({ joinCode: linkCodeInput.trim() }) });
        const data = await res.json();
        if (data.success) { setLinkCodeInput(''); refreshTrigger(); alert("Joined Group!"); } else alert(data.error);
    };

    const createMemberInGroup = async (e, groupId) => {
        e.preventDefault();
        const res = await apiFetch(`/api/groups/${groupId}/create_user`, token, impersonatingId, { method: 'POST', body: JSON.stringify({ username: createUsername.trim(), displayName: createDisplayName.trim() || createUsername.trim(), password: createPassword }) });
        const data = await res.json();
        if (data.success) { setCreateUsername(''); setCreateDisplayName(''); setCreatePassword(''); refreshTrigger(); alert("Account Created!"); } else alert(data.error);
    };

    const saveMemberName = async (id) => {
        if (!editMemberName.trim()) return;
        await apiFetch(`/api/groups/member/${id}`, token, impersonatingId, { method: 'PUT', body: JSON.stringify({ displayName: editMemberName.trim() }) });
        setEditingMemberId(null); refreshTrigger();
    };

    const shiftColumn = async (groupId, membersArray, index, direction) => {
        const newArr = [...membersArray];
        if (direction === -1 && index > 0) [newArr[index - 1], newArr[index]] = [newArr[index], newArr[index - 1]];
        else if (direction === 1 && index < newArr.length - 1) [newArr[index + 1], newArr[index]] = [newArr[index], newArr[index + 1]];
        else return;
        await apiFetch(`/api/groups/${groupId}/reorder`, token, impersonatingId, { method: 'POST', body: JSON.stringify({ order: newArr.map(m => m.id) }) });
        refreshTrigger();
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '800px' }}>
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                <form onSubmit={createGroup} className="form-group">
                    <strong style={{ width: '100%' }}>Create a New Group:</strong>
                    <input type="text" placeholder="Group Name (e.g. LTS Workspace)" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} required className="form-input"/>
                    <button type="submit" className="form-btn" style={{ background: '#2563eb' }}>Create Group</button>
                </form>
                <form onSubmit={joinGroup} className="form-group">
                    <strong style={{ width: '100%' }}>Join Existing Group:</strong>
                    <input type="text" placeholder="Group PIN" value={linkCodeInput} onChange={e => setLinkCodeInput(e.target.value)} required className="form-input"/>
                    <button type="submit" className="form-btn" style={{ background: '#10b981' }}>Join Group</button>
                </form>
            </div>
            {groups.map(g => (
                <div key={g.id} style={{ background: 'white', padding: '15px', borderRadius: '8px', border: '2px solid #cbd5e1', marginBottom: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px', marginBottom: '15px' }}>
                        <h3 style={{ margin: 0 }}>{g.name}</h3>
                        <span style={{ background: '#fef3c7', padding: '6px 12px', borderRadius: '4px', border: '1px solid #fcd34d' }}><strong>Group PIN:</strong> {g.join_code}</span>
                    </div>
                    {g.members.map((m, idx) => (
                        <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px', marginBottom: '5px', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                            {editingMemberId === m.id ? (
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <input type="text" value={editMemberName} onChange={(e) => setEditMemberName(e.target.value)} className="form-input" style={{ width: '150px', padding: '4px' }} />
                                    <button onClick={() => saveMemberName(m.id)} style={{ padding: '4px 8px', background: '#10b981', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Save</button>
                                    <button onClick={() => setEditingMemberId(null)} style={{ padding: '4px 8px', background: '#64748b', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                    <span style={{ fontWeight: 'bold' }}>{m.name}</span>
                                    <button onClick={() => { setEditingMemberId(m.id); setEditMemberName(m.name); }} style={{ padding: '2px 8px', background: '#e2e8f0', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Edit Name</button>
                                </div>
                            )}
                            <div style={{ display: 'flex', gap: '4px' }}>
                                <button onClick={() => shiftColumn(g.id, g.members, idx, -1)} style={{ padding: '4px 8px', cursor: 'pointer', border: '1px solid #cbd5e1', background: 'white', borderRadius: '4px' }}>Up</button>
                                <button onClick={() => shiftColumn(g.id, g.members, idx, 1)} style={{ padding: '4px 8px', cursor: 'pointer', border: '1px solid #cbd5e1', background: 'white', borderRadius: '4px' }}>Down</button>
                            </div>
                        </div>
                    ))}
                    <form onSubmit={(e) => createMemberInGroup(e, g.id)} style={{ display: 'flex', gap: '8px', marginTop: '15px', padding: '10px', background: '#f1f5f9', borderRadius: '4px', flexWrap: 'wrap' }}>
                        <input type="text" placeholder="Username (Login ID)" value={createUsername} onChange={e => setCreateUsername(e.target.value)} required className="form-input"/>
                        <input type="text" placeholder="Display Name" value={createDisplayName} onChange={e => setCreateDisplayName(e.target.value)} className="form-input"/>
                        <input type="password" placeholder="Password" value={createPassword} onChange={e => setCreatePassword(e.target.value)} required className="form-input"/>
                        <button type="submit" className="form-btn" style={{ background: '#3b82f6' }}>Create Account</button>
                    </form>
                </div>
            ))}
        </div>
    );
}
EOF

echo "Writing client/src/AdminPanel.jsx..."
cat << 'EOF' > client/src/AdminPanel.jsx
import React from 'react';

export default function AdminPanel({ adminUsers, sysSettings, token, apiFetch, refreshTrigger, setImpersonatingUser }) {
    
    const adminAction = async (id, action, payload) => {
        if (action === 'impersonate') {
            setImpersonatingUser({ id: payload.id, name: payload.display_name, username: payload.username, role: payload.role });
            return;
        }
        if (action === 'delete' && !window.confirm("Permanently delete this user?")) return;
        const body = payload ? JSON.stringify({ role: payload }) : null;
        await apiFetch(`/api/admin/${action}/${id}`, token, null, { method: action === 'delete' ? 'DELETE' : 'POST', body });
        refreshTrigger();
    };
    
    const saveSetting = async (key, value) => {
        await apiFetch('/api/admin/settings', token, null, { method: 'PUT', body: JSON.stringify({ [key]: value }) });
        refreshTrigger();
    };
    
    const forceNewWeek = async () => {
        if (!window.confirm("Force create a new week right now?")) return;
        await apiFetch('/api/admin/force-week', token, null, { method: 'POST' });
        alert("New week created!"); refreshTrigger();
    };

    return (
        <>
            <div style={{ overflowX: 'auto', marginBottom: '30px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', background: 'white', border: '1px solid #e2e8f0' }}>
                    <thead><tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1' }}>
                        <th style={{ padding: '12px' }}>ID</th><th style={{ padding: '12px' }}>User</th><th style={{ padding: '12px' }}>Role</th><th style={{ padding: '12px' }}>Status</th><th style={{ padding: '12px' }}>Actions</th>
                    </tr></thead>
                    <tbody>{adminUsers.map(u => (
                        <tr key={u.id} style={{ borderBottom: '1px solid #e2e8f0', background: u.is_suspended ? '#fee2e2' : 'white' }}>
                            <td style={{ padding: '12px' }}>{u.id}</td>
                            <td style={{ padding: '12px' }}><strong>{u.display_name}</strong><br/><span style={{fontSize: '0.85em', color: '#64748b'}}>{u.username}</span></td>
                            <td style={{ padding: '12px' }}>
                                <select value={u.role} onChange={(e) => adminAction(u.id, 'role', e.target.value)} disabled={u.username === 'admin'} style={{ padding: '4px', borderRadius: '4px' }}>
                                    <option value="user">User</option><option value="parent">Parent</option>
                                    <option value="dietitian">Dietitian</option><option value="admin">Admin</option>
                                </select>
                            </td>
                            <td style={{ padding: '12px' }}>{u.is_suspended ? 'Suspended' : (u.locked_until && new Date(u.locked_until) > new Date() ? 'Locked' : 'Active')}</td>
                            <td style={{ padding: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                <button onClick={() => adminAction(u.id, 'impersonate', u)} style={{ padding: '6px 10px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Impersonate</button>
                                <button onClick={() => adminAction(u.id, 'suspend')} disabled={u.username === 'admin'} style={{ padding: '6px 10px', background: u.is_suspended ? '#10b981' : '#f59e0b', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>{u.is_suspended ? 'Unsuspend' : 'Suspend'}</button>
                                <button onClick={() => adminAction(u.id, 'delete')} disabled={u.username === 'admin'} style={{ padding: '6px 10px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Delete</button>
                            </td>
                        </tr>
                    ))}</tbody>
                </table>
            </div>
            <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0', maxWidth: '600px' }}>
                <h3 style={{ marginTop: 0 }}>Global System Settings</h3>
                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <strong>Week Rollover Day:</strong>
                        <select value={sysSettings.rollover_day || '0'} onChange={e => saveSetting('rollover_day', e.target.value)} className="form-input" style={{ minWidth: '150px' }}>
                            <option value="0">Sunday</option><option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option>
                        </select>
                    </label>
                    <button onClick={forceNewWeek} style={{ padding: '8px 16px', background: '#eab308', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', height: 'fit-content' }}>Force Start New Week Now</button>
                </div>
            </div>
        </>
    );
}
EOF

echo "Writing client/src/App.jsx..."
cat << 'EOF' > client/src/App.jsx
import React, { useState, useEffect } from 'react';
import { apiFetch } from './api';
import Auth from './Auth';
import TrackerGrid from './TrackerGrid';
import GroupManager from './GroupManager';
import AdminPanel from './AdminPanel';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [role, setRole] = useState(localStorage.getItem('role'));
  const [myName, setMyName] = useState(localStorage.getItem('name') || '');
  const [myUsername, setMyUsername] = useState(localStorage.getItem('username') || '');
  
  const [currentView, setCurrentView] = useState('tracker'); 
  const [searchTerm, setSearchTerm] = useState('');
  
  const [groups, setGroups] = useState([]);
  const [visibleGroupIds, setVisibleGroupIds] = useState([]);
  const [weeks, setWeeks] = useState([]);
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [gridData, setGridData] = useState({});
  const [adminUsers, setAdminUsers] = useState([]);
  const [sysSettings, setSysSettings] = useState({});
  const [categorizedFoods, setCategorizedFoods] = useState({});
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [setupNotice, setSetupNotice] = useState(false);
  
  const [impersonatingUser, setImpersonatingUser] = useState(null); 
  const activeRole = impersonatingUser ? impersonatingUser.role : role;
  const activeName = impersonatingUser ? impersonatingUser.name : myName;
  const activeUsername = impersonatingUser ? impersonatingUser.username : myUsername;
  
  const [profileName, setProfileName] = useState(activeName);
  const [profilePass, setProfilePass] = useState('');

  const hardReset = () => { localStorage.clear(); window.location.reload(); };

  useEffect(() => { fetch('/api/setup-status').then(r => r.json()).then(d => setSetupNotice(d.needsSetup)).catch(() => {}); }, []);

  useEffect(() => {
    if (token) {
        apiFetch('/api/foods', token, impersonatingUser?.id).then(r => r.json()).then(d => setCategorizedFoods(d)).catch(() => {});
        apiFetch('/api/weeks', token, impersonatingUser?.id)
            .then(r => { if (!r.ok) { hardReset(); throw new Error('Auth failed'); } return r.json(); })
            .then(data => { setWeeks(data); if (data.length > 0 && !selectedWeek) setSelectedWeek(data[0].id); })
            .catch(() => {});
    }
  }, [token, refreshTrigger, impersonatingUser]);

  useEffect(() => {
    if (!token || !selectedWeek) return;
    if (activeRole === 'admin' && currentView === 'admin' && !impersonatingUser) {
      apiFetch('/api/admin/users', token, null).then(r => r.ok ? r.json() : hardReset()).then(d => setAdminUsers(Array.isArray(d) ? d : [])).catch(hardReset);
      apiFetch('/api/admin/settings', token, null).then(r => r.json()).then(d => setSysSettings(d)).catch(() => {});
    } else {
      apiFetch(`/api/groups/grid?weekId=${selectedWeek}`, token, impersonatingUser?.id)
        .then(r => r.ok ? r.json() : hardReset())
        .then(d => { 
            if (d && !d.error) { 
                setGroups(d.groups || []); 
                setGridData(d.grid || {});
                setVisibleGroupIds((d.groups || []).map(g => g.id));
            } 
        }).catch(hardReset);
    }
  }, [token, activeRole, selectedWeek, currentView, refreshTrigger, impersonatingUser]);

  const setAuthData = (newToken, newRole, newName, newUsername) => {
      localStorage.setItem('token', newToken); localStorage.setItem('role', newRole); localStorage.setItem('name', newName); localStorage.setItem('username', newUsername);
      setToken(newToken); setRole(newRole); setMyName(newName); setMyUsername(newUsername); setProfileName(newName);
  };

  const updateProfile = async (e) => {
    e.preventDefault();
    const res = await apiFetch('/api/user/profile', token, impersonatingUser?.id, { method: 'PUT', body: JSON.stringify({ displayName: profileName, newPassword: profilePass || undefined }) });
    const data = await res.json();
    if (data.success) { 
        if (impersonatingUser) setImpersonatingUser(prev => ({...prev, name: data.name}));
        else { localStorage.setItem('name', data.name); setMyName(data.name); }
        setProfilePass(''); alert("Profile updated!"); setRefreshTrigger(p => p + 1); 
    }
  };

  const handleUpgrade = async () => {
    if (!window.confirm("Convert this account to a Group Manager?")) return;
    const res = await apiFetch('/api/user/upgrade', token, impersonatingUser?.id, { method: 'POST' });
    const data = await res.json();
    if (data.success) { 
        if (impersonatingUser) setImpersonatingUser(prev => ({...prev, role: data.role}));
        else { localStorage.setItem('role', data.role); setRole(data.role); }
    }
  };

  const handleDeleteSelf = async () => {
    if (!window.confirm("WARNING: This permanently deletes your account and data. Proceed?")) return;
    await apiFetch('/api/user/delete', token, impersonatingUser?.id, { method: 'DELETE' });
    if (impersonatingUser) { setImpersonatingUser(null); setRefreshTrigger(p => p+1); } else { hardReset(); }
  };

  if (!token) return <Auth setAuthData={setAuthData} setupNotice={setupNotice} />;

  const displayedUsers = [];
  const seenIds = new Set();
  groups.filter(g => visibleGroupIds.includes(g.id)).forEach(g => {
      g.members.forEach(m => { if (!seenIds.has(m.id)) { seenIds.add(m.id); displayedUsers.push(m); } });
  });

  const filteredCategories = Object.keys(categorizedFoods).reduce((acc, category) => {
    const filtered = categorizedFoods[category].filter(f => f.toLowerCase().includes(searchTerm.toLowerCase()));
    if (filtered.length > 0) acc[category] = filtered; return acc;
  }, {});

  return (
    <div className="app-container" style={{ fontFamily: 'system-ui', maxWidth: '1200px', margin: '0 auto', padding: '15px' }}>
      <style>{`
        .form-group { display: flex; gap: 8px; background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; borderRadius: 8px; flex-grow: 1; flex-wrap: wrap; align-items: center; }
        .form-input { padding: 8px; border-radius: 4px; border: 1px solid #cbd5e1; flex: 1 1 120px; }
        .form-btn { padding: 8px 16px; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; flex: 1 1 100%; }
        .nav-btn { padding: 8px 16px; border: none; background: none; cursor: pointer; font-weight: bold; color: #64748b; border-bottom: 2px solid transparent; }
        .nav-btn.active { color: #2563eb; border-bottom: 2px solid #2563eb; }
        .food-col { position: sticky; left: 0; z-index: 30; background: white; }
        .person-col { position: sticky; top: 0; z-index: 20; }
        .top-left-corner { position: sticky; top: 0; left: 0; z-index: 40; background: #f8fafc; }
        .cell-pad { padding: 10px 12px; position: relative; }
        .drag-handle { position: absolute; right: 0; top: 0; width: 15px; height: 100%; cursor: col-resize; z-index: 25; }
        .drag-handle:hover { background: rgba(0,0,0,0.05); }
        @media (max-width: 768px) {
          .app-container { padding: 10px; }
          .form-group { flex-direction: column; align-items: stretch; }
          .form-input { flex: 1 1 100%; width: 100%; box-sizing: border-box; }
          .cell-pad { padding: 8px 6px; font-size: 14px; }
        }
      `}</style>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '15px' }}>
        <div>
          <h2 style={{ margin: '0 0 4px 0' }}>Hi, {activeName} <span style={{fontSize: '16px', color: '#64748b', fontWeight: 'normal'}}>({activeUsername})</span></h2>
          {impersonatingUser && (
            <div style={{ background: '#fef08a', padding: '6px 12px', borderRadius: '4px', display: 'inline-block', marginBottom: '8px', border: '1px solid #fde047', fontSize: '14px' }}>
                <strong>Impersonating:</strong> {impersonatingUser.name} 
                <button onClick={() => { setImpersonatingUser(null); setProfileName(myName); setRefreshTrigger(p=>p+1); }} style={{ marginLeft: '10px', padding: '2px 8px', background: '#eab308', border: 'none', borderRadius: '4px', cursor: 'pointer', color: 'white' }}>Exit</button>
            </div>
          )}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button className={`nav-btn ${currentView === 'tracker' ? 'active' : ''}`} onClick={() => setCurrentView('tracker')}>Tracker</button>
            {(activeRole === 'parent' || activeRole === 'admin') && <button className={`nav-btn ${currentView === 'groups' ? 'active' : ''}`} onClick={() => setCurrentView('groups')}>Group Settings</button>}
            <button className={`nav-btn ${currentView === 'profile' ? 'active' : ''}`} onClick={() => setCurrentView('profile')}>Profile</button>
            <button className={`nav-btn ${currentView === 'about' ? 'active' : ''}`} onClick={() => setCurrentView('about')}>About</button>
            {!impersonatingUser && activeRole === 'admin' && <button className={`nav-btn ${currentView === 'admin' ? 'active' : ''}`} onClick={() => setCurrentView('admin')}>Admin</button>}
          </div>
        </div>
        <button onClick={hardReset} style={{ padding: '8px 16px', background: '#e2e8f0', color: '#334155', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Log Out</button>
      </div>

      {currentView === 'about' && (
        <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0', lineHeight: '1.6' }}>
          <h3>The Goal: 30 Plant-Based Foods a Week</h3>
          <p>Scientific research indicates that eating 30 or more different plant-based foods each week significantly diversifies the gut microbiome.</p>
        </div>
      )}

      {currentView === 'profile' && (
        <div style={{ maxWidth: '600px' }}>
          <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '20px' }}>
            <h3 style={{ marginTop: 0 }}>Update Profile</h3>
            <form onSubmit={updateProfile} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label><strong>Display Name:</strong> <input type="text" value={profileName} onChange={e => setProfileName(e.target.value)} required className="form-input" style={{ width: '100%', marginTop: '4px' }}/></label>
              <label><strong>New Password:</strong> <input type="password" placeholder="Leave blank to keep current password" value={profilePass} onChange={e => setProfilePass(e.target.value)} className="form-input" style={{ width: '100%', marginTop: '4px' }}/></label>
              <button type="submit" className="form-btn" style={{ background: '#2563eb' }}>Save Changes</button>
            </form>
          </div>
          <div style={{ background: '#fee2e2', padding: '20px', borderRadius: '8px', border: '1px solid #fca5a5' }}>
            <h3 style={{ marginTop: 0, color: '#991b1b' }}>Danger Zone</h3>
            <div style={{ display: 'flex', gap: '10px' }}>
              {activeRole === 'user' && <button onClick={handleUpgrade} style={{ padding: '8px 12px', background: '#8b5cf6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Upgrade to Group Manager</button>}
              <button onClick={handleDeleteSelf} style={{ padding: '8px 12px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Delete Account</button>
            </div>
          </div>
        </div>
      )}

      {currentView === 'groups' && (activeRole === 'parent' || activeRole === 'admin') && <GroupManager groups={groups} token={token} impersonatingId={impersonatingUser?.id} apiFetch={apiFetch} refreshTrigger={() => setRefreshTrigger(p=>p+1)} />}
      
      {currentView === 'admin' && !impersonatingUser && activeRole === 'admin' && <AdminPanel adminUsers={adminUsers} sysSettings={sysSettings} token={token} apiFetch={apiFetch} refreshTrigger={() => setRefreshTrigger(p=>p+1)} setImpersonatingUser={(u) => { setImpersonatingUser(u); setProfileName(u.name); setCurrentView('tracker'); }} />}

      {currentView === 'tracker' && (activeRole !== 'admin' || displayedUsers.length > 0) && (
        <>
          <div style={{ display: 'flex', gap: '15px', alignItems: 'center', marginBottom: '15px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', flexGrow: 1 }}>
                {groups.map(g => (
                    <button key={g.id} onClick={() => setVisibleGroupIds(prev => prev.includes(g.id) ? prev.filter(id => id !== g.id) : [...prev, g.id])} style={{ padding: '6px 12px', borderRadius: '20px', cursor: 'pointer', border: 'none', fontWeight: 'bold', fontSize: '14px', background: visibleGroupIds.includes(g.id) ? '#3b82f6' : '#e2e8f0', color: visibleGroupIds.includes(g.id) ? 'white' : '#64748b' }}>
                        {visibleGroupIds.includes(g.id) ? '✓ ' : '+ '} {g.name}
                    </button>
                ))}
            </div>
            <select value={selectedWeek || ''} onChange={(e) => setSelectedWeek(e.target.value)} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: 'white', fontWeight: 'bold' }}>
              {weeks.map((w, idx) => <option key={w.id} value={w.id}>{idx === 0 ? "Current Week" : "Week of " + w.week_start_date}</option>)}
            </select>
            <input type="text" placeholder="Search foods..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="form-input" style={{ maxWidth: '200px' }}/>
          </div>
          <TrackerGrid displayedUsers={displayedUsers} gridData={gridData} setGridData={setGridData} categorizedFoods={filteredCategories} activeRole={activeRole} impersonatingId={impersonatingUser?.id} selectedWeek={selectedWeek} apiFetch={apiFetch} token={token} />
        </>
      )}
    </div>
  );
}
EOF

echo "Refactor complete. Run ./update.sh to deploy."
