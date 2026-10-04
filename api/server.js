// --- SECTION 1: IMPORTS AND SETUP ---
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
// --- END SECTION 1 ---

// --- SECTION 2: DATABASE INITIALIZATION & MIGRATION ---
let db;
(async () => {
    db = await open({ filename: path.join(__dirname, 'database.sqlite'), driver: sqlite3.Database });
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT DEFAULT 'user', family_id INTEGER, display_name TEXT, link_code TEXT, sort_order INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS active_week (id INTEGER PRIMARY KEY AUTOINCREMENT, week_start_date TEXT);
        CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, week_id INTEGER, food_item TEXT, FOREIGN KEY(user_id) REFERENCES users(id));
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
        INSERT INTO active_week (id, week_start_date) SELECT 1, date('now', 'localtime', '-7 days') WHERE NOT EXISTS (SELECT 1 FROM active_week WHERE id = 1);
        INSERT OR IGNORE INTO settings (key, value) VALUES ('max_attempts', '5'), ('lockout_mins', '15'), ('rollover_day', '0');
    `);
    
    try { await db.exec("ALTER TABLE users ADD COLUMN is_suspended INTEGER DEFAULT 0;"); } catch (e) {}
    try { await db.exec("ALTER TABLE users ADD COLUMN failed_attempts INTEGER DEFAULT 0;"); } catch (e) {}
    try { await db.exec("ALTER TABLE users ADD COLUMN locked_until TEXT;"); } catch (e) {}

    // Auto-Migrate to Multi-Group Architecture
    const groupCheck = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='groups'");
    if (!groupCheck) {
        await db.exec(`
            CREATE TABLE groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, join_code TEXT UNIQUE);
            CREATE TABLE group_members (group_id INTEGER, user_id INTEGER, sort_order INTEGER DEFAULT 0, PRIMARY KEY(group_id, user_id));
        `);
        // Move existing family connections into distinct groups to preserve data
        await db.exec(`
            INSERT INTO groups (id, name, join_code) SELECT DISTINCT family_id, 'Family Group', abs(random() % 900000) + 100000 FROM users WHERE family_id IS NOT NULL;
            INSERT INTO group_members (group_id, user_id, sort_order) SELECT family_id, id, sort_order FROM users WHERE family_id IS NOT NULL;
        `);
    }

    const adminExists = await db.get("SELECT 1 FROM users WHERE role = 'admin'");
    if (!adminExists) {
        const tempPassword = crypto.randomBytes(6).toString('hex');
        const adminHash = await bcrypt.hash(tempPassword, 10);
        await db.exec(`INSERT INTO users (username, password, role, display_name) VALUES ('admin', '${adminHash}', 'admin', 'System Admin')`);
        
        const credText = `INITIAL SYSTEM SETUP\n--------------------\nUsername: admin\nTemporary Password: ${tempPassword}\n\nPlease log into the web interface and change this password immediately in the Profile tab. This file will be securely deleted once the password is changed.\n`;
        fs.writeFileSync(ADMIN_CRED_FILE, credText, { mode: 0o600 });
    }
    try { fs.chmodSync(path.join(__dirname, 'database.sqlite'), 0o600); } catch(e) {}
})();
// --- END SECTION 2 ---

// --- SECTION 3: AUTH MIDDLEWARE ---
const authenticate = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    jwt.verify(token, SECRET, async (err, decoded) => {
        if (err) return res.status(403).json({ error: 'Forbidden' });
        const user = await db.get('SELECT is_suspended FROM users WHERE id = ?', [decoded.id]);
        if (!user || user.is_suspended) return res.status(403).json({ error: 'Account is suspended or deleted.' });
        req.userId = decoded.id; req.userRole = decoded.role; next();
    });
};
// --- END SECTION 3 ---

// --- SECTION 4: PUBLIC & AUTH ROUTES ---
app.get('/api/setup-status', (req, res) => { res.json({ needsSetup: fs.existsSync(ADMIN_CRED_FILE) }); });

app.post('/api/register', registerLimiter, async (req, res) => {
    const rawUsername = req.body.username;
    if (!rawUsername) return res.status(400).json({ error: 'Username required' });
    const lowerUsername = rawUsername.toLowerCase();
    const displayName = req.body.displayName || rawUsername;
    const hash = await bcrypt.hash(req.body.password, 10);
    const role = req.body.isParent ? 'parent' : 'user';
    
    const existing = await db.get('SELECT id FROM users WHERE LOWER(username) = ?', [lowerUsername]);
    if (existing) return res.status(400).json({ error: 'Username already exists' });

    try { 
        const result = await db.run('INSERT INTO users (username, password, role, display_name) VALUES (?, ?, ?, ?)', [lowerUsername, hash, role, displayName]); 
        
        // Give them a default private group
        const joinCode = crypto.randomInt(100000, 1000000).toString();
        const groupRes = await db.run("INSERT INTO groups (name, join_code) VALUES ('My Group', ?)", [joinCode]);
        await db.run("INSERT INTO group_members (group_id, user_id, sort_order) VALUES (?, ?, 0)", [groupRes.lastID, result.lastID]);
        
        res.json({ success: true }); 
    } catch (e) { res.status(400).json({ error: 'Database error' }); }
});

app.post('/api/login', async (req, res) => {
    if (!req.body.username) return res.status(400).json({ error: 'Username required' });
    const lowerUsername = req.body.username.toLowerCase();
    const user = await db.get('SELECT * FROM users WHERE LOWER(username) = ?', [lowerUsername]);
    
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.is_suspended) return res.status(403).json({ error: 'Account suspended' });
    
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
        return res.status(403).json({ error: 'Account temporarily locked. Try again later.' });
    }

    if (await bcrypt.compare(req.body.password, user.password)) {
        await db.run('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', [user.id]);
        res.json({ token: jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET), id: user.id, username: user.username, role: user.role, name: user.display_name });
    } else { 
        const attempts = (user.failed_attempts || 0) + 1;
        let lockedUntil = null;
        const limitSettings = await db.get("SELECT value FROM settings WHERE key = 'max_attempts'");
        const maxAttempts = limitSettings ? parseInt(limitSettings.value) : 5;
        
        if (attempts >= maxAttempts) {
            const minSettings = await db.get("SELECT value FROM settings WHERE key = 'lockout_mins'");
            const lockoutMins = minSettings ? parseInt(minSettings.value) : 15;
            lockedUntil = new Date(Date.now() + lockoutMins * 60000).toISOString();
        }
        await db.run('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?', [attempts, lockedUntil, user.id]);
        res.status(401).json({ error: lockedUntil ? 'Account locked due to too many failed attempts.' : 'Invalid credentials' }); 
    }
});
// --- END SECTION 4 ---

// --- SECTION 5: USER & MULTI-GROUP ROUTES ---
app.put('/api/user/profile', authenticate, async (req, res) => {
    const { displayName, newPassword } = req.body;
    if (displayName) await db.run('UPDATE users SET display_name = ? WHERE id = ?', [displayName, req.userId]);
    if (newPassword) {
        const hash = await bcrypt.hash(newPassword, 10);
        await db.run('UPDATE users SET password = ? WHERE id = ?', [hash, req.userId]);
        if (req.userRole === 'admin' && fs.existsSync(ADMIN_CRED_FILE)) fs.unlinkSync(ADMIN_CRED_FILE);
    }
    const user = await db.get('SELECT username, role, display_name FROM users WHERE id = ?', [req.userId]);
    res.json({ success: true, name: user.display_name });
});

app.post('/api/user/upgrade', authenticate, async (req, res) => {
    if (req.userRole !== 'user') return res.status(400).json({ error: 'Already upgraded' });
    await db.run("UPDATE users SET role = 'parent' WHERE id = ?", [req.userId]);
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.userId]);
    res.json({ success: true, token: jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET), role: user.role });
});

app.delete('/api/user/delete', authenticate, async (req, res) => {
    if (req.userRole === 'admin') return res.status(403).json({ error: 'Cannot delete admin' });
    await db.run('DELETE FROM group_members WHERE user_id = ?', [req.userId]);
    await db.run('DELETE FROM logs WHERE user_id = ?', [req.userId]);
    await db.run('DELETE FROM users WHERE id = ?', [req.userId]);
    res.json({ success: true });
});

app.get('/api/weeks', authenticate, async (req, res) => {
    const weeks = await db.all('SELECT id, week_start_date FROM active_week ORDER BY id DESC');
    res.json(weeks);
});

// CORE: Fetch all groups the user belongs to, including members and logs
app.get('/api/groups/grid', authenticate, async (req, res) => {
    const weekId = req.query.weekId || (await db.get('SELECT MAX(id) as id FROM active_week')).id;
    let targetUserId = req.userId;
    if (req.userRole === 'admin' && req.query.impersonate) targetUserId = parseInt(req.query.impersonate);

    // Get all groups this user is in
    const myGroups = await db.all('SELECT group_id FROM group_members WHERE user_id = ?', [targetUserId]);
    if (!myGroups.length) return res.json({ groups: [], grid: {} });
    
    const groupIds = myGroups.map(g => g.group_id);
    const groups = await db.all(`SELECT id, name, join_code FROM groups WHERE id IN (${groupIds.join(',')})`);
    
    const members = await db.all(`
        SELECT gm.group_id, u.id, u.display_name as name, gm.sort_order 
        FROM group_members gm 
        JOIN users u ON gm.user_id = u.id 
        WHERE gm.group_id IN (${groupIds.join(',')}) 
        ORDER BY gm.group_id, gm.sort_order ASC, u.id ASC
    `);

    const formattedGroups = groups.map(g => ({
        ...g,
        members: members.filter(m => m.group_id === g.id)
    }));

    const uniqueUserIds = [...new Set(members.map(m => m.id))];
    const placeholders = uniqueUserIds.map(() => '?').join(',');
    const logs = uniqueUserIds.length > 0 ? await db.all(`SELECT user_id, food_item FROM logs WHERE week_id = ? AND user_id IN (${placeholders})`, [weekId, ...uniqueUserIds]) : [];
    
    const grid = {}; uniqueUserIds.forEach(id => grid[id] = []);
    logs.forEach(l => grid[l.user_id].push(l.food_item));
    
    res.json({ groups: formattedGroups, grid });
});

app.post('/api/groups/create', authenticate, async (req, res) => {
    if (req.userRole !== 'parent' && req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    const { name } = req.body;
    const joinCode = crypto.randomInt(100000, 1000000).toString();
    const result = await db.run('INSERT INTO groups (name, join_code) VALUES (?, ?)', [name, joinCode]);
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

// Create user directly inside a specific group
app.post('/api/groups/:groupId/create_user', authenticate, async (req, res) => {
    if (req.userRole !== 'parent' && req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    
    // Verify caller is in this group
    const access = await db.get('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?', [req.params.groupId, req.userId]);
    if (!access) return res.status(403).json({error: 'Denied'});

    const rawUsername = req.body.username;
    if (!rawUsername) return res.status(400).json({ error: 'Username required' });
    const lowerUsername = rawUsername.toLowerCase();
    const displayName = req.body.displayName || rawUsername;
    const hash = await bcrypt.hash(req.body.password, 10);
    
    const existing = await db.get('SELECT id FROM users WHERE LOWER(username) = ?', [lowerUsername]);
    if (existing) return res.status(400).json({ error: 'Username already exists' });

    try {
        const result = await db.run('INSERT INTO users (username, password, role, display_name) VALUES (?, ?, ?, ?)', [lowerUsername, hash, 'user', displayName]);
        await db.run('INSERT INTO group_members (group_id, user_id, sort_order) VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM group_members WHERE group_id = ?))', [req.params.groupId, result.lastID, req.params.groupId]);
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: 'Error creating user' }); }
});

app.put('/api/groups/member/:id', authenticate, async (req, res) => {
    if (req.userRole !== 'parent' && req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    await db.run('UPDATE users SET display_name = ? WHERE id = ?', [req.body.displayName, req.params.id]);
    res.json({ success: true });
});

app.post('/api/groups/:groupId/reorder', authenticate, async (req, res) => {
    if (req.userRole !== 'parent' && req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    const { order } = req.body;
    for (let i = 0; i < order.length; i++) {
        await db.run('UPDATE group_members SET sort_order = ? WHERE user_id = ? AND group_id = ?', [i, order[i], req.params.groupId]);
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
// --- END SECTION 5 ---

// --- SECTION 6: ADMIN ROUTES & SCHEDULER ---
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
    const rows = await db.all('SELECT key, value FROM settings');
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    res.json(settings);
});

app.put('/api/admin/settings', authenticate, async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    for (const [key, value] of Object.entries(req.body)) {
        await db.run('UPDATE settings SET value = ? WHERE key = ?', [value, key]);
    }
    res.json({ success: true });
});

app.post('/api/admin/force-week', authenticate, async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    await db.run("INSERT INTO active_week (week_start_date) VALUES (date('now', 'localtime'))");
    res.json({ success: true });
});

cron.schedule('1 0 * * *', async () => {
    const setting = await db.get("SELECT value FROM settings WHERE key = 'rollover_day'");
    const rolloverDay = setting ? parseInt(setting.value) : 0;
    if (new Date().getDay() === rolloverDay) {
        await db.run("INSERT INTO active_week (week_start_date) VALUES (date('now', 'localtime'))");
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`API running on port ${PORT}`));
// --- END SECTION 6 ---