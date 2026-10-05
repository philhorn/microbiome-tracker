import pkg from 'pg';
const { Pool } = pkg;
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
        await pool.query("ALTER TABLE groups ADD COLUMN IF NOT EXISTS logo_url TEXT;");
        console.log("Database patched successfully with logo_url column.");
    } catch(e) { console.error("Patch error:", e.message); }
    process.exit(0);
})();
