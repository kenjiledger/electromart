import { get, post } from '../router.js';
import { q, now, tx } from '../db.js';
import { html, raw, inr, fmtDate, isEmail, normPhone, isPin, UserError, cookie, label } from '../util.js';
import { csrfField, productCard, statusPill, imgTag } from '../views.js';
import { hashPassword, verifyPassword, checkPasswordStrength, authenticate, createSession, destroySession, destroyUserSessions, rateLimit, loginLocked, loginFailed, loginOk, issueToken, consumeToken, peekToken } from '../auth.js';
import { cartMerge, getProductsByIds } from '../shop.js';
import { config } from '../config.js';
import { notify } from '../notify.js';
import { safeBack } from './store.js';
import { orderDetail } from './checkout.js';
import { getOrder, customerCancelOrReturn, OPEN, validateAddress } from '../orders.js';

const need = (ctx) => { if (!ctx.user) { ctx.redirect('/login?next=' + encodeURIComponent(ctx.url.pathname)); return false; } return true; };
const field = (name, lbl, o = {}) => html`<label>${lbl}<input name="${name}" type="${o.type || 'text'}" ${o.required ? raw('required') : ''} value="${o.value ?? ''}" ${o.auto ? raw(`autocomplete="${o.auto}"`) : ''} ${o.attrs ? raw(o.attrs) : ''}></label>`;
const authPage = (ctx, title, inner, status = 200) => ctx.page(status, { title, noindex: true, body: html`<div class="wrap narrow"><div class="card pad authbox"><h1>${title}</h1>${inner}</div></div>` });
const errBox = (e) => (e ? html`<p class="flash err" role="alert">${e}</p>` : '');

function startCustomerSession(ctx, user) {
  const tok = createSession(user.id, 'customer', ctx.ip);
  ctx.setCookies.push(cookie('sid', tok, { maxAge: 14 * 86400 }));
  if (ctx.cookies.gid) { cartMerge('g:' + ctx.cookies.gid, 'u:' + user.id); }
}

get('/login', (ctx) => ctx.user ? ctx.redirect('/account') : authPage(ctx, 'Sign in', html`<form method="post" class="stack">${csrfField(ctx)}<input type="hidden" name="next" value="${ctx.query.get('next') || ''}">
  ${field('identifier', 'Email or mobile number', { required: true, auto: 'username' })}${field('password', 'Password', { type: 'password', required: true, auto: 'current-password' })}
  <button class="btn btn-orange btn-block">Sign in</button><p class="small"><a href="/forgot">Forgot password?</a> &middot; New here? <a href="/register">Create an account</a></p></form>`));
post('/login', (ctx) => {
  const id = String(ctx.body.identifier || '').trim().toLowerCase(); const key = `cl:${ctx.ip}:${id}`;
  const again = (m) => authPage(ctx, 'Sign in', html`${errBox(m)}<form method="post" class="stack">${csrfField(ctx)}<input type="hidden" name="next" value="${ctx.body.next || ''}">${field('identifier', 'Email or mobile number', { required: true, value: ctx.body.identifier })}${field('password', 'Password', { type: 'password', required: true })}<button class="btn btn-orange btn-block">Sign in</button><p class="small"><a href="/forgot">Forgot password?</a></p></form>`, 401);
  if (loginLocked(key) || !rateLimit('login:' + ctx.ip, 30, 900e3)) return again('Too many failed attempts. Please wait 15 minutes and try again.');
  const phone = normPhone(ctx.body.identifier);
  const u = authenticate(phone || ctx.body.identifier, ctx.body.password, { owner: false });
  if (!u) { loginFailed(key); return again('Incorrect email/mobile or password.'); }
  loginOk(key);
  startCustomerSession(ctx, u);
  ctx.redirect(safeBack(ctx.body.next, '/account'));
});
post('/logout', (ctx) => { destroySession(ctx.cookies.sid); ctx.setCookies.push(cookie('sid', '', { maxAge: 0 })); ctx.redirect('/'); });

const regForm = (ctx, v = {}, err = '') => html`${errBox(err)}<form method="post" class="stack">${csrfField(ctx)}${field('name', 'Full name', { required: true, value: v.name, auto: 'name' })}${field('email', 'Email', { type: 'email', value: v.email, auto: 'email' })}${field('phone', 'Mobile number (10 digits)', { value: v.phone, auto: 'tel', attrs: 'inputmode="numeric"' })}<p class="muted small">Provide at least one of email or mobile. Email is needed for password reset.</p>${field('password', 'Password (min 8 characters)', { type: 'password', required: true, auto: 'new-password', attrs: 'minlength="8"' })}<button class="btn btn-orange btn-block">Create account</button><p class="small">Already registered? <a href="/login">Sign in</a></p></form>`;
get('/register', (ctx) => ctx.user ? ctx.redirect('/account') : authPage(ctx, 'Create your account', regForm(ctx)));
post('/register', (ctx) => {
  if (!rateLimit('reg:' + ctx.ip, 10, 3600e3)) throw new UserError('Too many sign-ups from this network. Try again later.', 429);
  const b = ctx.body;
  try {
    const name = String(b.name || '').trim(); const email = String(b.email || '').trim().toLowerCase(); const phone = b.phone ? normPhone(b.phone) : null;
    if (name.length < 2 || name.length > 80) throw new UserError('Please enter your name.');
    if (!email && !phone) throw new UserError('Enter an email address or a valid mobile number.');
    if (email && !isEmail(email)) throw new UserError('Enter a valid email address.');
    if (b.phone && !phone) throw new UserError('Enter a valid 10-digit mobile number.');
    checkPasswordStrength(b.password);
    if ((email && q.get('SELECT 1 x FROM users WHERE email=?', email)) || (phone && q.get('SELECT 1 x FROM users WHERE phone=?', phone))) throw new UserError('An account with these details already exists. Try signing in.');
    // role is ALWAYS 'customer' here: the owner role cannot be created through public registration
    const r = q.run("INSERT INTO users(role,email,phone,name,pass_hash,created_at,updated_at) VALUES('customer',?,?,?,?,?,?)", email || null, phone, name, hashPassword(b.password), now(), now());
    const user = q.get('SELECT * FROM users WHERE id=?', Number(r.lastInsertRowid));
    if (email) { const t = issueToken(user.id, 'verify', 7 * 86400e3); notify({ userId: user.id, to: email, subject: 'Verify your email', body: `Confirm your email: ${config.baseUrl}/verify/${t}`, force: true }); }
    startCustomerSession(ctx, user);
    ctx.flash('ok', 'Welcome! Your account is ready.' + (email ? ' Please verify your email using the link we sent.' : ''));
    ctx.redirect(safeBack(b.next, '/account'));
  } catch (e) { if (!e.user) throw e; authPage(ctx, 'Create your account', regForm(ctx, b, e.message), 400); }
});
get('/verify/:token', (ctx) => {
  const uid = consumeToken(ctx.params.token, 'verify');
  if (uid) { q.run('UPDATE users SET email_verified=1 WHERE id=?', uid); ctx.flash('ok', 'Email verified. Thank you!'); } else ctx.flash('err', 'This verification link is invalid or has expired.');
  ctx.redirect(ctx.user ? '/account' : '/login');
});
post('/account/resend-verification', (ctx) => {
  if (!need(ctx)) return;
  if (ctx.user.email && !ctx.user.email_verified && rateLimit('rv:' + ctx.user.id, 3, 3600e3)) { const t = issueToken(ctx.user.id, 'verify', 7 * 86400e3); notify({ userId: ctx.user.id, to: ctx.user.email, subject: 'Verify your email', body: `Confirm your email: ${config.baseUrl}/verify/${t}`, force: true }); ctx.flash('ok', 'Verification email sent.'); }
  ctx.redirect('/account');
});

/* password reset (token is emailed; the response never reveals whether the account exists) */
get('/forgot', (ctx) => authPage(ctx, 'Reset your password', html`<form method="post" class="stack">${csrfField(ctx)}${field('email', 'Email address', { type: 'email', required: true })}<button class="btn btn-orange btn-block">Send reset link</button><p class="muted small">Accounts created with only a mobile number cannot reset by email; contact support.</p></form>`));
post('/forgot', (ctx) => {
  if (!rateLimit('fp:' + ctx.ip, 5, 3600e3)) throw new UserError('Too many requests. Try again later.', 429);
  const email = String(ctx.body.email || '').trim().toLowerCase();
  const u = isEmail(email) ? q.get("SELECT * FROM users WHERE role='customer' AND email=? AND status IN('active','deletion_requested')", email) : null;
  if (u) { const t = issueToken(u.id, 'reset', 3600e3); notify({ userId: u.id, to: email, subject: 'Reset your password', body: `Reset link (valid 1 hour): ${config.baseUrl}/reset/${t}`, force: true }); }
  authPage(ctx, 'Check your email', html`<p>If an account exists for that address, a reset link has been sent. It is valid for one hour.</p>`);
});
get('/reset/:token', (ctx) => peekToken(ctx.params.token, 'reset')
  ? authPage(ctx, 'Choose a new password', html`<form method="post" class="stack">${csrfField(ctx)}${field('password', 'New password (min 8 characters)', { type: 'password', required: true, auto: 'new-password' })}<button class="btn btn-orange btn-block">Update password</button></form>`)
  : authPage(ctx, 'Link expired', html`<p>This reset link is invalid or has expired. <a href="/forgot">Request a new one</a>.</p>`, 400));
post('/reset/:token', (ctx) => {
  try { checkPasswordStrength(ctx.body.password); } catch (e) { ctx.flash('err', e.message); return ctx.redirect('/reset/' + ctx.params.token); }
  const uid = consumeToken(ctx.params.token, 'reset');
  if (!uid) return authPage(ctx, 'Link expired', html`<p>This reset link is invalid or has expired.</p>`, 400);
  q.run("UPDATE users SET pass_hash=?, updated_at=? WHERE id=? AND role='customer'", hashPassword(ctx.body.password), now(), uid);
  destroyUserSessions(uid);
  ctx.flash('ok', 'Password updated. Please sign in.'); ctx.redirect('/login');
});

/* ---------------- account area ---------------- */
const acctNav = (ctx, cur) => html`<nav class="acctnav" aria-label="Account">${[['/account', 'Profile'], ['/account/orders', 'Orders'], ['/account/wishlist', 'Wishlist'], ['/account/addresses', 'Addresses'], ['/account/password', 'Password'], ['/account/privacy', 'Privacy & notifications']].map(([h, t]) => html`<a href="${h}" class="${h === cur ? 'cur' : ''}">${t}</a>`)}</nav>`;
const acctPage = (ctx, cur, title, inner) => ctx.page(200, { title, noindex: true, body: html`<div class="wrap"><h1>${title}</h1><div class="acct-layout">${acctNav(ctx, cur)}<div>${inner}</div></div></div>` });

get('/account', (ctx) => {
  if (!need(ctx)) return; const u = ctx.user;
  acctPage(ctx, '/account', 'My Profile', html`${u.email && !u.email_verified ? html`<form method="post" action="/account/resend-verification" class="flash warn">Your email is not verified. ${csrfField(ctx)}<button class="linklike">Resend verification email</button></form>` : ''}
  <form method="post" action="/account/profile" class="card pad stack">${csrfField(ctx)}${field('name', 'Full name', { required: true, value: u.name })}${field('email', 'Email', { type: 'email', value: u.email })}${field('phone', 'Mobile number', { value: u.phone })}<button class="btn btn-orange">Save changes</button></form>`);
});
post('/account/profile', (ctx) => {
  if (!need(ctx)) return;
  try {
    const name = String(ctx.body.name || '').trim(); const email = String(ctx.body.email || '').trim().toLowerCase(); const phone = ctx.body.phone ? normPhone(ctx.body.phone) : null;
    if (name.length < 2) throw new UserError('Please enter your name.');
    if (!email && !phone) throw new UserError('Keep at least an email or a mobile number on your account.');
    if (email && !isEmail(email)) throw new UserError('Enter a valid email address.');
    if (ctx.body.phone && !phone) throw new UserError('Enter a valid 10-digit mobile number.');
    if (email && q.get('SELECT 1 x FROM users WHERE email=? AND id<>?', email, ctx.user.id)) throw new UserError('That email is already used by another account.');
    if (phone && q.get('SELECT 1 x FROM users WHERE phone=? AND id<>?', phone, ctx.user.id)) throw new UserError('That mobile number is already used by another account.');
    const changed = email !== (ctx.user.email || '');
    q.run('UPDATE users SET name=?, email=?, phone=?, email_verified=CASE WHEN ? THEN 0 ELSE email_verified END, updated_at=? WHERE id=?', name, email || null, phone, changed ? 1 : 0, now(), ctx.user.id);
    ctx.flash('ok', 'Profile updated.');
  } catch (e) { if (!e.user) throw e; ctx.flash('err', e.message); }
  ctx.redirect('/account');
});
get('/account/password', (ctx) => need(ctx) && acctPage(ctx, '/account/password', 'Change Password', html`<form method="post" class="card pad stack">${csrfField(ctx)}${field('current', 'Current password', { type: 'password', required: true, auto: 'current-password' })}${field('password', 'New password (min 8 characters)', { type: 'password', required: true, auto: 'new-password' })}<button class="btn btn-orange">Change password</button></form>`));
post('/account/password', (ctx) => {
  if (!need(ctx)) return;
  try {
    if (!verifyPassword(String(ctx.body.current || ''), ctx.user.pass_hash)) throw new UserError('Your current password is incorrect.');
    checkPasswordStrength(ctx.body.password);
    q.run('UPDATE users SET pass_hash=?, updated_at=? WHERE id=?', hashPassword(ctx.body.password), now(), ctx.user.id);
    destroyUserSessions(ctx.user.id);
    const tok = createSession(ctx.user.id, 'customer', ctx.ip); ctx.setCookies.push(cookie('sid', tok, { maxAge: 14 * 86400 }));
    ctx.flash('ok', 'Password changed. Other devices were signed out.');
  } catch (e) { if (!e.user) throw e; ctx.flash('err', e.message); }
  ctx.redirect('/account/password');
});

/* addresses */
const addrForm = (ctx, a = {}, action = '/account/addresses') => html`<form method="post" action="${action}" class="card pad stack">${csrfField(ctx)}${field('name', 'Recipient name', { required: true, value: a.name })}${field('phone', 'Mobile number', { required: true, value: a.phone })}${field('line1', 'Address line 1', { required: true, value: a.line1 })}${field('line2', 'Address line 2', { value: a.line2 })}<div class="row2">${field('city', 'City', { required: true, value: a.city })}${field('state', 'State', { required: true, value: a.state })}</div>${field('pin', 'PIN code', { required: true, value: a.pin, attrs: 'inputmode="numeric" maxlength="6"' })}<label class="chk"><input type="checkbox" name="is_default" value="1" ${a.is_default ? raw('checked') : ''}> Make default</label><button class="btn btn-orange">Save address</button></form>`;
get('/account/addresses', (ctx) => {
  if (!need(ctx)) return;
  const list = q.all('SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC, id', ctx.user.id);
  acctPage(ctx, '/account/addresses', 'Delivery Addresses', html`${list.map((a) => html`<div class="card pad addr"><p><b>${a.name}</b> ${a.is_default ? html`<span class="pill">Default</span>` : ''}<br>${a.line1}${a.line2 ? ', ' + a.line2 : ''}<br>${a.city}, ${a.state} - ${a.pin}<br>Phone: ${a.phone}</p>
    <form method="post" action="/account/addresses/${a.id}/delete" data-confirm="Delete this address?">${csrfField(ctx)}<button class="btn btn-sm btn-ghost">Delete</button></form></div>`)}<h2>Add a new address</h2>${addrForm(ctx)}`);
});
post('/account/addresses', (ctx) => {
  if (!need(ctx)) return;
  try {
    const a = validateAddress(ctx.body);
    tx(() => { if (ctx.body.is_default) q.run('UPDATE addresses SET is_default=0 WHERE user_id=?', ctx.user.id);
      const first = !q.get('SELECT 1 x FROM addresses WHERE user_id=?', ctx.user.id);
      q.run('INSERT INTO addresses(user_id,name,phone,line1,line2,city,state,pin,is_default) VALUES(?,?,?,?,?,?,?,?,?)', ctx.user.id, a.name, a.phone, a.line1, a.line2, a.city, a.state, a.pin, ctx.body.is_default || first ? 1 : 0); });
    ctx.flash('ok', 'Address saved.');
  } catch (e) { if (!e.user) throw e; ctx.flash('err', e.message); }
  ctx.redirect(safeBack(ctx.body.next, '/account/addresses'));
});
post('/account/addresses/:id/delete', (ctx) => { if (!need(ctx)) return; q.run('DELETE FROM addresses WHERE id=? AND user_id=?', ctx.params.id, ctx.user.id); ctx.flash('ok', 'Address deleted.'); ctx.redirect('/account/addresses'); });

/* wishlist */
get('/account/wishlist', (ctx) => {
  if (!need(ctx)) return;
  const ids = q.all('SELECT product_id FROM wishlist WHERE user_id=? ORDER BY created_at DESC', ctx.user.id).map((r) => r.product_id);
  ctx.wishIds = new Set(ids);
  const items = getProductsByIds(ids);
  acctPage(ctx, '/account/wishlist', 'My Wishlist', items.length ? html`<div class="grid">${items.map((p) => productCard(p, ctx))}</div>` : html`<div class="empty card"><h2>Your wishlist is empty</h2><p>Tap the heart on any product to save it here.</p><a class="btn btn-orange" href="/deals">Browse deals</a></div>`);
});

/* orders */
get('/account/orders', (ctx) => {
  if (!need(ctx)) return;
  const orders = q.all('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 100', ctx.user.id);
  acctPage(ctx, '/account/orders', 'My Orders', orders.length ? orders.map((o) => html`<a class="card pad orderrow" href="/account/orders/${o.number}"><div><b>${o.number}</b><br><span class="muted small">${fmtDate(o.created_at)}</span></div><div>${statusPill(o.status)}</div><div><b>${inr(o.total)}</b></div></a>`) : html`<div class="empty card"><h2>No orders yet</h2><a class="btn btn-orange" href="/">Start shopping</a></div>`);
});
get('/account/orders/:number', (ctx) => {
  if (!need(ctx)) return;
  const o = getOrder(ctx.params.number);
  if (!o || o.user_id !== ctx.user.id) return ctx.notFound();
  acctPage(ctx, '/account/orders', `Order ${o.number}`, orderDetail(ctx, o, { account: true }));
});
post('/account/orders/:number/cancel', (ctx) => {
  if (!need(ctx)) return;
  const o = getOrder(ctx.params.number);
  if (!o || o.user_id !== ctx.user.id) return ctx.notFound();
  try {
    const r = customerCancelOrReturn(o, { reason: ctx.body.reason, details: ctx.body.details });
    ctx.flash('ok', r.instant ? 'Your order has been cancelled. If you already paid, a refund will be arranged and its status shown here.' : 'Your request was submitted. We will review it and update the status here.');
  } catch (e) { if (!e.user) throw e; ctx.flash('err', e.message); }
  ctx.redirect('/account/orders/' + o.number);
});

/* privacy / notifications / deletion */
get('/account/privacy', (ctx) => {
  if (!need(ctx)) return; const u = ctx.user;
  acctPage(ctx, '/account/privacy', 'Privacy & Notifications', html`<form method="post" action="/account/notifications" class="card pad stack">${csrfField(ctx)}<h2>Notifications</h2><label class="chk"><input type="checkbox" name="notify_email" value="1" ${u.notify_email ? raw('checked') : ''}> Order and account emails</label><label class="chk"><input type="checkbox" name="notify_sms" value="1" ${u.notify_sms ? raw('checked') : ''}> SMS updates (when enabled by the store)</label><button class="btn btn-orange">Save preferences</button></form>
  <form method="post" action="/account/delete" class="card pad stack" data-confirm="Request deletion of your account? This cannot be undone.">${csrfField(ctx)}<h2>Delete account</h2><p class="muted">We will remove your profile and saved addresses. Order records are kept in anonymised form where required for tax, warranty and accounting. Accounts with open orders cannot be deleted until those are completed.</p>${field('password', 'Confirm your password', { type: 'password', required: true })}<button class="btn btn-danger">Request account deletion</button></form>`);
});
post('/account/notifications', (ctx) => { if (!need(ctx)) return; q.run('UPDATE users SET notify_email=?, notify_sms=? WHERE id=?', ctx.body.notify_email ? 1 : 0, ctx.body.notify_sms ? 1 : 0, ctx.user.id); ctx.flash('ok', 'Preferences saved.'); ctx.redirect('/account/privacy'); });
post('/account/delete', (ctx) => {
  if (!need(ctx)) return;
  if (!verifyPassword(String(ctx.body.password || ''), ctx.user.pass_hash)) { ctx.flash('err', 'Password is incorrect.'); return ctx.redirect('/account/privacy'); }
  const open = q.get(`SELECT 1 x FROM orders WHERE user_id=? AND status IN (${OPEN.map(() => '?').join(',')})`, ctx.user.id, ...OPEN);
  if (open) { ctx.flash('err', 'You have open orders. Deletion can be requested after they are delivered or cancelled.'); return ctx.redirect('/account/privacy'); }
  q.run("UPDATE users SET status='deletion_requested', updated_at=? WHERE id=?", now(), ctx.user.id);
  ctx.flash('ok', 'Deletion requested. The store owner will process it; you can keep using your account until then.');
  ctx.redirect('/account/privacy');
});

get('/track', (ctx) => {
  const number = (ctx.query.get('number') || '').trim(), contact = (ctx.query.get('contact') || '').trim();
  let result = '';
  if (number && contact) {
    if (!rateLimit('track:' + ctx.ip, 20, 600e3)) throw new UserError('Too many lookups. Please try again later.', 429);
    const o = getOrder(number);
    const ph = normPhone(contact);
    const ok = o && ((ph && o.phone === ph) || (o.email && o.email.toLowerCase() === contact.toLowerCase()));
    result = ok ? orderDetail(ctx, o, { account: false }) : html`<p class="flash err">We could not find an order matching those details.</p>`;
  }
  ctx.page(200, { title: 'Track your order', noindex: true, body: html`<div class="wrap narrow"><h1>Track your order</h1><form class="card pad stack" method="get">${field('number', 'Order number', { required: true, value: number })}${field('contact', 'Phone number or email used on the order', { required: true, value: contact })}<button class="btn btn-orange">Track</button></form>${result}</div>` });
});
export { acctPage };
