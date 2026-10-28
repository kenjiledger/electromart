import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { boot, ownerClient, regCustomer } from './helpers.js';

let app, owner, seq = 0;
before(async () => { app = await boot(); owner = await ownerClient(app); app.q.run("UPDATE settings SET value=value WHERE 0"); });
after(async () => { await app.close(); });

const prod = (like) => app.q.get(`SELECT * FROM products WHERE name LIKE ?`, like);
const ADDR = { name: 'Rita Das', phone: '9876500001', email: 'rita@example.com', line1: '12 MG Road', line2: '', city: 'Guwahati', state: 'Assam', pin: '781001' };
const enableUpi = async () => { await owner.postMultipart('/admin/settings', { upi_enabled: '1', upi_id: 'shop@upi', cod_enabled: '1', tax_percent: '18', delivery_days: '5', return_window_days: '7', shipping_fee: '99', free_ship_threshold: '999', serviceable_pins: '78*, 11*', low_stock_threshold: '5', hero_autoplay_secs: '6', cod_max_order: '500000', upi_qr_path: new Blob([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(30)], { type: 'image/png' }) }); };
async function buy(c, { like = 'Quartz%', qty = 1, method = 'cod', addr = {}, idem } = {}) {
  app.auth.resetLimiters(); // tests place many orders from one IP; the real limiter is exercised separately
  const p = prod(like); await c.post('/cart/add', { product_id: p.id, qty });
  return { p, res: await c.post('/checkout', { ...ADDR, ...addr, method, idem: idem || crypto.randomBytes(16).toString('hex') }) };
}
const lastOrder = () => app.q.get('SELECT * FROM orders ORDER BY id DESC LIMIT 1');

test('COD: order is persisted, stock is reduced, totals are server-computed, confirmation and tracking work', async () => {
  const c = app.client(); const before = prod('Quartz%').stock;
  const { p, res } = await buy(c, { qty: 2 });
  assert.equal(res.status, 303); assert.match(res.location, /^\/order\/EM-\d+\/confirmation$/);
  const o = lastOrder(); assert.match(o.number, /^EM-1000\d\d$/); assert.equal(o.payment_method, 'cod'); assert.equal(o.status, 'placed'); assert.equal(o.payment_status, 'pending');
  assert.equal(o.subtotal, 2 * 29900); assert.equal(o.shipping, 9900); assert.equal(o.total, 2 * 29900 + 9900); assert.equal(o.tax, Math.round(59800 - 59800 / 1.18), 'GST included in item value (after discount); shipping is not separately taxed');
  assert.equal(app.q.get('SELECT stock FROM products WHERE id=?', p.id).stock, before - 2);
  assert.equal(app.q.get('SELECT COUNT(*) n FROM cart_items').n, 0, 'cart emptied');
  const conf = await c.get(res.location); assert.equal(conf.status, 200); assert.match(conf.text, new RegExp(o.number));
  assert.equal((await app.client().get(res.location)).status, 404, 'another visitor cannot open the confirmation');
  const item = app.q.get('SELECT * FROM order_items WHERE order_id=?', o.id); assert.equal(item.unit_price, 29900);
  // tracking by number + phone for guests
  const t = await app.client().get(`/track?number=${o.number}&contact=9876500001`); assert.match(t.text, /Order progress|Order history/);
  assert.match((await app.client().get(`/track?number=${o.number}&contact=9000000000`)).text, /could not find/);
  // historical price snapshot survives later price changes
  app.q.run('UPDATE products SET price=99900, sale_price=NULL WHERE id=?', p.id); assert.equal(app.q.get('SELECT unit_price u FROM order_items WHERE id=?', item.id).u, 29900);
});

test('checkout validation: bad phone, unserviceable PIN, empty cart and tampered payment method are refused', async () => {
  const c = app.client(); const n = () => app.q.get('SELECT COUNT(*) n FROM orders').n; const start = n();
  let r = (await buy(c, { addr: { phone: '123' } })).res; assert.equal(r.location, '/checkout');
  r = await c.post('/checkout', { ...ADDR, pin: '999999', method: 'cod', idem: crypto.randomBytes(16).toString('hex') }); assert.equal(r.location, '/checkout');
  assert.match((await c.get('/checkout')).text, /do not deliver to PIN/);
  r = await c.post('/checkout', { ...ADDR, method: 'bitcoin', idem: crypto.randomBytes(16).toString('hex') }); assert.equal(r.location, '/checkout');
  r = await c.post('/checkout', { ...ADDR, method: 'upi_qr', idem: crypto.randomBytes(16).toString('hex') }); assert.equal(r.location, '/checkout', 'UPI not available until the owner uploads a QR');
  assert.equal(n(), start); assert.equal(app.q.get('SELECT COUNT(*) n FROM cart_items').n, 1);
  const empty = app.client(); assert.equal((await empty.post('/checkout', { ...ADDR, method: 'cod', idem: crypto.randomBytes(16).toString('hex') })).location, '/checkout');
});

test('duplicate submission with the same checkout key creates exactly one order and one stock decrement', async () => {
  app.auth.resetLimiters(); const c = app.client(); const idem = crypto.randomBytes(16).toString('hex'); const start = app.q.get('SELECT COUNT(*) n FROM orders').n; const p = prod('Spark Mixer%'); const s0 = p.stock;
  await c.post('/cart/add', { product_id: p.id, qty: 1 });
  const [a, b] = await Promise.all([1, 2].map(() => c.post('/checkout', { ...ADDR, method: 'cod', idem })));
  assert.equal(app.q.get('SELECT COUNT(*) n FROM orders').n, start + 1); assert.equal(app.q.get('SELECT stock FROM products WHERE id=?', p.id).stock, s0 - 1);
  assert.ok([a, b].every((r) => r.status === 303));
});

test('inventory: two shoppers cannot both buy the last unit', async () => {
  const p = prod('Match Pro%'); app.q.run('UPDATE products SET stock=1 WHERE id=?', p.id);
  const a = app.client(), b = app.client(); await a.post('/cart/add', { product_id: p.id, qty: 1 }); await b.post('/cart/add', { product_id: p.id, qty: 1 });
  const ra = await a.post('/checkout', { ...ADDR, method: 'cod', idem: crypto.randomBytes(16).toString('hex') });
  const rb = await b.post('/checkout', { ...ADDR, method: 'cod', idem: crypto.randomBytes(16).toString('hex') });
  assert.equal([ra, rb].filter((r) => /confirmation/.test(r.location)).length, 1); assert.equal(app.q.get('SELECT stock FROM products WHERE id=?', p.id).stock, 0);
  assert.throws(() => app.q.run('UPDATE products SET stock=-1 WHERE id=?', p.id), /CHECK/, 'database refuses negative stock');
});

test('variant stock is tracked per option', async () => {
  const p = prod('Pulse Smart Watch%'); const v = app.q.get('SELECT * FROM variants WHERE product_id=? ORDER BY id', p.id);
  const c = app.client(); await c.post('/cart/add', { product_id: p.id, variant_id: v.id, qty: 2 });
  const r = await c.post('/checkout', { ...ADDR, method: 'cod', idem: crypto.randomBytes(16).toString('hex') }); assert.match(r.location, /confirmation/);
  assert.equal(app.q.get('SELECT stock FROM variants WHERE id=?', v.id).stock, v.stock - 2);
  const it = app.q.get('SELECT * FROM order_items ORDER BY id DESC'); assert.equal(it.variant_label, v.label);
});

test('coupon is applied at checkout, counted once, and re-validated server-side', async () => {
  const c = await regCustomer(app, 10); const p = prod('Aria Wireless%'); await c.post('/cart/add', { product_id: p.id, qty: 1 }); await c.post('/cart/coupon', { code: 'WELCOME100' });
  const r = await c.post('/checkout', { ...ADDR, method: 'cod', idem: crypto.randomBytes(16).toString('hex') }); assert.match(r.location, /confirmation/);
  const o = lastOrder(); assert.equal(o.discount, 10000); assert.equal(o.coupon_code, 'WELCOME100'); assert.equal(o.total, 1899900 - 10000, 'sale price minus coupon; free shipping above threshold');
  assert.equal(app.q.get("SELECT used_count u FROM coupons WHERE code='WELCOME100'").u, 1);
  await c.post('/cart/add', { product_id: p.id, qty: 1 }); await c.post('/cart/coupon', { code: 'WELCOME100' });
  assert.match((await c.get('/cart')).text, /first order/, 'cannot be reused');
});

test('customer cancels an unprocessed order: instant, stock restored, history kept', async () => {
  const c = await regCustomer(app, 11); const { p, res } = await buy(c, { like: 'Glow Steel%' }); const o = lastOrder(); const s = app.q.get('SELECT stock FROM products WHERE id=?', p.id).stock;
  assert.equal(o.user_id, app.q.get("SELECT id FROM users WHERE email='buyer11@example.com'").id);
  assert.equal((await c.post(`/account/orders/${o.number}/cancel`, { reason: '' })).status, 303); assert.equal(lastOrder().status, 'placed', 'reason required');
  await c.post(`/account/orders/${o.number}/cancel`, { reason: 'Ordered by mistake' });
  assert.equal(lastOrder().status, 'cancelled'); assert.equal(app.q.get('SELECT stock FROM products WHERE id=?', p.id).stock, s + 1);
  assert.ok(app.q.get("SELECT 1 x FROM order_events WHERE order_id=? AND status='cancelled'", o.id));
  await c.post(`/account/orders/${o.number}/cancel`, { reason: 'Ordered by mistake' }); assert.equal(app.q.get('SELECT stock FROM products WHERE id=?', p.id).stock, s + 1, 'no double restock');
  assert.equal((await regCustomer(app, 12)).get(`/account/orders/${o.number}`).then((r) => r.status) instanceof Promise, true);
  const other = await regCustomer(app, 13); assert.equal((await other.get(`/account/orders/${o.number}`)).status, 404, "customers cannot see each other's orders");
});

test('order in processing needs owner approval to cancel; shipped orders cannot be cancelled; delivered orders use returns', async () => {
  const c = await regCustomer(app, 14); await buy(c, { like: 'Hydra Daily%' }); const o = lastOrder();
  await owner.post(`/admin/orders/${o.number}/status`, { status: 'processing', note: 'picking' });
  await c.post(`/account/orders/${o.number}/cancel`, { reason: 'Found a better price' });
  assert.equal(lastOrder().status, 'processing'); const rq = app.q.get("SELECT * FROM order_requests WHERE order_id=? AND status='pending'", o.id); assert.ok(rq);
  await owner.post(`/admin/orders/${o.number}/request/${rq.id}/reject`, { note: 'Already packed' }); assert.equal(lastOrder().status, 'processing'); assert.match((await c.get(`/account/orders/${o.number}`)).text, /Already packed/);
  await c.post(`/account/orders/${o.number}/cancel`, { reason: 'Other' }); const rq2 = app.q.get("SELECT * FROM order_requests WHERE order_id=? AND status='pending'", o.id);
  await owner.post(`/admin/orders/${o.number}/request/${rq2.id}/approve`, { note: '' }); assert.equal(lastOrder().status, 'cancelled');
  const o2 = (await buy(c, { like: 'Hydra Daily%' }), lastOrder());
  assert.equal((await owner.post(`/admin/orders/${o2.number}/status`, { status: 'shipped' })).location, `/admin/orders/${o2.number}`); assert.equal(lastOrder().status, 'placed', 'shipping requires courier/tracking or a note');
  await owner.post(`/admin/orders/${o2.number}/status`, { status: 'shipped', courier: 'BlueDart', tracking_no: 'BD123', tracking_url: 'https://track.example.com/BD123' });
  const shipped = lastOrder(); assert.equal(shipped.status, 'shipped'); assert.equal(shipped.tracking_no, 'BD123');
  assert.match((await c.get(`/account/orders/${o2.number}`)).text, /BD123/); assert.ok(!/Cancel this order|Request cancellation/.test((await c.get(`/account/orders/${o2.number}`)).text));
  await c.post(`/account/orders/${o2.number}/cancel`, { reason: 'Other' }); assert.equal(lastOrder().status, 'shipped');
  await owner.post(`/admin/orders/${o2.number}/status`, { status: 'delivered' }); const d = lastOrder(); assert.equal(d.status, 'delivered'); assert.equal(d.payment_status, 'paid', 'COD collected on delivery');
  await c.post(`/account/orders/${o2.number}/cancel`, { reason: 'Item damaged or defective', details: 'cracked' });
  const ret = app.q.get("SELECT * FROM order_requests WHERE order_id=? AND type='return'", o2.id); assert.ok(ret, 'return request created for delivered order');
  assert.equal((await owner.post(`/admin/orders/${o2.number}/status`, { status: 'placed' })).status, 303);
});

test('return window is enforced', async () => {
  const c = await regCustomer(app, 15); await buy(c, { like: 'Study Smart%' }); const o = lastOrder();
  await owner.post(`/admin/orders/${o.number}/status`, { status: 'delivered' }); app.q.run('UPDATE orders SET delivered_at=? WHERE id=?', new Date(Date.now() - 30 * 864e5).toISOString(), o.id);
  await c.post(`/account/orders/${o.number}/cancel`, { reason: 'No longer needed' }); assert.equal(app.q.get('SELECT COUNT(*) n FROM order_requests WHERE order_id=?', o.id).n, 0);
  assert.match((await c.get(`/account/orders/${o.number}`)).text, /return window has ended/);
});

test('UPI QR: customer submits a reference but the order is NOT paid until the owner verifies it', async () => {
  await enableUpi(); assert.equal(app.q.get("SELECT value v FROM settings WHERE key='upi_enabled'").v, '1', 'owner QR upload enables UPI');
  const c = app.client(); const { res } = await buy(c, { like: 'Drive Car%', method: 'upi_qr' });
  const o = lastOrder(); assert.equal(res.location, `/pay/${o.number}`); const page = await c.get(res.location); assert.match(page.text, /UPI payment QR code/); assert.match(page.text, /upi:\/\/pay\?pa=shop%40upi/);
  assert.equal(o.payment_status, 'pending');
  assert.match((await c.post(`/pay/${o.number}/utr`, { utr: '123' })).location, /pay/, 'short reference refused'); assert.equal(lastOrder().payment_status, 'pending');
  await c.post(`/pay/${o.number}/utr`, { utr: '412345678901' }); assert.equal(lastOrder().payment_status, 'awaiting_verification'); assert.equal(lastOrder().status, 'placed', 'not confirmed by a success page');
  const c2 = app.client(); await buy(c2, { like: 'Drive Car%', method: 'upi_qr' }); const o2 = lastOrder();
  await c2.post(`/pay/${o2.number}/utr`, { utr: '412345678901' }); assert.equal(lastOrder().payment_status, 'pending', 'same reference cannot be reused on another order');
  assert.equal((await app.client().post(`/admin/orders/${o.number}/paid`, {})).status, 403);
  await owner.post(`/admin/orders/${o.number}/paid`, {}); const paid = app.q.get('SELECT * FROM orders WHERE id=?', o.id); assert.equal(paid.payment_status, 'paid'); assert.equal(paid.status, 'confirmed');
  await owner.post(`/admin/orders/${o.number}/paid`, {}); assert.equal(app.q.get("SELECT COUNT(*) n FROM order_events WHERE order_id=? AND status='paid'", o.id).n, 1, 'idempotent');
});

test('refunds: manual refund stays "approved" until the owner records a payout; amounts are capped; COD unpaid has nothing to refund', async () => {
  const o = app.q.get("SELECT * FROM orders WHERE payment_method='upi_qr' AND payment_status='paid'");
  const over = await owner.post(`/admin/orders/${o.number}/refund`, { amount: String(o.total / 100 + 1), reason: 'x' }); assert.equal(app.q.get('SELECT COUNT(*) n FROM refunds WHERE order_id=?', o.id).n, 0);
  await owner.post(`/admin/orders/${o.number}/refund`, { amount: String(o.total / 200), reason: 'Partial return' });
  const r = app.q.get('SELECT * FROM refunds WHERE order_id=?', o.id); assert.equal(r.status, 'approved'); assert.equal(app.q.get('SELECT payment_status s FROM orders WHERE id=?', o.id).s, 'paid', 'not refunded yet');
  assert.match((await app.client().get(`/track?number=${o.number}&contact=${ADDR.phone}`)).text, /Approved - waiting for payout/);
  await owner.post(`/admin/orders/${o.number}/refund/${r.id}/sent`, { reference: '' }); assert.equal(app.q.get('SELECT status s FROM refunds WHERE id=?', r.id).s, 'approved', 'reference required');
  await owner.post(`/admin/orders/${o.number}/refund/${r.id}/sent`, { reference: 'UTR998877' }); assert.equal(app.q.get('SELECT status s FROM refunds WHERE id=?', r.id).s, 'processed'); assert.equal(app.q.get('SELECT payment_status s FROM orders WHERE id=?', o.id).s, 'partially_refunded');
  const rest = o.total - r.amount; await owner.post(`/admin/orders/${o.number}/refund`, { amount: String(rest / 100), reason: 'Rest' }); const r2 = app.q.get('SELECT * FROM refunds WHERE order_id=? ORDER BY id DESC', o.id);
  await owner.post(`/admin/orders/${o.number}/refund/${r2.id}/sent`, { reference: 'UTR112233' }); assert.equal(app.q.get('SELECT payment_status s FROM orders WHERE id=?', o.id).s, 'refunded');
  const cod = app.q.get("SELECT * FROM orders WHERE payment_method='cod' AND payment_status='pending'"); await owner.post(`/admin/orders/${cod.number}/refund`, { amount: '10', reason: 'x' }); assert.equal(app.q.get('SELECT COUNT(*) n FROM refunds WHERE order_id=?', cod.id).n, 0);
});

test('cancelling a paid order creates a refund record (not an automatic claim of refund)', async () => {
  const c = app.client(); await buy(c, { like: 'Drive Car%', method: 'upi_qr' }); const o = lastOrder();
  await c.post(`/pay/${o.number}/utr`, { utr: 'ABCD1234EFGH5678' }); await owner.post(`/admin/orders/${o.number}/paid`, {});
  const cust = await regCustomer(app, 16); app.q.run('UPDATE orders SET user_id=? WHERE id=?', app.q.get("SELECT id FROM users WHERE email='buyer16@example.com'").id, o.id);
  await cust.post(`/account/orders/${o.number}/cancel`, { reason: 'Ordered by mistake' });
  assert.equal(app.q.get('SELECT status s FROM orders WHERE id=?', o.id).s, 'cancelled'); const rf = app.q.get('SELECT * FROM refunds WHERE order_id=?', o.id); assert.equal(rf.status, 'approved'); assert.equal(rf.amount, o.total);
  assert.ok(!/refunded/i.test(app.q.get('SELECT payment_status s FROM orders WHERE id=?', o.id).s));
});

/* ---------------- Razorpay (signature + webhook logic; the live Razorpay API is NOT called in tests) ---------------- */
const SECRET = 'rzp_test_secret', WH = 'whsec_test';
const sign = (k, d) => crypto.createHmac('sha256', k).update(d).digest('hex');
async function rzpOrder() {
  const c = app.client(); await buy(c, { like: 'Quartz%', method: 'razorpay' }); const o = lastOrder(); assert.equal(o.payment_method, 'razorpay');
  const poid = 'order_' + crypto.randomBytes(6).toString('hex'); app.q.run("UPDATE payments SET provider_order_id=? WHERE order_id=?", poid, o.id); return { c, o, poid };
}
test('Razorpay: a success page alone never marks an order paid; a wrong signature is rejected', async () => {
  const { c, o, poid } = await rzpOrder();
  const bad = await c.postJson(`/pay/${o.number}/razorpay/verify`, { razorpay_order_id: poid, razorpay_payment_id: 'pay_1', razorpay_signature: 'forged' }); assert.equal(bad.status, 400);
  assert.notEqual(app.q.get('SELECT payment_status s FROM orders WHERE id=?', o.id).s, 'paid'); (await c.get(`/order/${o.number}/confirmation`)); assert.notEqual(app.q.get('SELECT payment_status s FROM orders WHERE id=?', o.id).s, 'paid');
  const wrongSecret = await c.postJson(`/pay/${o.number}/razorpay/verify`, { razorpay_order_id: poid, razorpay_payment_id: 'pay_1', razorpay_signature: sign('other', `${poid}|pay_1`) }); assert.equal(wrongSecret.status, 400);
  const good = await c.postJson(`/pay/${o.number}/razorpay/verify`, { razorpay_order_id: poid, razorpay_payment_id: 'pay_1', razorpay_signature: sign(SECRET, `${poid}|pay_1`) }); assert.equal(good.json().ok, true);
  assert.equal(app.q.get('SELECT payment_status s FROM orders WHERE id=?', o.id).s, 'paid');
  const again = await c.postJson(`/pay/${o.number}/razorpay/verify`, { razorpay_order_id: poid, razorpay_payment_id: 'pay_1', razorpay_signature: sign(SECRET, `${poid}|pay_1`) });
  assert.equal(app.q.get("SELECT COUNT(*) n FROM order_events WHERE order_id=? AND status='paid'", o.id).n, 1, 'duplicate verification does not double-process');
  assert.equal(app.q.get("SELECT COUNT(*) n FROM payments WHERE order_id=? AND status='paid'", o.id).n, 1);
});
test('Razorpay webhook: signature checked on raw body; duplicate and mismatched events are harmless', async () => {
  const { o, poid } = await rzpOrder(); const w = app.client();
  const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_wh1', order_id: poid, amount: o.total } } } });
  const post = (b, sig, id = 'evt_1') => w.req('POST', '/webhooks/razorpay', { raw: b, headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig, 'x-razorpay-event-id': id } });
  assert.equal((await post(body, 'bad')).status, 400); assert.notEqual(app.q.get('SELECT payment_status s FROM orders WHERE id=?', o.id).s, 'paid');
  assert.equal((await post(body, sign(WH, body))).status, 200); assert.equal(app.q.get('SELECT payment_status s FROM orders WHERE id=?', o.id).s, 'paid');
  const dup = await post(body, sign(WH, body)); assert.equal(dup.json().duplicate, true);
  assert.equal(app.q.get("SELECT COUNT(*) n FROM order_events WHERE order_id=? AND status='paid'", o.id).n, 1);
  const r2 = await rzpOrder(); const wrong = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_wh2', order_id: r2.poid, amount: 100 } } } });
  assert.equal((await post(wrong, sign(WH, wrong), 'evt_2')).status, 200); assert.notEqual(app.q.get('SELECT payment_status s FROM orders WHERE id=?', r2.o.id).s, 'paid', 'amount mismatch is not accepted');
  const failed = JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_f', order_id: r2.poid, error_description: 'Bank declined' } } } });
  await post(failed, sign(WH, failed), 'evt_3'); assert.equal(app.q.get('SELECT payment_status s FROM orders WHERE id=?', r2.o.id).s, 'failed');
  const late = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_wh3', order_id: r2.poid, amount: r2.o.total } } } }); await post(late, sign(WH, late), 'evt_4');
  assert.equal(app.q.get('SELECT payment_status s FROM orders WHERE id=?', r2.o.id).s, 'paid', 'a later successful capture recovers a failed attempt');
});
test('Razorpay: a payment id cannot be replayed against a different order', async () => {
  const a = await rzpOrder(); const b = await rzpOrder();
  await a.c.postJson(`/pay/${a.o.number}/razorpay/verify`, { razorpay_order_id: a.poid, razorpay_payment_id: 'pay_same', razorpay_signature: sign(SECRET, `${a.poid}|pay_same`) });
  const r = await b.c.postJson(`/pay/${b.o.number}/razorpay/verify`, { razorpay_order_id: b.poid, razorpay_payment_id: 'pay_same', razorpay_signature: sign(SECRET, `${b.poid}|pay_same`) });
  assert.notEqual(app.q.get('SELECT payment_status s FROM orders WHERE id=?', b.o.id).s, 'paid');
});
test('Razorpay refund webhook finalises a gateway refund only when the gateway confirms it', async () => {
  const { c, o, poid } = await rzpOrder(); await c.postJson(`/pay/${o.number}/razorpay/verify`, { razorpay_order_id: poid, razorpay_payment_id: 'pay_rf', razorpay_signature: sign(SECRET, `${poid}|pay_rf`) });
  const pay = app.q.get('SELECT id FROM payments WHERE order_id=?', o.id); app.q.run("INSERT INTO refunds(order_id,payment_id,amount,status,provider_refund_id,created_at,updated_at) VALUES(?,?,?,'processing','rfnd_1','a','a')", o.id, pay.id, o.total);
  assert.equal(app.q.get('SELECT payment_status s FROM orders WHERE id=?', o.id).s, 'paid');
  const body = JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_rf' } } } });
  await app.client().req('POST', '/webhooks/razorpay', { raw: body, headers: { 'content-type': 'application/json', 'x-razorpay-signature': sign(WH, body), 'x-razorpay-event-id': 'evt_rf' } });
  assert.equal(app.q.get('SELECT status s FROM refunds WHERE provider_refund_id=?', 'rfnd_1').s, 'processed'); assert.equal(app.q.get('SELECT payment_status s FROM orders WHERE id=?', o.id).s, 'refunded');
});

test('analytics come from real order data, and admin can export orders; audit log records admin actions', async () => {
  const dash = (await owner.get('/admin')).text; assert.match(dash, /Total orders/); const n = app.q.get("SELECT COUNT(*) n FROM orders WHERE status NOT IN('cancelled','returned')").n; assert.match(dash, new RegExp(`<b>${n}</b>`));
  assert.match((await owner.get('/admin/orders?q=Rita')).text, /EM-1000/); assert.match((await owner.get('/admin/orders/export.csv')).text, /^order,date,name/);
  assert.match((await owner.get('/admin/orders?pay=awaiting_verification')).text, /orders|Order/); assert.equal((await owner.get(`/admin/orders/${lastOrder().number}/invoice`)).status, 200);
  const audit = (await owner.get('/admin/audit')).text; assert.match(audit, /order\.mark_paid/); assert.match(audit, /owner\.login/);
  assert.equal(app.q.get("SELECT COUNT(*) n FROM audit_logs WHERE actor='Anup'").n > 3, true);
});

test('customers: wishlist, address book, reviews only after delivery, account deletion request & erasure', async () => {
  const c = await regCustomer(app, 20); const p = prod('Hydra Daily%');
  await c.post('/wishlist/toggle', { product_id: p.id, back: '/' }); assert.equal(app.q.get('SELECT COUNT(*) n FROM wishlist').n >= 1, true); assert.match((await c.get('/account/wishlist')).text, /Hydra Daily/);
  await c.post('/account/addresses', { ...ADDR, is_default: '1' }); assert.equal(app.q.get('SELECT COUNT(*) n FROM addresses').n, 1);
  assert.equal((await c.post(`/p/${p.slug}/review`, { rating: '5', title: 't', body: 'b' })).status, 403, 'no delivered order, no review');
  await buy(c, { like: 'Hydra Daily%' }); const o = lastOrder(); await owner.post(`/admin/orders/${o.number}/status`, { status: 'delivered' });
  assert.equal((await c.post(`/p/${p.slug}/review`, { rating: '5', title: 'Great', body: 'Works well' })).status, 303);
  const page = (await app.client().get(`/p/${p.slug}`)).text; assert.match(page, /Great/); assert.match(page, /"aggregateRating"/);
  const open = await regCustomer(app, 21); await buy(open, { like: 'Hydra Daily%' });
  await open.post('/account/delete', { password: 'password123' }); assert.equal(app.q.get("SELECT status s FROM users WHERE email='buyer21@example.com'").s, 'active', 'open orders block deletion');
  await c.post('/account/delete', { password: 'password123' }); const u = app.q.get("SELECT * FROM users WHERE email='buyer20@example.com'"); assert.equal(u.status, 'deletion_requested');
  assert.equal((await app.client().post(`/admin/customers/${u.id}/delete`, {})).status, 403);
  await owner.post(`/admin/customers/${u.id}/delete`, {}); const gone = app.q.get('SELECT * FROM users WHERE id=?', u.id); assert.equal(gone.email, null); assert.equal(gone.status, 'deleted'); assert.ok(app.q.get('SELECT 1 x FROM orders WHERE id=?', o.id), 'order retained');
  const cust = app.q.get("SELECT id FROM users WHERE email='buyer21@example.com'"); await owner.post(`/admin/customers/${cust.id}/suspend`, {}); assert.equal((await app.client().post('/login', { identifier: 'buyer21@example.com', password: 'password123' })).status, 401);
  assert.ok(!(await owner.get('/admin/customers')).text.includes('scrypt'), 'no password hashes in admin');
});

test('checkout is rate limited per IP', async () => {
  app.auth.resetLimiters(); const c = app.client(); let last;
  for (let i = 0; i < 22; i++) last = await c.post('/checkout', { ...ADDR, method: 'cod', idem: crypto.randomBytes(16).toString('hex') });
  assert.equal(last.status, 429); app.auth.resetLimiters();
});

test('maintenance mode blocks the storefront but not the owner; PIN rules gate delivery promises', async () => {
  const pin = (await app.client().get('/api/pin?pin=781001')).json(); assert.equal(pin.ok, true); assert.equal((await app.client().get('/api/pin?pin=999999')).json().ok, false);
  const base = { cod_enabled: '1', tax_percent: '18', delivery_days: '5', return_window_days: '7', shipping_fee: '99', free_ship_threshold: '999', serviceable_pins: '78*', low_stock_threshold: '5', hero_autoplay_secs: '6', cod_max_order: '500000' };
  await owner.postMultipart('/admin/settings', { ...base, maintenance_mode: '1' }); assert.equal((await app.client().get('/')).status, 503); assert.equal((await owner.get('/admin')).status, 200);
  await owner.postMultipart('/admin/settings', { ...base }); assert.equal((await app.client().get('/')).status, 200);
  assert.equal((await owner.postMultipart('/admin/settings', { ...base, serviceable_pins: 'abc' })).status, 303); assert.match((await owner.get('/admin/settings')).text, /78\*/);
});
