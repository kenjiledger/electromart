import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { boot, ownerClient, regCustomer, OWNER_NEW_PASSWORD } from './helpers.js';

let app;
before(async () => { app = await boot(); });
after(async () => { await app.close(); });

test('customer can register, sign out and sign in again', async () => {
  const c = await regCustomer(app, 1);
  assert.equal((await c.get('/account')).status, 200);
  await c.post('/logout');
  assert.equal((await c.get('/account')).status, 303, 'signed out users are redirected');
  const bad = await c.post('/login', { identifier: 'buyer1@example.com', password: 'wrong-password' });
  assert.equal(bad.status, 401);
  const ok = await c.post('/login', { identifier: 'buyer1@example.com', password: 'password123' });
  assert.equal(ok.status, 303);
  assert.equal((await c.get('/account')).status, 200);
  const byPhone = app.client();
  assert.equal((await byPhone.post('/login', { identifier: '9876543211', password: 'password123' })).status, 303, 'sign in with mobile number');
});

test('registration validates input and rejects duplicates', async () => {
  const c = app.client();
  assert.equal((await c.post('/register', { name: 'A', email: 'x@example.com', password: 'password123' })).status, 400);
  assert.equal((await c.post('/register', { name: 'Dup One', email: 'buyer1@example.com', password: 'password123' })).status, 400);
  assert.equal((await c.post('/register', { name: 'Short Pw', email: 'sp@example.com', password: 'short' })).status, 400);
});

test('passwords are stored hashed, never in plaintext', () => {
  const u = app.q.get("SELECT pass_hash FROM users WHERE email='buyer1@example.com'");
  assert.match(u.pass_hash, /^scrypt\$/); assert.ok(!u.pass_hash.includes('password123'));
});

test('owner (Anup) signs in, is forced to replace the temporary password, then reaches the dashboard', async () => {
  const c = app.client();
  assert.equal((await c.post('/admin/login', { username: 'Anup', password: 'wrong' })).status, 401);
  const r = await c.post('/admin/login', { username: 'Anup', password: '9999' });
  assert.equal(r.location, '/admin/password');
  assert.equal((await c.get('/admin')).location, '/admin/password', 'dashboard blocked until the password is changed');
  assert.equal((await c.post('/admin/password', { current: '9999', password: '9999', confirm: '9999' })).location, '/admin/password');
  assert.equal(app.q.get("SELECT must_change_password m FROM users WHERE role='owner'").m, 1, 'weak password rejected');
  const ok = await c.post('/admin/password', { current: '9999', password: OWNER_NEW_PASSWORD, confirm: OWNER_NEW_PASSWORD });
  assert.equal(ok.location, '/admin');
  assert.equal((await c.get('/admin')).status, 200);
  const again = app.client();
  assert.equal((await again.post('/admin/login', { username: 'Anup', password: '9999' })).status, 401, 'old temporary password no longer works');
  assert.equal((await again.post('/admin/login', { username: 'Anup', password: OWNER_NEW_PASSWORD })).location, '/admin');
});

test('unauthorized users cannot reach the owner dashboard or admin actions', async () => {
  const anon = app.client();
  for (const p of ['/admin', '/admin/orders', '/admin/products', '/admin/settings', '/admin/customers', '/admin/products/export.csv', '/admin/audit']) {
    const r = await anon.get(p); assert.equal(r.status, 303, p); assert.equal(r.location, '/admin/login');
  }
  for (const p of ['/admin/products/save', '/admin/settings', '/admin/coupons/save', '/admin/banners/save', '/admin/orders/EM-100001/status', '/admin/products/bulk']) {
    assert.equal((await anon.post(p, {})).status, 403, 'anonymous POST ' + p);
  }
  const cust = await regCustomer(app, 2);
  assert.equal((await cust.get('/admin')).status, 303, 'a signed-in customer is not the owner');
  assert.equal((await cust.post('/admin/products/save', { name: 'Hack', sku: 'HACK', price: '1' })).status, 403);
  assert.equal(app.q.get("SELECT COUNT(*) n FROM products WHERE sku='HACK'").n, 0);
  // a customer session token must not work as an owner cookie
  const sid = cust.jar.sid.value; const forged = app.client(); forged.jar.asid = { value: sid, path: '/admin' };
  assert.equal((await forged.get('/admin')).status, 303);
});

test('there can only ever be one owner account', async () => {
  const c = app.client();
  await c.post('/register', { name: 'Evil Owner', email: 'evil@example.com', password: 'password123', role: 'owner', username: 'Anup2' });
  assert.equal(app.q.get("SELECT COUNT(*) n FROM users WHERE role='owner'").n, 1);
  assert.throws(() => app.q.run("INSERT INTO users(role,username,pass_hash,created_at,updated_at) VALUES('owner','second','x','a','b')"), /UNIQUE/);
  assert.equal(app.q.get("SELECT role FROM users WHERE email='evil@example.com'").role, 'customer');
});

test('CSRF: state-changing requests without a valid token are rejected', async () => {
  const c = app.client(); await c.get('/login');
  const r = await c.req('POST', '/login', { form: { identifier: 'buyer1@example.com', password: 'password123' } });
  assert.equal(r.status, 403);
  const r2 = await c.req('POST', '/login', { form: { _csrf: 'x'.repeat(30), identifier: 'buyer1@example.com', password: 'password123' } });
  assert.equal(r2.status, 403);
});

test('login rate limiting locks after repeated failures', async () => {
  app.auth.resetLimiters();
  const c = app.client();
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/admin/login', { username: 'Anup', password: 'nope' + i })).status, 401);
  const locked = await c.post('/admin/login', { username: 'Anup', password: OWNER_NEW_PASSWORD });
  assert.equal(locked.status, 429, 'even the correct password is refused while locked');
  app.auth.resetLimiters();
});

test('owner password never appears in public assets, pages or API responses', async () => {
  const c = app.client();
  for (const f of ['public/js/app.js', 'public/css/style.css']) assert.ok(!fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').includes('9999'));
  for (const p of ['/', '/admin/login', '/login', '/api/suggest?q=nova']) { const r = await c.get(p); assert.ok(!r.text.includes('OWNER_INITIAL_PASSWORD')); assert.ok(!/password"?\s*[:=]\s*"?9999/.test(r.text)); }
  assert.ok(!fs.readFileSync(new URL('../src/auth.js', import.meta.url), 'utf8').includes("'9999'"), 'no hard-coded password in source');
});

test('sessions: cookies are HttpOnly and SameSite; logout invalidates the session server-side', async () => {
  const c = app.client(); await c.get('/robots.txt');
  const res = await fetch(app.base + '/login'); const sc = res.headers.getSetCookie().join(' ');
  assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Lax/);
  const o = await ownerClient2(c);
  const tok = o.jar.asid.value; await o.post('/admin/logout');
  const replay = app.client(); replay.jar.asid = { value: tok, path: '/admin' };
  assert.equal((await replay.get('/admin')).status, 303, 'old owner token is dead');
});
async function ownerClient2(c) { await c.post('/admin/login', { username: 'Anup', password: OWNER_NEW_PASSWORD }); return c; }

test('password reset: token is single use and does not reveal whether an account exists', async () => {
  const c = app.client();
  const a = await c.post('/forgot', { email: 'buyer1@example.com' }); const b = await c.post('/forgot', { email: 'nobody@example.com' });
  assert.equal(a.status, b.status);
  const mail = app.q.get("SELECT body FROM notifications WHERE subject='Reset your password' ORDER BY id DESC");
  const token = /reset\/([\w-]+)/.exec(mail.body)[1];
  assert.equal((await c.get('/reset/' + token)).status, 200);
  assert.equal((await c.post('/reset/' + token, { password: 'brand-new-pass1' })).location, '/login');
  assert.equal((await c.get('/reset/' + token)).status, 400, 'token cannot be reused');
  assert.equal((await app.client().post('/login', { identifier: 'buyer1@example.com', password: 'brand-new-pass1' })).status, 303);
});

test('production refuses to start with the development owner password', async () => {
  const { execFileSync } = await import('node:child_process');
  let failed = false;
  try { execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', "import('./src/server.js').then(m=>m.createServer())"], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, NODE_ENV: 'production', DB_PATH: ':memory:', OWNER_INITIAL_PASSWORD: '9999', SESSION_SECRET: 'a'.repeat(40), BASE_URL: 'https://shop.example.com' }, stdio: 'pipe' }); }
  catch (e) { failed = true; assert.match(String(e.stderr), /Refusing to start/); }
  assert.ok(failed);
});
