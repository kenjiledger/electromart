import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { config, ROOT } from './config.js';
import { q, now } from './db.js';
import { S, flag, loadSettings } from './settings.js';
import { bootstrapOwner, sessionUser, rateLimit } from './auth.js';
import { match, pathExists } from './router.js';
import { parseCookies, cookie, readBody, parseMultipart, formObject, safeEqual, randomToken, html, UserError } from './util.js';
import { layout } from './views.js';
import { cartCount } from './shop.js';
import { razorpayConfigured } from './orders.js';
import './routes/store.js';
import './routes/account.js';
import './routes/checkout.js';
import './routes/seo.js';
import './admin/index.js';

const MIME = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
const COMPRESSIBLE = /^(text\/|application\/(json|xml)|image\/svg)/;
const PUBLIC_DIR = path.join(ROOT, 'public');

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://checkout.razorpay.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://lumberjack.razorpay.com; frame-src https://api.razorpay.com https://checkout.razorpay.com; form-action 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'");
  if (config.prod) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function send(req, res, status, type, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.setHeader('Vary', 'Accept-Encoding');
  if (COMPRESSIBLE.test(type) && buf.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    const z = zlib.gzipSync(buf); res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Content-Length', z.length); return res.end(req.method === 'HEAD' ? undefined : z);
  }
  res.setHeader('Content-Length', buf.length);
  res.end(req.method === 'HEAD' ? undefined : buf);
}

function serveFile(req, res, root, rel, cache) {
  const file = path.resolve(root, '.' + path.sep + decodeURIComponent(rel));
  if (!file.startsWith(root + path.sep)) return false;
  let st; try { st = fs.statSync(file); } catch { return false; }
  if (!st.isFile()) return false;
  const etag = `W/"${st.size}-${Math.floor(st.mtimeMs)}"`;
  if (req.headers['if-none-match'] === etag) { res.statusCode = 304; res.end(); return true; }
  send(req, res, 200, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', fs.readFileSync(file), { 'Cache-Control': cache, ETag: etag });
  return true;
}

function clientIp(req) { return config.prod && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress || ''; }

export async function handle(req, res) {
  securityHeaders(res);
  const url = new URL(req.url, config.baseUrl);
  const ip = clientIp(req);
  if (!rateLimit('global:' + ip, 600, 60e3)) return send(req, res, 429, 'text/plain', 'Too many requests. Please slow down.');

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (url.pathname.startsWith('/uploads/') && serveFile(req, res, path.resolve(config.uploadDir), url.pathname.slice(9), 'public, max-age=31536000, immutable')) return;
    if (!url.pathname.startsWith('/admin') && serveFile(req, res, PUBLIC_DIR, url.pathname.slice(1) || '.', url.search.includes('v=') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600')) return;
  }

  const ctx = {
    req, res, url, ip, method: req.method === 'HEAD' ? 'GET' : req.method, query: url.searchParams, params: {}, body: {}, files: [], raw: null,
    cookies: parseCookies(req.headers.cookie), setCookies: [], user: null, owner: null, flashMsg: null,
    html: null, redirect: null, json: null, text: null,
  };
  ctx.csrf = ctx.cookies.ct && /^[\w-]{20,}$/.test(ctx.cookies.ct) ? ctx.cookies.ct : randomToken(24);
  if (ctx.csrf !== ctx.cookies.ct) ctx.setCookies.push(cookie('ct', ctx.csrf, { maxAge: 86400 * 30 }));
  ctx.user = sessionUser(ctx.cookies.sid, 'customer');
  if (url.pathname.startsWith('/admin')) ctx.owner = sessionUser(ctx.cookies.asid, 'owner');
  ctx.ownerKey = ctx.user ? 'u:' + ctx.user.id : 'g:' + (ctx.cookies.gid || '');
  if (ctx.cookies.flash) { try { ctx.flashMsg = JSON.parse(ctx.cookies.flash); } catch { /* ignore */ } ctx.setCookies.push(cookie('flash', '', { maxAge: 0 })); }

  const finish = (status, type, body, headers = {}) => {
    if (ctx.setCookies.length) res.setHeader('Set-Cookie', ctx.setCookies);
    send(req, res, status, type, body, headers);
  };
  ctx.html = (body, status = 200) => finish(status, 'text/html; charset=utf-8', String(body), { 'Cache-Control': 'private, no-cache' });
  ctx.json = (obj, status = 200) => finish(status, 'application/json; charset=utf-8', JSON.stringify(obj), { 'Cache-Control': 'no-store' });
  ctx.text = (body, type = 'text/plain; charset=utf-8', headers = {}, status = 200) => finish(status, type, body, headers);
  ctx.redirect = (to, status = 303) => { if (ctx.setCookies.length) res.setHeader('Set-Cookie', ctx.setCookies); res.statusCode = status; res.setHeader('Location', to); res.end(); };
  ctx.flash = (t, m) => ctx.setCookies.push(cookie('flash', JSON.stringify({ t, m }), { maxAge: 60 }));
  ctx.ensureGuest = () => { if (!ctx.user && !ctx.cookies.gid) { ctx.cookies.gid = randomToken(18); ctx.ownerKey = 'g:' + ctx.cookies.gid; ctx.setCookies.push(cookie('gid', ctx.cookies.gid, { maxAge: 86400 * 30 })); } };
  ctx.page = (status, opts) => { ctx.cartCount = cartCount(ctx.ownerKey); ctx.razorpay = razorpayConfigured(); return ctx.html(layout(ctx, opts), status); };
  ctx.notFound = () => {
    const red = q.get('SELECT to_path FROM redirects WHERE from_path=?', url.pathname);
    if (red) return ctx.redirect(red.to_path, 301);
    return ctx.page(404, { title: 'Page not found', noindex: true, body: html`<div class="wrap narrow center"><h1>404 &ndash; Page not found</h1><p>The page you are looking for does not exist or has moved.</p><p><a class="btn btn-orange" href="/">Back to home</a> <a class="btn" href="/search">Search products</a></p></div>` });
  };
  ctx.fail = (status, msg) => ctx.page(status, { title: 'Error', noindex: true, body: html`<div class="wrap narrow center"><h1>${msg}</h1><p><a class="btn" href="/">Back to home</a></p></div>` });

  try {
    const m = match(req.method, url.pathname);
    if (!m) { if (pathExists(url.pathname)) return ctx.fail(405, 'Method not allowed'); return ctx.notFound(); }
    ctx.params = m.params;
    if (ctx.method === 'POST') {
      const ct = req.headers['content-type'] || '';
      const buf = await readBody(req, m.r.opts.limit || (ct.startsWith('multipart') ? 14 * 1024 * 1024 : 256 * 1024));
      ctx.raw = buf;
      if (m.r.opts.csrf !== false) {
        if (ct.startsWith('multipart/form-data')) {
          const b = /boundary=(?:"([^"]+)"|([^;]+))/.exec(ct); const parts = parseMultipart(buf, b ? b[1] || b[2] : '');
          const fields = []; for (const p of parts) { if (p.filename !== undefined) ctx.files.push(p); else fields.push([p.name, p.body.toString('utf8')]); }
          ctx.body = formObject(fields);
        } else if (ct.startsWith('application/json')) { try { ctx.body = JSON.parse(buf.toString('utf8')); } catch { ctx.body = {}; } }
        else ctx.body = formObject(new URLSearchParams(buf.toString('utf8')));
        const tok = ctx.body._csrf || req.headers['x-csrf-token'];
        if (!ctx.cookies.ct || !tok || !safeEqual(tok, ctx.cookies.ct)) return ctx.fail(403, 'Security check failed. Please go back, reload the page and try again.');
      }
    }
    if (!url.pathname.startsWith('/admin') && !ctx.owner && flag('maintenance_mode') && !url.pathname.startsWith('/webhooks')) {
      return ctx.html(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Back soon</title><body style="font-family:system-ui;text-align:center;padding:4rem 1rem"><h1>${S().store_name}</h1><p>We are making improvements and will be back shortly.</p></body>`, 503);
    }
    await m.r.handler(ctx);
  } catch (e) {
    if (res.headersSent) return res.end();
    if (e.user || e.status === 413) return ctx.fail(e.status || 400, e.message);
    const id = crypto.randomBytes(4).toString('hex');
    console.error(`[error ${id}]`, e);
    return ctx.fail(500, `Something went wrong (ref ${id}). Please try again.`);
  }
}

export function createServer() {
  loadSettings();
  bootstrapOwner();
  return http.createServer((req, res) => { handle(req, res).catch((e) => { console.error(e); res.statusCode = 500; res.end('Server error'); }); });
}

if (process.argv[1] && /server\.js$/.test(process.argv[1])) { // works on Windows and Linux
  const { seedIfEmpty } = await import('./seed.js');
  seedIfEmpty();
  createServer().listen(config.port, () => console.log(`The ElectroMart running at ${config.baseUrl}  (admin: ${config.baseUrl}/admin/login)`));
}
