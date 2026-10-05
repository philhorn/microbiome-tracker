import express from 'express';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cron from 'node-cron';
import pkg from 'pg';
const { Pool } = pkg;
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import { exec } from 'child_process';
import * as dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3001;
const SECRET = crypto.randomBytes(32).toString('hex');
const ADMIN_CRED_FILE = path.join(__dirname, 'admin_credentials.txt');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));
app.set('trust proxy', 1);

const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });

// --- POSTGRESQL ENGINE ---
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const query = async (text, params = []) => {
    let i = 1;
    const pgText = text.replace(/\?/g, () => `$${i++}`);
    return await pool.query(pgText, params);
};

const db = {
    get: async (text, params) => (await query(text, params)).rows[0],
    all: async (text, params) => (await query(text, params)).rows,
    run: async (text, params) => await query(text, params),
    runReturnId: async (text, params) => {
        const res = await query(`${text} RETURNING id`, params);
        return { lastID: res.rows[0].id };
    },
    exec: async (text) => await pool.query(text)
};

(async () => {
    try {
        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username TEXT UNIQUE, password TEXT, role TEXT DEFAULT 'user', family_id INTEGER, display_name TEXT, link_code TEXT, sort_order INTEGER DEFAULT 0, is_suspended INTEGER DEFAULT 0, failed_attempts INTEGER DEFAULT 0, locked_until TEXT);
            CREATE TABLE IF NOT EXISTS active_week (id SERIAL PRIMARY KEY, week_start_date DATE);
            CREATE TABLE IF NOT EXISTS logs (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), week_id INTEGER, food_item TEXT, group_id INTEGER);
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE IF NOT EXISTS groups (id SERIAL PRIMARY KEY, name TEXT, join_code TEXT UNIQUE, isolate_tracker INTEGER DEFAULT 0, app_name TEXT, theme_color TEXT);
            CREATE TABLE IF NOT EXISTS group_members (group_id INTEGER, user_id INTEGER, sort_order INTEGER DEFAULT 0, PRIMARY KEY(group_id, user_id));
            CREATE TABLE IF NOT EXISTS foods (id SERIAL PRIMARY KEY, name TEXT, category TEXT, group_id INTEGER);
            
            INSERT INTO active_week (week_start_date) SELECT CURRENT_DATE - INTERVAL '7 days' WHERE NOT EXISTS (SELECT 1 FROM active_week WHERE id = 1);
            
            INSERT INTO settings (key, value) VALUES 
                ('max_attempts', '5'), ('lockout_mins', '15'), ('rollover_day', '0'), ('app_name', 'Microbiome Tracker'), ('theme_color', '#ef4444')
            ON CONFLICT (key) DO NOTHING;
        `);

        const foodCount = await db.get("SELECT COUNT(*) as c FROM foods");
        if (parseInt(foodCount.c) === 0) {
            const defaultFoods = {
                "Vegetables": ["Artichokes", "Arugula", "Asparagus", "Broccoli", "Carrots", "Cauliflower", "Kale", "Spinach"],
                "Fruits": ["Apples", "Avocado", "Bananas", "Blueberries", "Strawberries"],
                "Nuts & Seeds": ["Almonds", "Chia Seeds", "Walnuts"],
                "Legumes": ["Black Beans", "Chickpeas", "Lentils"],
                "Grains": ["Brown Rice", "Oats", "Quinoa"],
                "Fermented & Other": ["Kefir", "Kimchi", "Kombucha", "Yogurt"]
            };
            for (const [cat, items] of Object.entries(defaultFoods)) {
                for (const item of items) await db.run("INSERT INTO foods (name, category, group_id) VALUES (?, ?, NULL)", [item, cat]);
            }
        }

        const adminExists = await db.get("SELECT 1 FROM users WHERE role = 'admin'");
        if (!adminExists) {
            const tempPassword = crypto.randomBytes(6).toString('hex');
            const adminHash = await bcrypt.hash(tempPassword, 10);
            await db.run(`INSERT INTO users (username, password, role, display_name) VALUES ('admin', ?, 'admin', 'System Admin')`, [adminHash]);
            fs.writeFileSync(ADMIN_CRED_FILE, `INITIAL SYSTEM SETUP\nUsername: admin\nTemporary Password: ${tempPassword}\n\nLog in and change immediately.\n`, { mode: 0o600 });
        }
        console.log("PostgreSQL Database Connected & Initialized");
    } catch (err) { console.error("Database Init Error:", err); }
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

app.post('/api/webhook', (req, res) => {
    const authHeader = req.headers['x-github-event'];
    if (!authHeader) return res.status(403).send('Denied');
    res.status(200).send('Build triggered');
    exec('bash ../deploy-app.sh', (err, stdout, stderr) => {
        if (err) console.error(`Deployment failed: ${err}`);
        else console.log(`Deployment successful:\n${stdout}`);
    });
});

app.get('/api/setup-status', (req, res) => { res.json({ needsSetup: fs.existsSync(ADMIN_CRED_FILE) }); });

app.get('/api/public-config', async (req, res) => {
    const settings = {};
    (await db.all("SELECT key, value FROM settings WHERE key IN ('app_name', 'theme_color')")).forEach(r => settings[r.key] = r.value);
    res.json({ appName: settings.app_name || 'Microbiome Tracker', themeColor: settings.theme_color || '#ef4444' });
});

app.post('/api/register', registerLimiter, async (req, res) => {
    const rawUsername = req.body.username;
    if (!rawUsername) return res.status(400).json({ error: 'Username required' });
    const lowerUsername = rawUsername.toLowerCase();
    const hash = await bcrypt.hash(req.body.password, 10);
    if (await db.get('SELECT id FROM users WHERE LOWER(username) = ?', [lowerUsername])) return res.status(400).json({ error: 'Username exists' });

    try { 
        const linkCode = crypto.randomInt(100000, 1000000).toString();
        const userRes = await db.runReturnId('INSERT INTO users (username, password, role, display_name, link_code) VALUES (?, ?, ?, ?, ?)', [lowerUsername, hash, req.body.isParent ? 'parent' : 'user', req.body.displayName || rawUsername, linkCode]); 
        const joinCode = crypto.randomInt(100000, 1000000).toString();
        const groupRes = await db.runReturnId("INSERT INTO groups (name, join_code) VALUES ('My Group', ?)", [joinCode]);
        await db.run("INSERT INTO group_members (group_id, user_id, sort_order) VALUES (?, ?, 0)", [groupRes.lastID, userRes.lastID]);
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

app.get('/api/lists', authenticate, async (req, res) => { res.json(await db.all('SELECT id, name, category, group_id FROM foods ORDER BY group_id, category, name')); });

app.post('/api/lists/manage', authenticate, async (req, res) => {
    if (req.userRole !== 'admin' && req.userRole !== 'dietitian' && req.userRole !== 'parent') return res.status(403).json({error: 'Denied'});
    const { action, name, category, oldName, group_id } = req.body;
    if (group_id === null && req.userRole !== 'admin') return res.status(403).json({error: 'Only admins can modify global templates.'});

    try {
        if (action === 'add') { await db.run('INSERT INTO foods (name, category, group_id) VALUES (?, ?, ?)', [name.trim(), category.trim(), group_id]); }
        else if (action === 'edit') {
            await db.run('UPDATE foods SET name = ?, category = ? WHERE name = ? AND (group_id = ? OR (group_id IS NULL AND ? IS NULL))', [name.trim(), category.trim(), oldName, group_id, group_id]);
            await db.run('UPDATE logs SET food_item = ? WHERE food_item = ?', [name.trim(), oldName]);
        } else if (action === 'delete') {
            await db.run('DELETE FROM foods WHERE name = ? AND (group_id = ? OR (group_id IS NULL AND ? IS NULL))', [name, group_id, group_id]);
            await db.run('DELETE FROM logs WHERE food_item = ?', [name]);
        }
        res.json({ success: true });
    } catch(e) { res.status(400).json({ error: 'Database error' }); }
});

app.post('/api/lists/category', authenticate, async (req, res) => {
    if (req.userRole !== 'admin' && req.userRole !== 'dietitian' && req.userRole !== 'parent') return res.status(403).json({error: 'Denied'});
    const { action, oldCategory, newCategory, group_id } = req.body;
    if (group_id === null && req.userRole !== 'admin') return res.status(403).json({error: 'Only admins can modify global templates.'});

    try {
        if (action === 'rename') {
            await db.run('UPDATE foods SET category = ? WHERE category = ? AND (group_id = ? OR (group_id IS NULL AND ? IS NULL))', [newCategory.trim(), oldCategory, group_id, group_id]);
        } else if (action === 'delete') {
            await db.run('DELETE FROM foods WHERE category = ? AND (group_id = ? OR (group_id IS NULL AND ? IS NULL))', [oldCategory, group_id, group_id]);
            await db.run('DELETE FROM logs WHERE food_item IN (SELECT name FROM foods WHERE category = ? AND (group_id = ? OR (group_id IS NULL AND ? IS NULL)))', [oldCategory, group_id, group_id]);
        }
        res.json({ success: true });
    } catch(e) { res.status(400).json({ error: 'Database error' }); }
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
    res.json({ success: true, role: (await db.get('SELECT role FROM users WHERE id = ?', [req.userId])).role });
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
        const groupRes = await db.runReturnId("INSERT INTO groups (name, join_code) VALUES ('My Workspace', ?)", [joinCode]);
        await db.run("INSERT INTO group_members (group_id, user_id, sort_order) VALUES (?, ?, 0)", [groupRes.lastID, req.userId]);
        myGroups = [{ group_id: groupRes.lastID }];
    }
    
    const groupIds = myGroups.map(g => g.group_id);
    const groups = await db.all(`SELECT id, name, join_code, isolate_tracker, app_name, theme_color FROM groups WHERE id = ANY($1::int[])`, [groupIds]);
    const members = await db.all(`SELECT gm.group_id, u.id, u.display_name as name, gm.sort_order FROM group_members gm JOIN users u ON gm.user_id = u.id WHERE gm.group_id = ANY($1::int[]) ORDER BY gm.group_id, gm.sort_order ASC, u.id ASC`, [groupIds]);
    
    const formattedGroups = groups.map(g => ({ ...g, members: members.filter(m => m.group_id === g.id) }));

    const grid = {}; 
    formattedGroups.forEach(g => {
        grid[g.id] = {};
        g.members.forEach(m => grid[g.id][m.id] = []);
    });

    const uniqueUserIds = [...new Set(members.map(m => m.id))];
    const logs = uniqueUserIds.length > 0 ? await db.all(`SELECT user_id, food_item, group_id FROM logs WHERE week_id = $1 AND user_id = ANY($2::int[])`, [weekId, uniqueUserIds]) : [];
    
    logs.forEach(l => {
        formattedGroups.forEach(g => {
            if (grid[g.id] && grid[g.id][l.user_id] !== undefined) {
                if (l.group_id === null && g.isolate_tracker === 0) {
                    grid[g.id][l.user_id].push(l.food_item);
                } else if (l.group_id === g.id) {
                    grid[g.id][l.user_id].push(l.food_item);
                }
            }
        });
    });

    res.json({ groups: formattedGroups, grid });
});

app.post('/api/groups/create', authenticate, async (req, res) => {
    if (req.userRole !== 'parent' && req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    const result = await db.runReturnId('INSERT INTO groups (name, join_code) VALUES (?, ?)', [req.body.name, crypto.randomInt(100000, 1000000).toString()]);
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
    await db.run('UPDATE groups SET name = ?, app_name = ?, theme_color = ? WHERE id = ?', [req.body.name, req.body.appName, req.body.themeColor, req.params.groupId]);
    res.json({ success: true });
});

app.put('/api/groups/:groupId/mode', authenticate, async (req, res) => {
    if (req.userRole !== 'parent' && req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    await db.run('UPDATE groups SET isolate_tracker = ? WHERE id = ?', [req.body.isolated ? 1 : 0, req.params.groupId]);
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
    let added = 0; let errors = [];
    for (let u of users) {
        const tUser = (u.username || '').trim().toLowerCase(); const tPin = (u.linkCode || '').trim();
        if (!tUser || !tPin) continue;
        const target = await db.get('SELECT id FROM users WHERE LOWER(username) = ? AND link_code = ?', [tUser, tPin]);
        if (!target) { errors.push(`${tUser} (Invalid)`); continue; }
        const exists = await db.get('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?', [req.params.groupId, target.id]);
        if (!exists) { await db.run('INSERT INTO group_members (group_id, user_id, sort_order) VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM group_members WHERE group_id = ?))', [req.params.groupId, target.id, req.params.groupId]); added++; } 
        else { errors.push(`${tUser} (Already in group)`); }
    }
    res.json({ success: true, added, errors });
});

app.post('/api/groups/:groupId/create_user', authenticate, async (req, res) => {
    if (req.userRole !== 'parent' && req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    const lowerUsername = req.body.username.toLowerCase();
    if (await db.get('SELECT id FROM users WHERE LOWER(username) = ?', [lowerUsername])) return res.status(400).json({ error: 'Username exists' });
    try {
        const linkCode = crypto.randomInt(100000, 1000000).toString();
        const result = await db.runReturnId('INSERT INTO users (username, password, role, display_name, link_code) VALUES (?, ?, ?, ?, ?)', [lowerUsername, await bcrypt.hash(req.body.password, 10), 'user', req.body.displayName || rawUsername, linkCode]);
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
    const { groupId, item, checked } = req.body;
    
    const group = await db.get('SELECT isolate_tracker FROM groups WHERE id = ?', [groupId]);
    const food = await db.get('SELECT group_id FROM foods WHERE name = ?', [item]);
    
    let targetGroupId = groupId;
    if (food && food.group_id === null && group && group.isolate_tracker === 0) {
        targetGroupId = null; // Sync Globally!
    }
    
    if (checked) {
        const q = targetGroupId === null ? 'group_id IS NULL' : 'group_id = ?';
        const params = targetGroupId === null ? [req.params.targetId, weekId, item] : [req.params.targetId, weekId, item, targetGroupId];
        const exists = await db.get(`SELECT 1 FROM logs WHERE user_id = $1 AND week_id = $2 AND food_item = $3 AND ${q}`, params);
        if (!exists) await db.run('INSERT INTO logs (user_id, week_id, food_item, group_id) VALUES (?, ?, ?, ?)', [req.params.targetId, weekId, item, targetGroupId]);
    } else {
        if (targetGroupId === null) await db.run('DELETE FROM logs WHERE user_id = ? AND week_id = ? AND food_item = ? AND group_id IS NULL', [req.params.targetId, weekId, item]);
        else await db.run('DELETE FROM logs WHERE user_id = ? AND week_id = ? AND food_item = ? AND group_id = ?', [req.params.targetId, weekId, item, targetGroupId]);
    }
    res.json({ success: true });
});

app.get('/api/admin/users', authenticate, async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    res.json(await db.all(`SELECT id, username, display_name, role, link_code, is_suspended, failed_attempts, locked_until FROM users`));
});

app.post('/api/admin/create_user', authenticate, async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    if (await db.get('SELECT id FROM users WHERE LOWER(username) = ?', [req.body.username.toLowerCase()])) return res.status(400).json({ error: 'Username already exists' });
    try {
        await db.run('INSERT INTO users (username, password, role, display_name, link_code) VALUES (?, ?, ?, ?, ?)', [req.body.username.toLowerCase(), await bcrypt.hash(req.body.password, 10), req.body.role || 'user', req.body.displayName || req.body.username, crypto.randomInt(100000, 1000000).toString()]);
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
    if ((await db.get('SELECT username FROM users WHERE id = ?', [req.params.id]))?.username === 'admin') return res.status(403).json({error: 'Cannot modify master admin'});
    await db.run('UPDATE users SET role = ? WHERE id = ?', [req.body.role, req.params.id]);
    res.json({ success: true });
});

app.delete('/api/admin/delete/:id', authenticate, async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    if ((await db.get('SELECT username FROM users WHERE id = ?', [req.params.id]))?.username === 'admin') return res.status(403).json({error: 'Cannot delete master admin'});
    await db.run('DELETE FROM group_members WHERE user_id = ?', [req.params.id]);
    await db.run('DELETE FROM logs WHERE user_id = ?', [req.params.id]);
    await db.run('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ success: true });
});

app.get('/api/admin/settings', authenticate, async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    const settings = {}; (await db.all('SELECT key, value FROM settings')).forEach(r => settings[r.key] = r.value);
    res.json(settings);
});

app.put('/api/admin/settings', authenticate, async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    for (const [key, value] of Object.entries(req.body)) {
        await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, value]);
    }
    res.json({ success: true });
});

app.post('/api/admin/force-week', authenticate, async (req, res) => {
    if (req.userRole !== 'admin') return res.status(403).json({error: 'Denied'});
    await db.run("INSERT INTO active_week (week_start_date) VALUES (CURRENT_DATE)");
    res.json({ success: true });
});

cron.schedule('1 0 * * *', async () => {
    const setting = await db.get("SELECT value FROM settings WHERE key = 'rollover_day'");
    if (new Date().getDay() === (setting ? parseInt(setting.value) : 0)) await db.run("INSERT INTO active_week (week_start_date) VALUES (CURRENT_DATE)");
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'client', 'dist', 'index.html')));
app.listen(PORT, () => console.log(`API running on port ${PORT}`));
