import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';

if (config.dbPath !== ':memory:') fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;');

const stmts = new Map();
const st = (sql) => { let s = stmts.get(sql); if (!s) { if (stmts.size > 400) stmts.clear(); s = db.prepare(sql); stmts.set(sql, s); } return s; };
const clean = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
export const q = {
  get: (sql, ...p) => st(sql).get(...clean(p)),
  all: (sql, ...p) => st(sql).all(...clean(p)),
  run: (sql, ...p) => st(sql).run(...clean(p)),
};
export const now = () => new Date().toISOString();

/** Run fn inside an immediate (write-locked) transaction: used for stock, coupons and order creation. */
let depth = 0;
export function tx(fn) {
  if (depth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  depth++;
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
  finally { depth--; }
}

export function migrate() {
  const dir = path.join(ROOT, 'migrations');
  let v = q.get('PRAGMA user_version').user_version;
  const files = fs.readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  for (const f of files) {
    const n = parseInt(f, 10);
    if (n <= v) continue;
    db.exec('BEGIN');
    try { db.exec(fs.readFileSync(path.join(dir, f), 'utf8')); db.exec(`PRAGMA user_version=${n}`); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
    v = n;
  }
}
migrate();

export function audit(actor, action, entity = '', detail = '', ip = '') {
  q.run('INSERT INTO audit_logs(actor,action,entity,detail,ip,created_at) VALUES(?,?,?,?,?,?)', actor, action, entity, String(detail).slice(0, 1000), ip, now());
}
