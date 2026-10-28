import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
loadEnv(path.join(ROOT, '.env'));

const e = process.env;
const env = e.NODE_ENV || 'development';
export const config = {
  env,
  prod: env === 'production',
  port: Number(e.PORT) || 3000,
  baseUrl: (e.BASE_URL || `http://localhost:${Number(e.PORT) || 3000}`).replace(/\/$/, ''),
  dbPath: e.DB_PATH || path.join(ROOT, 'data', 'electromart.db'),
  uploadDir: e.UPLOAD_DIR || path.join(ROOT, 'data', 'uploads'),
  secret: e.SESSION_SECRET || 'dev-only-secret-change-me',
  ownerUsername: e.OWNER_USERNAME || 'Anup',
  ownerInitialPassword: e.OWNER_INITIAL_PASSWORD || '',
  seedSample: (e.SEED_SAMPLE_DATA ?? (env === 'production' ? 'false' : 'true')) === 'true',
  razorpay: {
    keyId: e.RAZORPAY_KEY_ID || '',
    keySecret: e.RAZORPAY_KEY_SECRET || '',
    webhookSecret: e.RAZORPAY_WEBHOOK_SECRET || '',
  },
};

export function assertProductionConfig(ownerExists) {
  if (!config.prod) return;
  const problems = [];
  if (config.secret.length < 32 || config.secret.startsWith('dev-only')) problems.push('SESSION_SECRET must be a random string of at least 32 characters');
  if (!config.baseUrl.startsWith('https://')) problems.push('BASE_URL must be https:// in production');
  if (!ownerExists && (config.ownerInitialPassword.length < 12 || config.ownerInitialPassword === '9999'))
    problems.push('OWNER_INITIAL_PASSWORD must be at least 12 characters (the development password 9999 is refused in production)');
  if (problems.length) {
    console.error('Refusing to start in production:\n - ' + problems.join('\n - '));
    process.exit(1);
  }
}
