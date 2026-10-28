import crypto from 'node:crypto';
import { q, now, tx, audit } from './db.js';
import { config, assertProductionConfig } from './config.js';
import { sha256, randomToken, safeEqual, UserError } from './util.js';

/* ---------- password hashing (scrypt, per-user salt) ---------- */
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}
export function verifyPassword(pw, stored) {
  const [alg, s, h] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const hh = crypto.scryptSync(pw, Buffer.from(s, 'base64'), 64, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(hh, Buffer.from(h, 'base64'));
}
const DUMMY = hashPassword('dummy-password-for-timing');

export function checkPasswordStrength(pw, { owner = false } = {}) {
  if (typeof pw !== 'string') throw new UserError('Password is required.');
  if (owner) {
    if (pw.length < 12 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw new UserError('Owner password must be at least 12 characters and include letters and numbers.');
  } else if (pw.length < 8) throw new UserError('Password must be at least 8 characters.');
  if (pw.length > 200) throw new UserError('Password is too long.');
}

/* ---------- sessions: random token in cookie, only its SHA-256 is stored ---------- */
export const SESSION_TTL = { customer: 14 * 86400e3, owner: 8 * 3600e3 };
export function createSession(userId, kind, ip) {
  const token = randomToken(32);
  q.run('INSERT INTO sessions(id,user_id,kind,ip,expires_at,created_at) VALUES(?,?,?,?,?,?)', sha256(token), userId, kind, ip, new Date(Date.now() + SESSION_TTL[kind]).toISOString(), now());
  return token;
}
export function sessionUser(token, kind) {
  if (!token) return null;
  const s = q.get('SELECT * FROM sessions WHERE id=? AND kind=?', sha256(token), kind);
  if (!s) return null;
  if (s.expires_at < now()) { q.run('DELETE FROM sessions WHERE id=?', s.id); return null; }
  const u = q.get('SELECT * FROM users WHERE id=?', s.user_id);
  if (!u || u.status === 'suspended' || u.status === 'deleted') return null;
  if (kind === 'owner' && u.role !== 'owner') return null;
  if (kind === 'customer' && u.role !== 'customer') return null;
  return u;
}
export const destroySession = (token) => token && q.run('DELETE FROM sessions WHERE id=?', sha256(token));
export const destroyUserSessions = (uid) => q.run('DELETE FROM sessions WHERE user_id=?', uid);

/* ---------- rate limiting (in-memory; use a shared store such as Redis if you run several instances) ---------- */
const buckets = new Map();
export function rateLimit(key, max, windowMs) {
  const t = Date.now(); let b = buckets.get(key);
  if (!b || b.reset < t) { b = { n: 0, reset: t + windowMs }; buckets.set(key, b); }
  b.n++;
  if (buckets.size > 20000) for (const [k, v] of buckets) if (v.reset < t) buckets.delete(k);
  return b.n <= max;
}
const fails = new Map();
export function loginLocked(key) { const f = fails.get(key); return !!f && f.until > Date.now(); }
export function loginFailed(key, max = 5, lockMs = 15 * 60e3) {
  const f = fails.get(key) || { n: 0, until: 0 }; f.n++;
  if (f.n >= max) { f.until = Date.now() + lockMs; f.n = 0; }
  fails.set(key, f);
}
export const loginOk = (key) => fails.delete(key);
export const resetLimiters = () => { buckets.clear(); fails.clear(); };

/* ---------- authentication ---------- */
export function authenticate(identifier, password, { owner }) {
  const id = String(identifier || '').trim();
  const u = owner
    ? q.get("SELECT * FROM users WHERE role='owner' AND username=?", id)
    : q.get("SELECT * FROM users WHERE role='customer' AND (email=? OR phone=?)", id, id);
  const ok = verifyPassword(String(password || ''), u ? u.pass_hash : DUMMY); // constant-time-ish even when user is unknown
  if (!u || !ok || u.status === 'suspended' || u.status === 'deleted') return null;
  return u;
}

/* ---------- one-time tokens (password reset / email verification) ---------- */
export function issueToken(userId, purpose, ttlMs) {
  const t = randomToken(32);
  q.run('INSERT INTO tokens(user_id,purpose,token_hash,expires_at) VALUES(?,?,?,?)', userId, purpose, sha256(t), new Date(Date.now() + ttlMs).toISOString());
  return t;
}
export function consumeToken(token, purpose) {
  return tx(() => {
    const r = q.get('SELECT * FROM tokens WHERE token_hash=? AND purpose=? AND used_at IS NULL', sha256(token || ''), purpose);
    if (!r || r.expires_at < now()) return null;
    q.run('UPDATE tokens SET used_at=? WHERE id=?', now(), r.id);
    return r.user_id;
  });
}
export function peekToken(token, purpose) {
  const r = q.get('SELECT * FROM tokens WHERE token_hash=? AND purpose=? AND used_at IS NULL', sha256(token || ''), purpose);
  return r && r.expires_at >= now() ? r : null;
}

/* ---------- owner bootstrap: exactly one owner, password from server-side env, forced change at first login ---------- */
export function bootstrapOwner() {
  const owner = q.get("SELECT id FROM users WHERE role='owner'");
  assertProductionConfig(!!owner);
  if (owner) return;
  const pw = config.ownerInitialPassword;
  if (!pw) { console.warn('No owner exists and OWNER_INITIAL_PASSWORD is not set; the owner cannot sign in. Run: npm run owner:reset'); return; }
  q.run("INSERT INTO users(role,username,name,pass_hash,must_change_password,email_verified,created_at,updated_at) VALUES('owner',?,?,?,1,1,?,?)", config.ownerUsername, config.ownerUsername, hashPassword(pw), now(), now());
  audit('system', 'owner.bootstrap', 'user', config.ownerUsername);
  console.log(`Owner account "${config.ownerUsername}" created. The initial password must be changed at first sign-in.`);
}
export { safeEqual };
