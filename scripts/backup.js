// Consistent online backup of the SQLite database + uploads folder. Run daily from cron; copy the result off the server.
import fs from 'node:fs'; import path from 'node:path';
const { db } = await import('../src/db.js'); const { config, ROOT } = await import('../src/config.js');
const dir = path.join(ROOT, 'data', 'backups', new Date().toISOString().replace(/[:.]/g, '-')); fs.mkdirSync(dir, { recursive: true });
db.exec(`VACUUM INTO '${path.join(dir, 'electromart.db').replace(/'/g, "''")}'`);
if (fs.existsSync(config.uploadDir)) fs.cpSync(config.uploadDir, path.join(dir, 'uploads'), { recursive: true });
console.log('Backup written to', dir);
