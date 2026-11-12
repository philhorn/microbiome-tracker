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
import * as dotenv from 'dotenv';
import * as totp from './totp.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3001;
const ADMIN_CRED_FILE = path.join(__dirname, 'admin_credentials.txt');
const APP_ORIGIN = process.env.APP_ORIGIN || 'https://microbiome.allthatfood.net';
const TOKEN_LIFETIME = '30d';
const ROLES = ['user', 'parent', 'dietitian', 'admin'];

// Signing key for sessions: JWT_SECRET from /etc/microbiome/microbiome.env (deploy-app.sh
// generates it once), so sessions survive restarts and deploys.
let SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
    if (process.env.NODE_ENV === 'production') {
        console.error('JWT_SECRET is missing or shorter than 32 characters; refusing to start.');
        process.exit(1);
    }
    console.warn('JWT_SECRET not set: using a random key (sessions end when the server restarts).');
    SECRET = crypto.randomBytes(32).toString('hex');
}

app.set('trust proxy', 1);
app.use(cors({ origin: APP_ORIGIN }));
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));

// Every request arrives through Cloudflare, its tunnel and nginx, so the socket and the last
// X-Forwarded-For hop are the connector. Cloudflare sets CF-Connecting-IP to the visitor.
const clientIp = (req) => req.get('cf-connecting-ip') || req.ip;
const limiter = (windowMins, max, opts = {}) => rateLimit({
    windowMs: windowMins * 60 * 1000, max, keyGenerator: clientIp, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many requests. Try again later.' }, ...opts,
});
const registerLimiter = limiter(60, 10);
const loginLimiter = limiter(15, 20, { skipSuccessfulRequests: true });
// Group PINs and personal PINs are 6 digits: limit guesses per account and per address.
const pinLimiterIp = limiter(15, 30);
const pinLimiterUser = limiter(15, 10, { keyGenerator: (req) => `user:${req.realUserId}` });
const createUserLimiter = limiter(60, 30, { keyGenerator: (req) => `user:${req.realUserId}` });
const BULK_MAX = 20;

// Express 4 doesn't catch a rejected async handler: route every one to the error handler.
for (const method of ['get', 'post', 'put', 'delete']) {
    const original = app[method].bind(app);
    app[method] = (route, ...handlers) => handlers.length === 0 ? original(route)
        : original(route, ...handlers.map(h => (req, res, next) => { try { Promise.resolve(h(req, res, next)).catch(next); } catch (e) { next(e); } }));
}

const toId = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 && n < 2 ** 31 ? n : null; };
const str = (v, max = 100) => typeof v === 'string' && v.trim() !== '' && v.length <= max;

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

export const ready = (async () => {
    try {
        await db.exec(`
            CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username TEXT UNIQUE, password TEXT, role TEXT DEFAULT 'user', family_id INTEGER, display_name TEXT, link_code TEXT, sort_order INTEGER DEFAULT 0, is_suspended INTEGER DEFAULT 0, failed_attempts INTEGER DEFAULT 0, locked_until TEXT);
            CREATE TABLE IF NOT EXISTS active_week (id SERIAL PRIMARY KEY, week_start_date DATE);
            CREATE TABLE IF NOT EXISTS logs (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), week_id INTEGER, food_item TEXT, group_id INTEGER);
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE IF NOT EXISTS groups (id SERIAL PRIMARY KEY, name TEXT, join_code TEXT UNIQUE, isolate_tracker INTEGER DEFAULT 0, app_name TEXT, theme_color TEXT, logo_url TEXT);
            CREATE TABLE IF NOT EXISTS user_column_preferences (user_id INTEGER, group_id INTEGER, target_user_id INTEGER, sort_order INTEGER, PRIMARY KEY(user_id, group_id, target_user_id));
            CREATE TABLE IF NOT EXISTS group_members (group_id INTEGER, user_id INTEGER, sort_order INTEGER DEFAULT 0, PRIMARY KEY(group_id, user_id));
            CREATE TABLE IF NOT EXISTS foods (id SERIAL PRIMARY KEY, name TEXT, category TEXT, group_id INTEGER);

            -- Two-factor (authenticator app) for admins.
            ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled INTEGER DEFAULT 0;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step BIGINT DEFAULT 0;
            -- Who manages each group: its creator; members who join or are added don't.
            ALTER TABLE group_members ADD COLUMN IF NOT EXISTS is_manager INTEGER DEFAULT 0;

            INSERT INTO active_week (week_start_date) SELECT CURRENT_DATE - INTERVAL '7 days' WHERE NOT EXISTS (SELECT 1 FROM active_week WHERE id = 1);

            INSERT INTO settings (key, value) VALUES
                ('max_attempts', '5'), ('lockout_mins', '15'), ('rollover_day', '0'), ('app_name', 'Microbiome Tracker'), ('theme_color', '#ef4444')
            ON CONFLICT (key) DO NOTHING;
        `);

        // Once, for groups made before managers existed: parents and admins already in a group
        // manage it, and so does the only member of a single-member group.
        if (!await db.get("SELECT 1 FROM settings WHERE key = 'migrated_group_managers'")) {
            await db.exec(`
                BEGIN;
                UPDATE group_members gm SET is_manager = 1 FROM users u WHERE u.id = gm.user_id AND u.role IN ('parent', 'admin');
                UPDATE group_members SET is_manager = 1 WHERE group_id IN (SELECT group_id FROM group_members GROUP BY group_id HAVING COUNT(*) = 1);
                INSERT INTO settings (key, value) VALUES ('migrated_group_managers', '1') ON CONFLICT (key) DO NOTHING;
                COMMIT;
            `);
        }

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

// --- ACCESS RULES ---
// A group is managed by an admin, or by a parent who is one of its managers (its creator).
// Dietitians may also edit the food list of a group they belong to.
const isAdmin = (req) => req.userRole === 'admin';

const managesGroup = async (req, groupId) => {
    if (isAdmin(req)) return true;
    if (req.userRole !== 'parent') return false;
    return !!await db.get('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? AND is_manager = 1', [groupId, req.userId]);
};

const editsGroupList = async (req, groupId) => {
    if (await managesGroup(req, groupId)) return true;
    if (req.userRole !== 'dietitian') return false;
    return !!await db.get('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, req.userId]);
};

// For /api/groups/:groupId/... routes: the caller must manage that group.
const requireGroupManager = async (req, res, next) => {
    const groupId = toId(req.params.groupId);
    if (!groupId) return res.status(400).json({ error: 'Invalid group' });
    if (!await managesGroup(req, groupId)) return res.status(403).json({ error: 'Denied' });
    req.groupId = groupId;
    next();
};

const authenticate = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    let decoded;
    try { decoded = jwt.verify(token, SECRET, { algorithms: ['HS256'] }); }
    catch { return res.status(403).json({ error: 'Forbidden' }); }

    // The role comes from the database, so a change applies at once. A session from before the
    // account became an admin has no two-factor check behind it: sign in again.
    const user = await db.get('SELECT id, role, is_suspended FROM users WHERE id = ?', [decoded.id]);
    if (!user || user.is_suspended) return res.status(403).json({ error: 'Account suspended.' });
    if (user.role === 'admin' && decoded.role !== 'admin') return res.status(403).json({ error: 'Sign in again.' });

    req.realUserId = user.id;
    req.userId = user.id; req.userRole = user.role;
    const impId = req.headers['x-impersonate'];
    if (impId && user.role === 'admin') {
        const target = toId(impId) && await db.get('SELECT id, role FROM users WHERE id = ?', [toId(impId)]);
        if (target) { req.userId = target.id; req.userRole = target.role; }
    }
    next();
};

app.get('/api/setup-status', (req, res) => { res.json({ needsSetup: fs.existsSync(ADMIN_CRED_FILE) }); });

app.get('/api/public-config', async (req, res) => {
    const settings = {};
    (await db.all("SELECT key, value FROM settings WHERE key IN ('app_name', 'theme_color')")).forEach(r => settings[r.key] = r.value);
    res.json({ appName: settings.app_name || 'Microbiome Tracker', themeColor: settings.theme_color || '#ef4444' });
});

// A new account gets its own group, which it manages; registering as a parent (or upgrading
// later) gives control of that group and groups it creates, never of anyone else's.
app.post('/api/register', registerLimiter, async (req, res) => {
    const { username, password, displayName, isParent } = req.body || {};
    if (!str(username, 64)) return res.status(400).json({ error: 'Username required' });
    if (!str(password, 200)) return res.status(400).json({ error: 'Password required' });
    if (displayName !== undefined && displayName !== '' && !str(displayName)) return res.status(400).json({ error: 'Display name too long' });
    const lowerUsername = username.trim().toLowerCase();
    if (await db.get('SELECT id FROM users WHERE LOWER(username) = ?', [lowerUsername])) return res.status(400).json({ error: 'Username exists' });
    const hash = await bcrypt.hash(password, 10);

    try {
        const linkCode = crypto.randomInt(100000, 1000000).toString();
        const userRes = await db.runReturnId('INSERT INTO users (username, password, role, display_name, link_code) VALUES (?, ?, ?, ?, ?)', [lowerUsername, hash, isParent === true ? 'parent' : 'user', (displayName || username).trim(), linkCode]);
        const joinCode = crypto.randomInt(100000, 1000000).toString();
        const groupRes = await db.runReturnId("INSERT INTO groups (name, join_code) VALUES ('My Group', ?)", [joinCode]);
        await db.run("INSERT INTO group_members (group_id, user_id, sort_order, is_manager) VALUES (?, ?, 0, 1)", [groupRes.lastID, userRes.lastID]);
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: 'Database error' }); }
});

const loginFailed = async (res, user, message = 'Invalid credentials') => {
    const attempts = (user.failed_attempts || 0) + 1;
    const limitSettings = await db.get("SELECT value FROM settings WHERE key = 'max_attempts'");
    if (attempts >= (limitSettings ? parseInt(limitSettings.value) : 5)) {
        const minSettings = await db.get("SELECT value FROM settings WHERE key = 'lockout_mins'");
        const lockoutUntil = new Date(Date.now() + (minSettings ? parseInt(minSettings.value) : 15) * 60000).toISOString();
        await db.run('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?', [attempts, lockoutUntil, user.id]);
        return res.status(401).json({ error: 'Account locked.' });
    }
    await db.run('UPDATE users SET failed_attempts = ? WHERE id = ?', [attempts, user.id]);
    res.status(401).json({ error: message });
};

// Admins need an authenticator-app code after their password. An admin without one sets it up
// here: the key is shown once the password is right, and confirmed with a first code.
app.post('/api/login', loginLimiter, async (req, res) => {
    const { username, password, otp } = req.body || {};
    if (!str(username, 64) || typeof password !== 'string') return res.status(400).json({ error: 'Username and password required' });
    const user = await db.get('SELECT * FROM users WHERE LOWER(username) = ?', [username.trim().toLowerCase()]);
    if (!user || user.is_suspended) return res.status(401).json({ error: 'Invalid credentials or suspended' });
    if (user.locked_until && new Date(user.locked_until) > new Date()) return res.status(403).json({ error: 'Account locked.' });
    if (!await bcrypt.compare(password, user.password)) return loginFailed(res, user);

    if (user.role === 'admin') {
        let secret = user.totp_secret;
        const enrolled = !!(secret && user.totp_enabled);
        if (!secret) {
            secret = totp.newSecret();
            await db.run('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?', [secret, user.id]);
        }
        if (!otp) {
            if (enrolled) return res.status(401).json({ totpRequired: true, error: 'Enter the 6-digit code from your authenticator app.' });
            return res.status(401).json({ totpSetup: true, secret, otpauth: totp.otpauthUri(secret, user.username),
                error: 'Admin accounts need two-factor: add this key to your authenticator app, then enter its 6-digit code.' });
        }
        const step = totp.verify(secret, String(otp), enrolled ? Number(user.totp_last_step) || 0 : 0);
        if (step === null) return loginFailed(res, user, 'Invalid authenticator code');
        // The step is recorded so a code can't be used twice (a concurrent replay loses here).
        const r = await db.run('UPDATE users SET totp_enabled = 1, totp_last_step = ? WHERE id = ? AND COALESCE(totp_last_step, 0) < ?', [step, user.id, step]);
        if (r.rowCount !== 1) return loginFailed(res, user, 'Invalid authenticator code');
    }

    await db.run('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', [user.id]);
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET, { expiresIn: TOKEN_LIFETIME, algorithm: 'HS256' });
    res.json({ token, id: user.id, username: user.username, role: user.role, name: user.display_name, link_code: user.link_code });
});

// The global templates and the lists of the caller's own groups.
app.get('/api/lists', authenticate, async (req, res) => {
    res.json(await db.all(`SELECT id, name, category, group_id FROM foods
        WHERE group_id IS NULL OR group_id IN (SELECT group_id FROM group_members WHERE user_id = ?)
        ORDER BY group_id, category, name`, [req.userId]));
});

// Which list a /api/lists/* request edits: null (the global templates, admins only) or a group
// the caller may edit. Sends the refusal and returns undefined otherwise.
const listScope = async (req, res) => {
    const raw = req.body?.group_id;
    if (raw === null || raw === undefined) {
        if (!isAdmin(req)) { res.status(403).json({ error: 'Only admins can modify global templates.' }); return undefined; }
        return null;
    }
    const groupId = toId(raw);
    if (!groupId) { res.status(400).json({ error: 'Invalid group' }); return undefined; }
    if (!await editsGroupList(req, groupId)) { res.status(403).json({ error: 'Denied' }); return undefined; }
    return groupId;
};

// Logs that belong to food <name> of that list: a group's own item is logged with its group;
// a global item globally, or with each isolated group that has no item of its own by that name.
const logScope = (groupId) => ({ sql: groupId === null
    ? '(group_id IS NULL OR group_id NOT IN (SELECT group_id FROM foods WHERE name = ? AND group_id IS NOT NULL))'
    : 'group_id = ?' });
const logParams = (groupId, name) => groupId === null ? [name] : [groupId];
const foodScope = (groupId) => groupId === null ? 'group_id IS NULL' : 'group_id = ?';
const foodParams = (groupId) => groupId === null ? [] : [groupId];

app.post('/api/lists/manage', authenticate, async (req, res) => {
    if (!['admin', 'dietitian', 'parent'].includes(req.userRole)) return res.status(403).json({ error: 'Denied' });
    const groupId = await listScope(req, res);
    if (groupId === undefined) return;
    const { action, name, category, oldName } = req.body;
    const logs = logScope(groupId);

    if (action === 'add') {
        if (!str(name) || !str(category)) return res.status(400).json({ error: 'Name and category required' });
        await db.run('INSERT INTO foods (name, category, group_id) VALUES (?, ?, ?)', [name.trim(), category.trim(), groupId]);
    } else if (action === 'edit') {
        if (!str(name) || !str(category) || !str(oldName)) return res.status(400).json({ error: 'Name and category required' });
        await db.run(`UPDATE foods SET name = ?, category = ? WHERE name = ? AND ${foodScope(groupId)}`, [name.trim(), category.trim(), oldName, ...foodParams(groupId)]);
        await db.run(`UPDATE logs SET food_item = ? WHERE food_item = ? AND ${logs.sql}`, [name.trim(), oldName, ...logParams(groupId, oldName)]);
    } else if (action === 'delete') {
        if (!str(name)) return res.status(400).json({ error: 'Name required' });
        await db.run(`DELETE FROM logs WHERE food_item = ? AND ${logs.sql}`, [name, ...logParams(groupId, name)]);
        await db.run(`DELETE FROM foods WHERE name = ? AND ${foodScope(groupId)}`, [name, ...foodParams(groupId)]);
    } else return res.status(400).json({ error: 'Unknown action' });
    res.json({ success: true });
});

app.post('/api/lists/category', authenticate, async (req, res) => {
    if (!['admin', 'dietitian', 'parent'].includes(req.userRole)) return res.status(403).json({ error: 'Denied' });
    const groupId = await listScope(req, res);
    if (groupId === undefined) return;
    const { action, oldCategory, newCategory } = req.body;
    if (!str(oldCategory)) return res.status(400).json({ error: 'Category required' });

    if (action === 'rename') {
        if (!str(newCategory)) return res.status(400).json({ error: 'Category required' });
        await db.run(`UPDATE foods SET category = ? WHERE category = ? AND ${foodScope(groupId)}`, [newCategory.trim(), oldCategory, ...foodParams(groupId)]);
    } else if (action === 'delete') {
        const items = await db.all(`SELECT name FROM foods WHERE category = ? AND ${foodScope(groupId)}`, [oldCategory, ...foodParams(groupId)]);
        const logs = logScope(groupId);
        for (const { name } of items) await db.run(`DELETE FROM logs WHERE food_item = ? AND ${logs.sql}`, [name, ...logParams(groupId, name)]);
        await db.run(`DELETE FROM foods WHERE category = ? AND ${foodScope(groupId)}`, [oldCategory, ...foodParams(groupId)]);
    } else return res.status(400).json({ error: 'Unknown action' });
    res.json({ success: true });
});

app.put('/api/user/profile', authenticate, async (req, res) => {
    const { displayName, newPassword } = req.body || {};
    if (displayName !== undefined && displayName !== '' && !str(displayName)) return res.status(400).json({ error: 'Display name too long' });
    if (newPassword !== undefined && !str(newPassword, 200)) return res.status(400).json({ error: 'Invalid password' });
    if (displayName) await db.run('UPDATE users SET display_name = ? WHERE id = ?', [displayName.trim(), req.userId]);
    if (newPassword) {
        await db.run('UPDATE users SET password = ? WHERE id = ?', [await bcrypt.hash(newPassword, 10), req.userId]);
        if (req.userRole === 'admin' && !req.headers['x-impersonate'] && fs.existsSync(ADMIN_CRED_FILE)) fs.unlinkSync(ADMIN_CRED_FILE);
    }
    const user = await db.get('SELECT username, role, display_name FROM users WHERE id = ?', [req.userId]);
    res.json({ success: true, name: user.display_name });
});

// A plain user may make themselves a parent: that lets them manage the groups they created
// (their own family's), nothing else. Other roles are unchanged.
app.post('/api/user/upgrade', authenticate, async (req, res) => {
    await db.run("UPDATE users SET role = 'parent' WHERE id = ? AND role = 'user'", [req.userId]);
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

const latestWeek = async () => (await db.get('SELECT MAX(id) as id FROM active_week')).id;

app.get('/api/groups/grid', authenticate, async (req, res) => {
    const weekId = toId(req.query.weekId) || await latestWeek();
    let myGroups = await db.all('SELECT group_id, is_manager FROM group_members WHERE user_id = ?', [req.userId]);

    if (!myGroups.length) {
        const joinCode = crypto.randomInt(100000, 1000000).toString();
        const groupRes = await db.runReturnId("INSERT INTO groups (name, join_code) VALUES ('My Workspace', ?)", [joinCode]);
        await db.run("INSERT INTO group_members (group_id, user_id, sort_order, is_manager) VALUES (?, ?, 0, 1)", [groupRes.lastID, req.userId]);
        myGroups = [{ group_id: groupRes.lastID, is_manager: 1 }];
    }

    const groupIds = myGroups.map(g => g.group_id);
    const manages = (gid) => isAdmin(req) || (req.userRole === 'parent' && myGroups.some(g => g.group_id === gid && g.is_manager === 1));
    const groups = await db.all(`SELECT id, name, join_code, isolate_tracker, app_name, theme_color, logo_url FROM groups WHERE id = ANY($1::int[])`, [groupIds]);
    const members = await db.all(`SELECT gm.group_id, u.id, u.display_name as name, gm.sort_order FROM group_members gm JOIN users u ON gm.user_id = u.id WHERE gm.group_id = ANY($1::int[]) ORDER BY gm.group_id, gm.sort_order ASC, u.id ASC`, [groupIds]);

    // Only a group's managers see its PIN (it lets anyone join).
    const formattedGroups = groups.map(g => {
        const canManage = manages(g.id);
        return { ...g, join_code: canManage ? g.join_code : null, can_manage: canManage, members: members.filter(m => m.group_id === g.id) };
    });

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
    if (req.userRole !== 'parent' && req.userRole !== 'admin') return res.status(403).json({ error: 'Denied' });
    if (!str(req.body?.name)) return res.status(400).json({ error: 'Group name required' });
    const result = await db.runReturnId('INSERT INTO groups (name, join_code) VALUES (?, ?)', [req.body.name.trim(), crypto.randomInt(100000, 1000000).toString()]);
    await db.run('INSERT INTO group_members (group_id, user_id, sort_order, is_manager) VALUES (?, ?, 0, 1)', [result.lastID, req.userId]);
    res.json({ success: true });
});

// Joining makes the caller a member, never a manager.
app.post('/api/groups/join', authenticate, pinLimiterIp, pinLimiterUser, async (req, res) => {
    const joinCode = typeof req.body?.joinCode === 'string' ? req.body.joinCode.trim() : '';
    if (!/^\d{6}$/.test(joinCode)) return res.status(404).json({ error: 'Invalid PIN' });
    const target = await db.get('SELECT id FROM groups WHERE join_code = ?', [joinCode]);
    if (!target) return res.status(404).json({ error: 'Invalid PIN' });
    const exists = await db.get('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?', [target.id, req.userId]);
    if (!exists) await db.run('INSERT INTO group_members (group_id, user_id, sort_order) VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM group_members WHERE group_id = ?))', [target.id, req.userId, target.id]);
    res.json({ success: true });
});

app.put('/api/groups/:groupId', authenticate, requireGroupManager, async (req, res) => {
    const { name, appName, themeColor, logoUrl } = req.body || {};
    const optional = (v, ok) => v === null || v === undefined || v === '' || ok(v);
    if (!str(name)) return res.status(400).json({ error: 'Group name required' });
    if (!optional(appName, v => str(v))) return res.status(400).json({ error: 'App name too long' });
    if (!optional(themeColor, v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v))) return res.status(400).json({ error: 'Invalid colour' });
    if (!optional(logoUrl, v => typeof v === 'string' && v.length <= 500 && /^https?:\/\/\S+$/i.test(v))) return res.status(400).json({ error: 'The logo must be an http(s) URL' });
    await db.run('UPDATE groups SET name = ?, app_name = ?, theme_color = ?, logo_url = ? WHERE id = ?', [name.trim(), appName || null, themeColor || null, logoUrl || null, req.groupId]);
    res.json({ success: true });
});

app.put('/api/groups/:groupId/mode', authenticate, requireGroupManager, async (req, res) => {
    await db.run('UPDATE groups SET isolate_tracker = ? WHERE id = ?', [req.body?.isolated ? 1 : 0, req.groupId]);
    res.json({ success: true });
});

// Anyone may leave a group; removing someone else takes a manager of that group.
app.delete('/api/groups/:groupId/member/:userId', authenticate, async (req, res) => {
    const groupId = toId(req.params.groupId), targetId = toId(req.params.userId);
    if (!groupId || !targetId) return res.status(400).json({ error: 'Invalid request' });
    if (targetId !== req.userId && !await managesGroup(req, groupId)) return res.status(403).json({ error: 'Denied' });
    await db.run('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, targetId]);
    res.json({ success: true });
});

// Adds existing accounts by username and personal PIN. Capped and rate-limited, since a wrong
// PIN is a guess at a 6-digit code.
app.post('/api/groups/:groupId/add_users_bulk', authenticate, requireGroupManager, pinLimiterIp, pinLimiterUser, async (req, res) => {
    const users = req.body?.users;
    if (!Array.isArray(users) || users.length === 0) return res.status(400).json({ error: 'No users given' });
    if (users.length > BULK_MAX) return res.status(400).json({ error: `At most ${BULK_MAX} users at a time` });
    let added = 0; const errors = [];
    for (const u of users) {
        const tUser = typeof u?.username === 'string' ? u.username.trim().toLowerCase() : '';
        const tPin = typeof u?.linkCode === 'string' ? u.linkCode.trim() : '';
        if (!tUser || !tPin) continue;
        const target = /^\d{6}$/.test(tPin) && tUser.length <= 64 && await db.get('SELECT id FROM users WHERE LOWER(username) = ? AND link_code = ?', [tUser, tPin]);
        if (!target) { errors.push(`${tUser.slice(0, 64)} (Invalid)`); continue; }
        const exists = await db.get('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?', [req.groupId, target.id]);
        if (!exists) { await db.run('INSERT INTO group_members (group_id, user_id, sort_order) VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM group_members WHERE group_id = ?))', [req.groupId, target.id, req.groupId]); added++; }
        else { errors.push(`${tUser} (Already in group)`); }
    }
    res.json({ success: true, added, errors });
});

app.post('/api/groups/:groupId/create_user', authenticate, requireGroupManager, createUserLimiter, async (req, res) => {
    const { username, password, displayName } = req.body || {};
    if (!str(username, 64) || !str(password, 200)) return res.status(400).json({ error: 'Username and password required' });
    if (displayName !== undefined && displayName !== '' && !str(displayName)) return res.status(400).json({ error: 'Display name too long' });
    const lowerUsername = username.trim().toLowerCase();
    if (await db.get('SELECT id FROM users WHERE LOWER(username) = ?', [lowerUsername])) return res.status(400).json({ error: 'Username exists' });
    try {
        const linkCode = crypto.randomInt(100000, 1000000).toString();
        const result = await db.runReturnId('INSERT INTO users (username, password, role, display_name, link_code) VALUES (?, ?, ?, ?, ?)', [lowerUsername, await bcrypt.hash(password, 10), 'user', (displayName || username).trim(), linkCode]);
        await db.run('INSERT INTO group_members (group_id, user_id, sort_order) VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM group_members WHERE group_id = ?))', [req.groupId, result.lastID, req.groupId]);
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: 'Error' }); }
});

// Renaming someone: yourself, or a member of a group you manage.
app.put('/api/groups/member/:id', authenticate, async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid user' });
    if (!str(req.body?.displayName)) return res.status(400).json({ error: 'Display name required' });
    if (id !== req.userId && !isAdmin(req)) {
        const shared = req.userRole === 'parent' && await db.get(`SELECT 1 FROM group_members mine JOIN group_members theirs ON theirs.group_id = mine.group_id
            WHERE mine.user_id = ? AND mine.is_manager = 1 AND theirs.user_id = ?`, [req.userId, id]);
        if (!shared) return res.status(403).json({ error: 'Denied' });
    }
    await db.run('UPDATE users SET display_name = ? WHERE id = ?', [req.body.displayName.trim(), id]);
    res.json({ success: true });
});

app.post('/api/groups/:groupId/reorder', authenticate, requireGroupManager, async (req, res) => {
    const order = req.body?.order;
    if (!Array.isArray(order) || order.length > 500 || !order.every(toId)) return res.status(400).json({ error: 'Invalid order' });
    for (let i = 0; i < order.length; i++) await db.run('UPDATE group_members SET sort_order = ? WHERE user_id = ? AND group_id = ?', [i, toId(order[i]), req.groupId]);
    res.json({ success: true });
});

// Ticks a food for a member of a group: your own column, or anyone's in a group you manage.
app.post('/api/toggle/:targetId', authenticate, async (req, res) => {
    const targetId = toId(req.params.targetId), groupId = toId(req.body?.groupId);
    const { item, checked } = req.body || {};
    if (!targetId || !groupId || !str(item, 200)) return res.status(400).json({ error: 'Invalid request' });
    if (!await db.get('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, targetId])) return res.status(403).json({ error: 'Denied' });
    if (targetId !== req.userId && !await managesGroup(req, groupId)) return res.status(403).json({ error: 'Denied' });
    const weekId = toId(req.body.weekId) || await latestWeek();

    const group = await db.get('SELECT isolate_tracker FROM groups WHERE id = ?', [groupId]);
    const food = await db.get('SELECT group_id FROM foods WHERE name = ? AND (group_id IS NULL OR group_id = ?) ORDER BY group_id NULLS LAST LIMIT 1', [item, groupId]);
    if (checked && !food) return res.status(400).json({ error: 'Unknown item' });

    let targetGroupId = groupId;
    if (food && food.group_id === null && group && group.isolate_tracker === 0) {
        targetGroupId = null; // Sync Globally!
    }

    if (checked) {
        const q = targetGroupId === null ? 'group_id IS NULL' : 'group_id = $4';
        const params = targetGroupId === null ? [targetId, weekId, item] : [targetId, weekId, item, targetGroupId];
        const exists = await db.get(`SELECT 1 FROM logs WHERE user_id = $1 AND week_id = $2 AND food_item = $3 AND ${q}`, params);
        if (!exists) await db.run('INSERT INTO logs (user_id, week_id, food_item, group_id) VALUES (?, ?, ?, ?)', [targetId, weekId, item, targetGroupId]);
    } else {
        if (targetGroupId === null) await db.run('DELETE FROM logs WHERE user_id = ? AND week_id = ? AND food_item = ? AND group_id IS NULL', [targetId, weekId, item]);
        else await db.run('DELETE FROM logs WHERE user_id = ? AND week_id = ? AND food_item = ? AND group_id = ?', [targetId, weekId, item, targetGroupId]);
    }
    res.json({ success: true });
});

const requireAdmin = (req, res, next) => isAdmin(req) ? next() : res.status(403).json({ error: 'Denied' });

app.get('/api/admin/users', authenticate, requireAdmin, async (req, res) => {
    res.json(await db.all(`SELECT id, username, display_name, role, link_code, is_suspended, failed_attempts, locked_until FROM users ORDER BY id`));
});

app.post('/api/admin/create_user', authenticate, requireAdmin, async (req, res) => {
    const { username, password, displayName, role = 'user' } = req.body || {};
    if (!str(username, 64) || !str(password, 200)) return res.status(400).json({ error: 'Username and password required' });
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    if (await db.get('SELECT id FROM users WHERE LOWER(username) = ?', [username.trim().toLowerCase()])) return res.status(400).json({ error: 'Username already exists' });
    try {
        await db.run('INSERT INTO users (username, password, role, display_name, link_code) VALUES (?, ?, ?, ?, ?)', [username.trim().toLowerCase(), await bcrypt.hash(password, 10), role, (displayName || username).trim(), crypto.randomInt(100000, 1000000).toString()]);
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: 'Error' }); }
});

app.post('/api/admin/suspend/:id', authenticate, requireAdmin, async (req, res) => {
    const target = toId(req.params.id) && await db.get('SELECT username, is_suspended FROM users WHERE id = ?', [toId(req.params.id)]);
    if (!target) return res.status(404).json({ error: 'No such user' });
    if (target.username === 'admin') return res.status(403).json({ error: 'Cannot suspend master admin' });
    await db.run('UPDATE users SET is_suspended = ? WHERE id = ?', [target.is_suspended ? 0 : 1, toId(req.params.id)]);
    res.json({ success: true });
});

app.post('/api/admin/role/:id', authenticate, requireAdmin, async (req, res) => {
    const id = toId(req.params.id);
    if (!id || !ROLES.includes(req.body?.role)) return res.status(400).json({ error: 'Invalid request' });
    if ((await db.get('SELECT username FROM users WHERE id = ?', [id]))?.username === 'admin') return res.status(403).json({ error: 'Cannot modify master admin' });
    await db.run('UPDATE users SET role = ? WHERE id = ?', [req.body.role, id]);
    res.json({ success: true });
});

app.delete('/api/admin/delete/:id', authenticate, requireAdmin, async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid user' });
    if ((await db.get('SELECT username FROM users WHERE id = ?', [id]))?.username === 'admin') return res.status(403).json({ error: 'Cannot delete master admin' });
    await db.run('DELETE FROM group_members WHERE user_id = ?', [id]);
    await db.run('DELETE FROM logs WHERE user_id = ?', [id]);
    await db.run('DELETE FROM users WHERE id = ?', [id]);
    res.json({ success: true });
});

app.get('/api/admin/settings', authenticate, requireAdmin, async (req, res) => {
    const settings = {}; (await db.all('SELECT key, value FROM settings')).forEach(r => settings[r.key] = r.value);
    res.json(settings);
});

app.put('/api/admin/settings', authenticate, requireAdmin, async (req, res) => {
    for (const [key, value] of Object.entries(req.body || {})) {
        await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, String(value)]);
    }
    res.json({ success: true });
});

app.post('/api/admin/force-week', authenticate, requireAdmin, async (req, res) => {
    await db.run("INSERT INTO active_week (week_start_date) VALUES (CURRENT_DATE)");
    res.json({ success: true });
});

if (process.env.NODE_ENV !== 'test') cron.schedule('1 0 * * *', async () => {
    try {
        const setting = await db.get("SELECT value FROM settings WHERE key = 'rollover_day'");
        if (new Date().getDay() === (setting ? parseInt(setting.value) : 0)) await db.run("INSERT INTO active_week (week_start_date) VALUES (CURRENT_DATE)");
    } catch (e) { console.error('Week rollover failed:', e); }
});

app.all('/api/*', (req, res) => res.status(404).json({ error: 'Not found' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'client', 'dist', 'index.html')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(400).json({ error: 'Invalid request' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
});

if (process.env.NODE_ENV !== 'test') app.listen(PORT, process.env.HOST, () => console.log(`API running on ${process.env.HOST || '*'}:${PORT}`));

export default app;
