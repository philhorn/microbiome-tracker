import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import pkg from 'pg';
const { Pool } = pkg;
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', 'api', '.env') });

(async () => {
    console.log("Connecting to databases...");
    const sqlitePath = path.join(__dirname, '..', 'api', 'database.sqlite');
    const sqliteDb = await open({ filename: sqlitePath, driver: sqlite3.Database });
    const pgPool = new Pool({ connectionString: process.env.DATABASE_URL });

    const tables = ['users', 'active_week', 'groups', 'group_members', 'foods', 'logs', 'settings'];

    for (const table of tables) {
        console.log(`Migrating ${table}...`);
        const rows = await sqliteDb.all(`SELECT * FROM ${table}`);
        if (rows.length === 0) continue;

        const cols = Object.keys(rows[0]);
        for (const row of rows) {
            const values = cols.map(c => row[c]);
            const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
            
            let conflictStr = "ON CONFLICT DO NOTHING";
            if (table === 'users') conflictStr = "ON CONFLICT (username) DO NOTHING";
            if (table === 'groups') conflictStr = "ON CONFLICT (join_code) DO NOTHING";
            if (table === 'settings') conflictStr = "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value";

            const query = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ${conflictStr}`;
            try { await pgPool.query(query, values); } 
            catch (err) { console.error(`Error inserting into ${table}:`, err.message); }
        }

        if (table !== 'settings' && table !== 'group_members') {
            await pgPool.query(`SELECT setval('${table}_id_seq', COALESCE((SELECT MAX(id) FROM ${table}), 1), true)`);
        }
    }
    console.log("✅ Migration Complete! Data rescued to PostgreSQL.");
    process.exit(0);
})();
