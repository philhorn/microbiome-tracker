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

// --- SECTION 2: DATABASE INITIALIZATION ---
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
    
    try { await db.exec("ALTER TABLE users ADD COLUMN is_suspended INTEGER DEFAULT 0;"); } catch (e) {}
    try { await db.exec("ALTER TABLE users ADD COLUMN failed_attempts INTEGER DEFAULT 0;"); } catch (e) {}
    try { await db.exec("ALTER TABLE users ADD COLUMN locked_until TEXT;"); } catch (e) {}

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
// --- END SECTION 2 ---

// --- SECTION 3: TRUE IMPERSONATION AUTH MIDDLEWARE ---
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
    if (existing) return res.status(400).json({ error: 'Username exists' });

    try { 
        const linkCode = crypto.randomInt(100000, 1000000).toString();
        const result = await db.run('INSERT INTO users (username, password, role, display_name, link_code) VALUES (?, ?, ?, ?, ?)', [lowerUsername, hash, role, displayName, linkCode]); 
        const joinCode = crypto.randomInt(100000, 1000000).toString();
        const groupRes = await db.run("INSERT INTO groups (name, join_code) VALUES ('My Group', ?)", [joinCode]);
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
        res.json({ token: jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET), id: user.id, username: user.username, role: user.role, name: user.display_name, link_code: user.link_code });
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
// --- END SECTION 4 ---

// --- SECTION 5: USER, GROUP & DATA ROUTES ---
app.get('/api/foods', authenticate, async (req, res) => {
    const rows = await db.all('SELECT name, category FROM foods ORDER BY category, name');
    const categorized = {};
    rows.forEach(r => { if (!categorized[r.category]) categorized[r.category] = []; categorized[r.category].push(r.name); });
    res.json(categorized);
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
    res.json({ success: true, role: user.role });
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

app.put('/api/groups/:groupId', authenticate, async (req, res) => {
    if (req.userRole !== 'parent' && req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    await db.run('UPDATE groups SET name = ? WHERE id = ?', [req.body.name, req.params.groupId]);
    res.json({ success: true });
});

app.delete('/api/groups/:groupId/member/:userId', authenticate, async (req, res) => {
    const targetId = parseInt(req.params.userId);
    if (req.userId !== targetId && req.userRole !== 'parent' && req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    await db.run('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', [req.params.groupId, targetId]);
    res.json({ success: true });
});

app.post('/api/groups/:groupId/add_users_bulk', authenticate, async (req, res) => {
    if (req.userRole !== 'parent' && req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    
    const users = req.body.users || [];
    let added = 0;
    let errors = [];

    for (let u of users) {
        const targetUsername = (u.username || '').trim().toLowerCase();
        const targetPin = (u.linkCode || '').trim();
        if (!targetUsername || !targetPin) continue;

        const target = await db.get('SELECT id FROM users WHERE LOWER(username) = ? AND link_code = ?', [targetUsername, targetPin]);
        if (!target) {
            errors.push(`${targetUsername} (Invalid)`);
            continue;
        }

        const exists = await db.get('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?', [req.params.groupId, target.id]);
        if (!exists) {
            await db.run('INSERT INTO group_members (group_id, user_id, sort_order) VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM group_members WHERE group_id = ?))', [req.params.groupId, target.id, req.params.groupId]);
            added++;
        } else {
            errors.push(`${targetUsername} (Already in group)`);
        }
    }
    res.json({ success: true, added, errors });
});

app.post('/api/groups/:groupId/create_user', authenticate, async (req, res) => {
    if (req.userRole !== 'parent' && req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    const access = await db.get('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?', [req.params.groupId, req.userId]);
    if (!access) return res.status(403).json({error: 'Denied'});
    const lowerUsername = req.body.username.toLowerCase();
    const existing = await db.get('SELECT id FROM users WHERE LOWER(username) = ?', [lowerUsername]);
    if (existing) return res.status(400).json({ error: 'Username exists' });

    try {
        const linkCode = crypto.randomInt(100000, 1000000).toString();
        const result = await db.run('INSERT INTO users (username, password, role, display_name, link_code) VALUES (?, ?, ?, ?, ?)', [lowerUsername, await bcrypt.hash(req.body.password, 10), 'user', req.body.displayName || rawUsername, linkCode]);
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
// --- END SECTION 5 ---

// --- SECTION 6: ADMIN ROUTES & SCHEDULER ---
app.get('/api/admin/users', authenticate, async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    res.json(await db.all(`SELECT id, username, display_name, role, link_code, is_suspended, failed_attempts, locked_until FROM users`));
});

// GLOBAL USER PROVISIONING
app.post('/api/admin/create_user', authenticate, async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    const rawUsername = req.body.username;
    if (!rawUsername) return res.status(400).json({ error: 'Username required' });
    const lowerUsername = rawUsername.toLowerCase();
    const displayName = req.body.displayName || rawUsername;
    const hash = await bcrypt.hash(req.body.password, 10);
    const role = req.body.role || 'user';
    
    const existing = await db.get('SELECT id FROM users WHERE LOWER(username) = ?', [lowerUsername]);
    if (existing) return res.status(400).json({ error: 'Username already exists' });

    try {
        const linkCode = crypto.randomInt(100000, 1000000).toString();
        await db.run('INSERT INTO users (username, password, role, display_name, link_code) VALUES (?, ?, ?, ?, ?)', [lowerUsername, hash, role, displayName, linkCode]);
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: 'Error' }); }
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
// --- END SECTION 6 ---