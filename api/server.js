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