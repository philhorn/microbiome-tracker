// Access-control tests against a real PostgreSQL (a throwaway database: the tests create users).
//   TEST_DATABASE_URL=postgresql://user:pw@127.0.0.1:5432/db npm test
// Skipped when TEST_DATABASE_URL isn't set.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import pkg from 'pg';
import { codeAt, currentStep, verify, newSecret } from '../totp.js';

const DB = process.env.TEST_DATABASE_URL;
const skip = !DB && 'TEST_DATABASE_URL not set';
let server, base, pool;

before(async () => {
    if (skip) return;
    Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: DB, JWT_SECRET: 'x'.repeat(64) });
    const mod = await import('../server.js');
    await mod.ready;
    server = mod.default.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
    pool = new pkg.Pool({ connectionString: DB });
});
after(async () => { server?.close(); await pool?.end(); });

const api = async (method, path, token, body, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body && JSON.stringify(body) });
    let data = null; try { data = await r.json(); } catch { /* not JSON */ }
    return { status: r.status, data, headers: r.headers };
};
const uniq = () => `test-audit-${Math.random().toString(36).slice(2, 8)}`;
const family = async () => {
    const username = uniq();
    assert.equal((await api('POST', '/api/register', null, { username, password: 'pw-123456', displayName: username, isParent: true })).data.success, true);
    const login = (await api('POST', '/api/login', null, { username, password: 'pw-123456' })).data;
    const grid = (await api('GET', '/api/groups/grid', login.token)).data;
    return { ...login, username, group: grid.groups[0] };
};

test('totp codes match RFC 6238 and are single-use', { skip }, () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // "12345678901234567890"
    assert.equal(codeAt(secret, Math.floor(59 / 30)), '287082');
    const s = newSecret(), step = currentStep();
    assert.equal(verify(s, codeAt(s, step)), step);
    assert.equal(verify(s, codeAt(s, step), step), null);
    assert.equal(verify(s, 'abcdef'), null);
});

test('a family cannot touch another family', { skip }, async () => {
    const a = await family(), b = await family();
    const ga = a.group.id;
    assert.equal(a.group.can_manage, true);
    assert.match(a.group.join_code, /^\d{6}$/);

    for (const [m, p, body] of [
        ['PUT', `/api/groups/${ga}`, { name: 'pwned' }],
        ['PUT', `/api/groups/${ga}/mode`, { isolated: true }],
        ['POST', `/api/groups/${ga}/add_users_bulk`, { users: [{ username: b.username, linkCode: b.link_code }] }],
        ['POST', `/api/groups/${ga}/create_user`, { username: uniq(), password: 'x1234567' }],
        ['POST', `/api/groups/${ga}/reorder`, { order: [a.id] }],
        ['DELETE', `/api/groups/${ga}/member/${a.id}`],
        ['PUT', `/api/groups/member/${a.id}`, { displayName: 'pwned' }],
        ['POST', `/api/toggle/${a.id}`, { groupId: ga, item: 'Kale', checked: true }],
        ['POST', `/api/toggle/${a.id}`, { groupId: b.group.id, item: 'Kale', checked: true }],
        ['POST', '/api/lists/manage', { action: 'add', name: 'X', category: 'Y', group_id: ga }],
        ['POST', '/api/lists/category', { action: 'delete', oldCategory: 'Y', group_id: ga }],
        ['POST', '/api/lists/manage', { action: 'add', name: 'X', category: 'Y', group_id: null }],
    ]) assert.equal((await api(m, p, b.token, body)).status, 403, `${m} ${p}`);

    // Upgrading changes nothing for someone who is already a parent.
    assert.equal((await api('POST', '/api/user/upgrade', b.token)).data.role, 'parent');
    assert.equal((await api('PUT', `/api/groups/${ga}`, b.token, { name: 'pwned' })).status, 403);

    // Group-only foods stay in the group.
    assert.equal((await api('POST', '/api/lists/manage', a.token, { action: 'add', name: 'Secret Food', category: 'Z', group_id: ga })).data.success, true);
    assert.ok(!(await api('GET', '/api/lists', b.token)).data.some(f => f.name === 'Secret Food'));
    assert.ok((await api('GET', '/api/lists', a.token)).data.some(f => f.name === 'Secret Food'));

    // Joining with the PIN makes B a member, not a manager.
    assert.equal((await api('POST', '/api/groups/join', b.token, { joinCode: a.group.join_code })).data.success, true);
    const bg = (await api('GET', '/api/groups/grid', b.token)).data.groups.find(g => g.id === ga);
    assert.equal(bg.can_manage, false);
    assert.equal(bg.join_code, null);
    assert.equal((await api('PUT', `/api/groups/${ga}`, b.token, { name: 'pwned' })).status, 403);
    assert.equal((await api('POST', `/api/toggle/${a.id}`, b.token, { groupId: ga, item: 'Kale', checked: true })).status, 403);
    assert.equal((await api('POST', `/api/toggle/${b.id}`, b.token, { groupId: ga, item: 'Kale', checked: true })).data.success, true);
    // ...and A, the manager, may tick B's column in A's group.
    assert.equal((await api('POST', `/api/toggle/${b.id}`, a.token, { groupId: ga, item: 'Secret Food', checked: true })).data.success, true);
    // A may not tick B in B's own group.
    assert.equal((await api('POST', `/api/toggle/${b.id}`, a.token, { groupId: b.group.id, item: 'Kale', checked: true })).status, 403);
    // B may leave.
    assert.equal((await api('DELETE', `/api/groups/${ga}/member/${b.id}`, b.token)).data.success, true);
});

test('renaming a group food rewrites only that group\'s logs', { skip }, async () => {
    const a = await family(), b = await family();
    for (const f of [a, b]) {
        await api('POST', '/api/lists/manage', f.token, { action: 'add', name: 'Shared Name', category: 'Q', group_id: f.group.id });
        assert.equal((await api('POST', `/api/toggle/${f.id}`, f.token, { groupId: f.group.id, item: 'Shared Name', checked: true })).data.success, true);
    }
    await api('POST', '/api/lists/manage', a.token, { action: 'edit', oldName: 'Shared Name', name: 'Renamed', category: 'Q', group_id: a.group.id });
    const logs = async (f) => (await api('GET', '/api/groups/grid', f.token)).data.grid[f.group.id][f.id];
    assert.deepEqual(await logs(a), ['Renamed']);
    assert.deepEqual(await logs(b), ['Shared Name']);
    await api('POST', '/api/lists/category', a.token, { action: 'delete', oldCategory: 'Q', group_id: a.group.id });
    assert.deepEqual(await logs(a), []);
    assert.deepEqual(await logs(b), ['Shared Name']);
});

test('plain users manage only their own column and group', { skip }, async () => {
    const username = uniq();
    await api('POST', '/api/register', null, { username, password: 'pw-123456', isParent: false });
    const u = (await api('POST', '/api/login', null, { username, password: 'pw-123456' })).data;
    const g = (await api('GET', '/api/groups/grid', u.token)).data.groups[0];
    assert.equal(g.can_manage, false);
    assert.equal((await api('PUT', `/api/groups/${g.id}`, u.token, { name: 'n' })).status, 403);
    assert.equal((await api('POST', '/api/user/upgrade', u.token)).data.role, 'parent');
    assert.equal((await api('PUT', `/api/groups/${g.id}`, u.token, { name: 'Mine' })).data.success, true);
});

test('sessions expire after 30 days and bad input is refused, not fatal', { skip }, async () => {
    const a = await family();
    const claims = JSON.parse(Buffer.from(a.token.split('.')[1], 'base64url'));
    assert.equal(claims.exp - claims.iat, 30 * 24 * 3600);
    assert.equal((await api('POST', '/api/toggle/abc', a.token, { groupId: 'x', item: 'Kale', checked: true })).status, 400);
    assert.equal((await api('PUT', '/api/groups/abc', a.token, { name: 'n' })).status, 400);
    assert.equal((await api('POST', '/api/login', null, { username: a.username })).status, 400);
    assert.equal((await api('POST', `/api/groups/${a.group.id}/add_users_bulk`, a.token, { users: Array(21).fill({ username: 'x', linkCode: '123456' }) })).status, 400);
    assert.equal((await api('POST', '/api/webhook', null, {}, { 'X-GitHub-Event': 'push' })).status, 404);
    const cors = await api('GET', '/api/public-config', null, null, { Origin: 'https://evil.example' });
    assert.notEqual(cors.headers.get('access-control-allow-origin'), 'https://evil.example');
});

test('admins sign in with an authenticator code', { skip }, async () => {
    const username = uniq();
    await pool.query("INSERT INTO users (username, password, role, display_name) VALUES ($1, $2, 'admin', $1)", [username, await bcrypt.hash('pw-123456', 4)]);
    const first = await api('POST', '/api/login', null, { username, password: 'pw-123456' });
    assert.equal(first.status, 401);
    assert.equal(first.data.totpSetup, true);
    assert.equal(first.data.token, undefined);
    const secret = first.data.secret;
    assert.equal((await api('POST', '/api/login', null, { username, password: 'pw-123456', otp: '000000' === codeAt(secret, currentStep()) ? '111111' : '000000' })).status, 401);
    const code = codeAt(secret, currentStep());
    const ok = await api('POST', '/api/login', null, { username, password: 'pw-123456', otp: code });
    assert.ok(ok.data.token);
    assert.equal((await api('GET', '/api/admin/users', ok.data.token)).status, 200);
    // The same code can't be used again; without a code there's no session.
    assert.equal((await api('POST', '/api/login', null, { username, password: 'pw-123456', otp: code })).status, 401);
    const again = await api('POST', '/api/login', null, { username, password: 'pw-123456' });
    assert.equal(again.data.totpRequired, true);
    assert.equal(again.data.secret, undefined);
    await pool.query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE username = $1', [username]);
});

test('group PIN guesses are rate-limited', { skip }, async () => {
    const a = await family();
    const codes = [];
    for (let i = 0; i < 12; i++) codes.push((await api('POST', '/api/groups/join', a.token, { joinCode: String(100000 + i) })).status);
    assert.ok(codes.includes(429), codes.join(','));
});
