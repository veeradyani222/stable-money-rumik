const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

/** Load DATABASE_URL from .env.local when not already set (Windows-safe for URLs containing &). */
function loadDatabaseUrlFromEnvLocal() {
  if (process.env.DATABASE_URL) return;
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  const fileText = fs.readFileSync(envPath, 'utf8');
  if (!fileText.trim()) {
    console.warn(
      'Warning: .env.local exists but is empty on disk. Save your editor buffer (Ctrl+S), then rerun migrate.',
    );
    return;
  }
  const lines = fileText.split('\n');
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (/^\s*#/.test(line) || !line.trim()) continue;
    const match = line.match(/^\s*DATABASE_URL\s*=\s*(.*)$/);
    if (!match) continue;
    let val = match[1].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env.DATABASE_URL = val;
    break;
  }
}

loadDatabaseUrlFromEnvLocal();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not found. Set it in .env.local or in the environment.');
  process.exit(1);
}

const sqlPath = path.join(__dirname, '..', 'migrations', '001_demo_users.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

const client = new Client({
  connectionString: url,
  ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  await client.query(sql);
  console.log('Migration OK: table demo_users is ready.');
  await client.end();
}

main().catch((err) => {
  console.error('Migration failed:', err.message || err);
  client.end().catch(() => {});
  process.exit(1);
});
