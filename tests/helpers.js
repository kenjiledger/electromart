// Test harness: boots the real server in-process on a random port with an in-memory database.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
Object.assign(process.env, {
  NODE_ENV: 'test', DB_PATH: ':memory:', SEED_SAMPLE_DATA: 'true', OWNER_USERNAME: 'Anup', OWNER_INITIAL_PASSWORD: '9999', SESSION_SECRET: 'test-secret-test-secret-test-secret-123',
  RAZORPAY_KEY_ID: 'rzp_test_key', RAZORPAY_KEY_SECRET: 'rzp_test_secret', RAZORPAY_WEBHOOK_SECRET: 'whsec_test', UPLOAD_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'em-up-')),
});
export const OWNER_NEW_PASSWORD = 'Str0ng-Owner-Pass-2026';

export class Client {
  constructor(base) { this.base = base; this.jar = {}; }
  cookieHeader(p) { return Object.entries(this.jar).filter(([, c]) => p.startsWith(c.path)).map(([k, c]) => `${k}=${c.value}`).join('; '); }
  store(res) {
    for (const sc of res.headers.getSetCookie?.() || []) {
      const [pair, ...attrs] = sc.split(';'); const i = pair.indexOf('='); const name = pair.slice(0, i).trim(); const value = pair.slice(i + 1);
      const path = (attrs.find((a) => /^\s*path=/i.test(a)) || '=/').split('=')[1].trim(); const age = attrs.find((a) => /^\s*max-age=/i.test(a));
      if (age && Number(age.split('=')[1]) <= 0) delete this.jar[name]; else this.jar[name] = { value, path };
    }
  }
  async req(method, p, { form, json, multipart, headers = {}, raw } = {}) {
    const h = { ...headers }; const cookie = this.cookieHeader(p.split('?')[0]); if (cookie) h.cookie = cookie;
    let body;
    if (form) { body = new URLSearchParams(form).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; }
    else if (json) { body = JSON.stringify(json); h['content-type'] = 'application/json'; }
    else if (multipart) { const fd = new FormData(); for (const [k, v] of Object.entries(multipart)) { if (v instanceof Blob) fd.append(k, v, v.name || 'file'); else fd.append(k, String(v)); } body = fd; }
    else if (raw !== undefined) body = raw;
    const res = await fetch(this.base + p, { method, headers: h, body, redirect: 'manual' });
    this.store(res);
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, location: res.headers.get('location'), json: () => JSON.parse(text) };
  }
  get(p) { return this.req('GET', p); }
  async csrf() { if (!this.jar.ct) await this.get('/robots.txt'); return this.jar.ct.value; }
  async post(p, data = {}, opts = {}) { const t = await this.csrf(); return this.req('POST', p, { form: { _csrf: t, ...data }, ...opts }); }
  async postJson(p, data = {}) { const t = await this.csrf(); return this.req('POST', p, { json: data, headers: { 'x-csrf-token': t } }); }
  async postMultipart(p, data = {}) { const t = await this.csrf(); return this.req('POST', p, { multipart: { _csrf: t, ...data } }); }
}

export async function boot() {
  const { createServer } = await import('../src/server.js');
  const { seedIfEmpty } = await import('../src/seed.js');
  seedIfEmpty();
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const db = await import('../src/db.js');
  const auth = await import('../src/auth.js');
  return { server, base, q: db.q, db, auth, client: () => new Client(base), close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
export async function ownerClient(app) {
  const c = app.client();
  let r = await c.post('/admin/login', { username: 'Anup', password: '9999' });
  if (r.location !== '/admin/password') throw new Error('expected forced password change, got ' + r.status + ' ' + r.location);
  r = await c.post('/admin/password', { current: '9999', password: OWNER_NEW_PASSWORD, confirm: OWNER_NEW_PASSWORD });
  if (r.location !== '/admin') throw new Error('password change failed: ' + r.status + r.text.slice(0, 200));
  return c;
}
export const regCustomer = async (app, n = 1) => {
  const c = app.client();
  const r = await c.post('/register', { name: 'Test Buyer ' + n, email: `buyer${n}@example.com`, phone: '98765' + String(43210 + n), password: 'password123' });
  if (r.status !== 303) throw new Error('register failed ' + r.status + r.text.slice(0, 300));
  return c;
};
export const firstProduct = (app, where = '1=1') => app.q.get(`SELECT * FROM products WHERE status='published' AND ${where} ORDER BY id`);
