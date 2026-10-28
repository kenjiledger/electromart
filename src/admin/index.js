import { get, post } from '../router.js';
import { q, now } from '../db.js';
import { html, raw, inr, fmtDate, cookie, UserError, label } from '../util.js';
import { csrfField, statusPill, LOGO, ASSET_V } from '../views.js';
import { authenticate, createSession, destroySession, destroyUserSessions, rateLimit, loginLocked, loginFailed, loginOk, verifyPassword, hashPassword, checkPasswordStrength } from '../auth.js';
import { aget, apost, adminPage, log } from './core.js';
import { num } from '../settings.js';
import { renderHome } from '../routes/store.js';
import './products.js';
import './orders.js';
import './misc.js';

const loginPage = (ctx, err, status = 200) => ctx.html(html`<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Owner sign in</title><link rel="stylesheet" href="/css/style.css?v=${ASSET_V}"></head>
<body class="adminlogin"><main class="card pad authbox"><p class="center">${LOGO}</p><h1 class="center">Owner sign in</h1>${err ? html`<p class="flash err" role="alert">${err}</p>` : ''}
<form method="post" action="/admin/login" class="stack">${csrfField(ctx)}<label>Username <input name="username" required autocomplete="username" autofocus></label><label>Password <input type="password" name="password" required autocomplete="current-password"></label><button class="btn btn-orange btn-block">Sign in</button></form><p class="center small"><a href="/">Back to store</a></p></main></body></html>`, status);

get('/admin/login', (ctx) => (ctx.owner ? ctx.redirect('/admin') : loginPage(ctx)));
post('/admin/login', (ctx) => {
  const key = `ol:${ctx.ip}`; const name = String(ctx.body.username || '').trim();
  if (loginLocked(key) || !rateLimit('adminlogin:' + ctx.ip, 20, 900e3)) return loginPage(ctx, 'Too many failed attempts. Try again in 15 minutes.', 429);
  const u = authenticate(name, ctx.body.password, { owner: true });
  if (!u) { loginFailed(key); log({ owner: { username: 'anonymous' }, ip: ctx.ip }, 'owner.login_failed', 'user', name.slice(0, 40)); return loginPage(ctx, 'Incorrect username or password.', 401); }
  loginOk(key);
  destroySession(ctx.cookies.asid); // rotate
  const tok = createSession(u.id, 'owner', ctx.ip);
  ctx.setCookies.push(cookie('asid', tok, { path: '/admin', maxAge: 8 * 3600 }));
  log({ owner: u, ip: ctx.ip }, 'owner.login', 'user', u.username);
  ctx.redirect(u.must_change_password ? '/admin/password' : '/admin');
});
apost('/admin/logout', (ctx) => { destroySession(ctx.cookies.asid); ctx.setCookies.push(cookie('asid', '', { path: '/admin', maxAge: 0 })); ctx.redirect('/admin/login'); }, { allowForcedChange: true });

aget('/admin/password', (ctx) => adminPage(ctx, { title: 'Change owner password', active: '', body: html`${ctx.owner.must_change_password ? html`<p class="flash warn">You are using the temporary initial password. Choose a strong new password to continue.</p>` : ''}<form method="post" class="card pad stack formw">${csrfField(ctx)}<label>Current password <input type="password" name="current" required autocomplete="current-password"></label><label>New password (12+ characters, letters and numbers) <input type="password" name="password" required minlength="12" autocomplete="new-password"></label><label>Confirm new password <input type="password" name="confirm" required autocomplete="new-password"></label><button class="btn btn-orange">Update password</button></form>` }), { allowForcedChange: true });
apost('/admin/password', (ctx) => {
  try {
    if (!verifyPassword(String(ctx.body.current || ''), ctx.owner.pass_hash)) throw new UserError('Current password is incorrect.');
    if (ctx.body.password !== ctx.body.confirm) throw new UserError('New passwords do not match.');
    checkPasswordStrength(ctx.body.password, { owner: true });
    if (ctx.body.password === ctx.body.current) throw new UserError('Choose a password different from the current one.');
    q.run('UPDATE users SET pass_hash=?, must_change_password=0, updated_at=? WHERE id=?', hashPassword(ctx.body.password), now(), ctx.owner.id);
    destroyUserSessions(ctx.owner.id);
    ctx.setCookies.push(cookie('asid', createSession(ctx.owner.id, 'owner', ctx.ip), { path: '/admin', maxAge: 8 * 3600 }));
    log(ctx, 'owner.password_change', 'user', ctx.owner.username);
    ctx.flash('ok', 'Password updated.'); ctx.redirect('/admin');
  } catch (e) { if (!e.user) throw e; ctx.flash('err', e.message); ctx.redirect('/admin/password'); }
}, { allowForcedChange: true });

aget('/admin/preview', (ctx) => {
  ctx.cartCount = 0; ctx.user = null; ctx.url = new URL(ctx.url.href);
  ctx.html(`<!doctype html>` + String(adminPreview(ctx)));
});
import { layout } from '../views.js';
function adminPreview(ctx) { ctx.razorpay = false; return layout(ctx, { title: 'Preview', noindex: true, body: renderHome(ctx, { preview: true }) }); }

/* ---------------- dashboard (all numbers come from the database) ---------------- */
function series(period) {
  const fmt = { day: '%Y-%m-%d', week: '%Y-W%W', month: '%Y-%m' }[period]; const n = { day: 14, week: 12, month: 12 }[period];
  const rows = q.all(`SELECT strftime('${fmt}', datetime(created_at,'+5.5 hours')) k, SUM(total) v, COUNT(*) c FROM orders WHERE status NOT IN('cancelled','returned') GROUP BY k ORDER BY k DESC LIMIT ?`, n).reverse();
  return rows;
}
function chart(rows) {
  if (!rows.length) return html`<p class="muted">No sales yet. The chart fills in as real orders arrive.</p>`;
  const max = Math.max(...rows.map((r) => r.v)), W = 640, H = 200, bw = W / rows.length;
  return html`<svg viewBox="0 0 ${W} ${H + 40}" class="chart" role="img" aria-label="Sales chart">${rows.map((r, i) => { const h = Math.max(2, (r.v / max) * H); return raw(`<g><title>${r.k}: ${inr(r.v)} (${r.c} orders)</title><rect x="${i * bw + 6}" y="${H - h}" width="${bw - 12}" height="${h}" rx="3" fill="#f58a07"/><text x="${i * bw + bw / 2}" y="${H + 16}" text-anchor="middle" font-size="10" fill="#5b6679">${r.k.slice(-5)}</text></g>`); })}</svg>`;
}
aget('/admin', (ctx) => {
  const period = ['day', 'week', 'month'].includes(ctx.query.get('period')) ? ctx.query.get('period') : 'day';
  const live = "status NOT IN('cancelled','returned')";
  const sales = q.get(`SELECT COALESCE(SUM(total),0) s, COUNT(*) n FROM orders WHERE ${live}`);
  const paid = q.get("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE status='paid'").s;
  const thr = num('low_stock_threshold') || 5;
  const STOCK = 'COALESCE((SELECT SUM(stock) FROM variants v WHERE v.product_id=p.id), p.stock)';
  const low = q.all(`SELECT p.id,p.name,${STOCK} s FROM products p WHERE status='published' AND ${STOCK} BETWEEN 1 AND ? ORDER BY s LIMIT 8`, thr);
  const out = q.get(`SELECT COUNT(*) n FROM products p WHERE status='published' AND ${STOCK}<=0`).n;
  const best = q.all(`SELECT oi.name, SUM(oi.qty) qty FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.${live} GROUP BY oi.product_id, oi.name ORDER BY qty DESC LIMIT 5`);
  const recent = q.all('SELECT * FROM orders ORDER BY id DESC LIMIT 8');
  const stat = (t, v, href) => html`<a class="stat card" href="${href || '#'}"><span class="muted small">${t}</span><b>${v}</b></a>`;
  const c = (sql, ...p) => q.get(sql, ...p).n;
  const body = html`<div class="stats">
    ${stat('Total sales (excl. cancelled)', inr(sales.s), '/admin/orders')}${stat('Payments received', inr(paid), '/admin/orders?pay=paid')}${stat('Total orders', sales.n)}${stat('Average order value', sales.n ? inr(Math.round(sales.s / sales.n)) : '-')}
    ${stat('Pending COD orders', c("SELECT COUNT(*) n FROM orders WHERE payment_method='cod' AND status NOT IN('delivered','cancelled','returned')"), '/admin/orders?pm=cod&status=open')}${stat('Payments to verify', c("SELECT COUNT(*) n FROM orders WHERE payment_status='awaiting_verification'"), '/admin/orders?pay=awaiting_verification')}
    ${stat('Pending shipments', c("SELECT COUNT(*) n FROM orders WHERE status IN('placed','confirmed','processing','packed')"), '/admin/orders?status=to_ship')}${stat('Cancelled orders', c("SELECT COUNT(*) n FROM orders WHERE status='cancelled'"), '/admin/orders?status=cancelled')}
    ${stat('Refunds sent', inr(q.get("SELECT COALESCE(SUM(amount),0) s FROM refunds WHERE status='processed'").s))}${stat('Refunds awaiting payout', c("SELECT COUNT(*) n FROM refunds WHERE status IN('approved','processing')"), '/admin/orders?refund=pending')}
    ${stat('New customers (30 days)', c("SELECT COUNT(*) n FROM users WHERE role='customer' AND created_at>=?", new Date(Date.now() - 30 * 86400e3).toISOString()), '/admin/customers')}${stat('Out of stock', out, '/admin/products?stock=out')}</div>
  <section class="card pad"><div class="section-h"><h2>Sales</h2><nav class="tabs">${['day', 'week', 'month'].map((p) => html`<a href="/admin?period=${p}" class="${p === period ? 'cur' : ''}">${label(p)}</a>`)}</nav></div>${chart(series(period))}</section>
  <div class="two"><section class="card pad"><h2>Recent orders</h2>${recent.length ? html`<table class="table"><tbody>${recent.map((o) => html`<tr><td><a href="/admin/orders/${o.number}">${o.number}</a></td><td>${statusPill(o.status)}</td><td>${inr(o.total)}</td></tr>`)}</tbody></table>` : html`<p class="muted">No orders yet.</p>`}</section>
  <section class="card pad"><h2>Best-selling products</h2>${best.length ? html`<ol>${best.map((b) => html`<li>${b.name} &ndash; ${b.qty} sold</li>`)}</ol>` : html`<p class="muted">Appears after the first sales.</p>`}<h2>Low stock (&le; ${thr})</h2>${low.length ? html`<ul>${low.map((p) => html`<li><a href="/admin/products/${p.id}">${p.name}</a> &ndash; ${p.s} left</li>`)}</ul>` : html`<p class="muted">None.</p>`}</section></div>
  <p><a class="btn" href="/admin/preview" target="_blank">Preview homepage with drafts</a></p>`;
  adminPage(ctx, { title: 'Dashboard', active: '/admin', body });
});
