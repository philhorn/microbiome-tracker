// Sets up authenticator-app two-factor for an account from the server's shell, and prints the
// new setup key (base32) on stdout, alone, so it can be piped straight into a secret store.
//   node admin-totp.js <username>           new key, enabled at once
//   node admin-totp.js <username> --reset   removes it: the account sets up a new one at its next login
// Needs DATABASE_URL (as root: set -a; . /etc/microbiome/microbiome.env; set +a).
import pkg from 'pg';
import { newSecret } from './totp.js';
const { Pool } = pkg;

const [username, flag] = process.argv.slice(2);
if (!username || (flag && flag !== '--reset')) {
    console.error('usage: node admin-totp.js <username> [--reset]');
    process.exit(2);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
    const secret = flag ? null : newSecret();
    const r = await pool.query(
        'UPDATE users SET totp_secret = $1, totp_enabled = $2, totp_last_step = 0 WHERE LOWER(username) = LOWER($3)',
        [secret, secret ? 1 : 0, username]);
    if (r.rowCount !== 1) { console.error(`admin-totp: no account ${username}`); process.exit(1); }
    if (secret) process.stdout.write(secret + '\n');
    else console.error(`admin-totp: two-factor removed for ${username}; it sets up a new key at its next login`);
} finally {
    await pool.end();
}
