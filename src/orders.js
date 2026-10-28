/* Orders, payments, cancellations, returns and refunds. All money is integer paise and recomputed on the server. */
import crypto from 'node:crypto';
import { q, now, tx } from './db.js';
import { S, num, flag, setSetting, pinInfo } from './settings.js';
import { cartLines, calcTotals, codAllowed } from './shop.js';
import { UserError, isPin, normPhone, isEmail, safeEqual, hmac } from './util.js';
import { config } from './config.js';
import { notify } from './notify.js';

export const STATUSES = ['placed', 'confirmed', 'processing', 'packed', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'returned'];
export const OPEN = ['placed', 'confirmed', 'processing', 'packed', 'shipped', 'out_for_delivery'];
export const razorpayConfigured = () => !!(config.razorpay.keyId && config.razorpay.keySecret);
export const upiConfigured = () => flag('upi_enabled') && !!S().upi_qr_path;

export function addEvent(orderId, kind, status, note, actor) {
  q.run('INSERT INTO order_events(order_id,kind,status,note,actor,created_at) VALUES(?,?,?,?,?,?)', orderId, kind, status || '', note || '', actor || 'system', now());
}
export const getOrder = (number) => q.get('SELECT * FROM orders WHERE number=?', number);
export const orderItems = (id) => q.all('SELECT * FROM order_items WHERE order_id=? ORDER BY id', id);
export const orderEvents = (id) => q.all('SELECT * FROM order_events WHERE order_id=? ORDER BY id', id);
export const paidAmount = (id) => q.get("SELECT COALESCE(SUM(amount),0) n FROM payments WHERE order_id=? AND status='paid'", id).n;
export const refundedAmount = (id) => q.get("SELECT COALESCE(SUM(amount),0) n FROM refunds WHERE order_id=? AND status IN('approved','processing','processed')", id).n;
export const refundedDone = (id) => q.get("SELECT COALESCE(SUM(amount),0) n FROM refunds WHERE order_id=? AND status='processed'", id).n;

function nextNumber() {
  const n = (Number(S().order_seq) || 100000) + 1;
  setSetting('order_seq', n);
  return `${S().order_prefix || 'EM-'}${n}`;
}

export function validateContact({ name, phone, email }) {
  name = String(name || '').trim(); email = String(email || '').trim();
  if (name.length < 2 || name.length > 80) throw new UserError('Please enter the recipient name.');
  const ph = normPhone(phone);
  if (!ph) throw new UserError('Please enter a valid 10-digit Indian mobile number.');
  if (email && !isEmail(email)) throw new UserError('Please enter a valid email address.');
  return { name, phone: ph, email };
}
export function validateAddress(a) {
  const c = validateContact(a);
  const line1 = String(a.line1 || '').trim(), city = String(a.city || '').trim(), state = String(a.state || '').trim();
  if (line1.length < 4) throw new UserError('Please enter the delivery address.');
  if (!city || !state) throw new UserError('Please enter city and state.');
  if (!isPin(a.pin)) throw new UserError('Please enter a valid 6-digit PIN code.');
  return { ...c, line1: line1.slice(0, 200), line2: String(a.line2 || '').trim().slice(0, 200), city: city.slice(0, 60), state: state.slice(0, 60), pin: String(a.pin) };
}

/** Creates the order atomically: re-validates stock, coupon and prices; decrements stock; idempotent per idemKey. */
export function placeOrder({ user, ownerKey, contact, address, method, couponCode, idemKey, actor }) {
  if (!['cod', 'upi_qr', 'razorpay'].includes(method)) throw new UserError('Please choose a payment method.');
  if (!idemKey || idemKey.length < 16) throw new UserError('Invalid checkout session. Please reload checkout and try again.');
  return tx(() => {
    const dup = q.get('SELECT * FROM orders WHERE idempotency_key=?', idemKey);
    if (dup) return { order: dup, duplicate: true };
    const lines = cartLines(ownerKey);
    if (!lines.length) throw new UserError('Your cart is empty.');
    const bad = lines.find((l) => l.problem);
    if (bad) throw new UserError(`${bad.product.name}: ${bad.problem}. Please update your cart.`);
    if (!pinInfo(address.pin).ok) throw new UserError(`Sorry, we do not deliver to PIN code ${address.pin} yet.`);
    const t = calcTotals(lines, { couponCode, user });
    if (couponCode && t.couponError) throw new UserError(t.couponError);
    if (method === 'cod' && !codAllowed(t.total)) throw new UserError('Cash on Delivery is not available for this order.');
    if (method === 'upi_qr' && !upiConfigured()) throw new UserError('UPI QR payment is not available right now.');
    if (method === 'razorpay' && !razorpayConfigured()) throw new UserError('Online payment is not available right now.');

    for (const l of lines) { // concurrency-safe stock decrement: only succeeds if enough stock remains
      const r = l.variant
        ? q.run('UPDATE variants SET stock=stock-? WHERE id=? AND stock>=?', l.qty, l.variant.id, l.qty)
        : q.run('UPDATE products SET stock=stock-? WHERE id=? AND stock>=?', l.qty, l.product.id, l.qty);
      if (r.changes !== 1) throw new UserError(`${l.product.name} just went out of stock.`);
    }
    if (t.coupon) {
      const r = q.run('UPDATE coupons SET used_count=used_count+1 WHERE id=? AND (usage_limit=0 OR used_count<usage_limit)', t.coupon.id);
      if (r.changes !== 1) throw new UserError('This coupon has reached its usage limit.');
    }
    const number = nextNumber(); const ts = now();
    const info = q.run(`INSERT INTO orders(number,user_id,email,phone,name,ship_address,pin,subtotal,discount,shipping,tax,total,coupon_code,payment_method,idempotency_key,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, number, user?.id ?? null, contact.email, contact.phone, contact.name,
      JSON.stringify({ name: address.name, phone: address.phone, line1: address.line1, line2: address.line2, city: address.city, state: address.state, pin: address.pin }),
      address.pin, t.subtotal, t.discount, t.shipping, t.tax, t.total, t.coupon?.code || '', method, idemKey, ts, ts);
    const orderId = Number(info.lastInsertRowid);
    for (const l of lines) {
      q.run('INSERT INTO order_items(order_id,product_id,variant_id,name,variant_label,sku,unit_price,mrp,qty,image) VALUES(?,?,?,?,?,?,?,?,?,?)',
        orderId, l.product.id, l.variant?.id || 0, l.product.name, l.variant?.label || '', l.variant?.sku || l.product.sku, l.unit, l.mrp, l.qty, l.image);
    }
    if (method !== 'cod') q.run("INSERT INTO payments(order_id,provider,amount,status,created_at,updated_at) VALUES(?,?,?,'created',?,?)", orderId, method, t.total, ts, ts);
    addEvent(orderId, 'order', 'placed', method === 'cod' ? 'Order placed (Cash on Delivery)' : 'Order placed, awaiting payment', actor || 'customer');
    q.run('DELETE FROM cart_items WHERE owner_key=?', ownerKey);
    const order = q.get('SELECT * FROM orders WHERE id=?', orderId);
    if (contact.email) notify({ userId: user?.id, to: contact.email, subject: `Order ${number} received`, body: `Thank you! We received your order ${number} for ₹${(t.total / 100).toFixed(2)}.` });
    return { order, duplicate: false };
  });
}

/* ---------------- payments ---------------- */
const UTR_RE = /^[A-Za-z0-9]{10,30}$/;
/** Customer reports a manual UPI payment. The order is NOT marked paid; the owner must verify it in the bank statement. */
export function submitUtr(order, utr) {
  utr = String(utr || '').trim().toUpperCase();
  if (order.payment_method !== 'upi_qr') throw new UserError('This order does not use UPI QR payment.');
  if (['paid', 'refunded'].includes(order.payment_status) || order.status === 'cancelled') throw new UserError('Payment cannot be submitted for this order.');
  if (!UTR_RE.test(utr)) throw new UserError('Enter the 12-digit UPI transaction / UTR reference shown in your UPI app.');
  return tx(() => {
    const clash = q.get('SELECT order_id FROM payments WHERE utr=? AND order_id<>?', utr, order.id);
    if (clash) throw new UserError('This reference number has already been used for another order. Please contact support.');
    q.run("UPDATE payments SET utr=?, status='awaiting_verification', updated_at=? WHERE order_id=? AND provider='upi_qr'", utr, now(), order.id);
    q.run("UPDATE orders SET payment_status='awaiting_verification', updated_at=? WHERE id=?", now(), order.id);
    addEvent(order.id, 'payment', '', `Customer submitted UPI reference ${utr}. Awaiting owner verification.`, 'customer');
  });
}
export function markPaid(order, { note = '', actor = 'system', providerPaymentId = null } = {}) {
  return tx(() => {
    const o = q.get('SELECT * FROM orders WHERE id=?', order.id);
    if (o.payment_status === 'paid') return false; // idempotent
    if (o.status === 'cancelled') throw new UserError('Cancelled orders cannot be marked paid.');
    q.run("UPDATE payments SET status='paid', provider_payment_id=COALESCE(?,provider_payment_id), updated_at=? WHERE order_id=? AND provider=?", providerPaymentId, now(), o.id, o.payment_method);
    if (o.payment_method === 'cod') {
      if (!q.get('SELECT 1 x FROM payments WHERE order_id=?', o.id)) q.run("INSERT INTO payments(order_id,provider,amount,status,created_at,updated_at) VALUES(?,?,?,'paid',?,?)", o.id, 'cod', o.total, now(), now());
    }
    q.run("UPDATE orders SET payment_status='paid', status=CASE WHEN status='placed' THEN 'confirmed' ELSE status END, updated_at=? WHERE id=?", now(), o.id);
    addEvent(o.id, 'payment', 'paid', note || 'Payment received', actor);
    if (o.email) notify({ userId: o.user_id, to: o.email, subject: `Payment received for ${o.number}`, body: 'We have received your payment. Thank you!' });
    return true;
  });
}
export function markPaymentFailed(order, reason, actor) {
  q.run("UPDATE payments SET status='failed', failure_reason=?, updated_at=? WHERE order_id=? AND status<>'paid'", reason || '', now(), order.id);
  q.run("UPDATE orders SET payment_status='failed', updated_at=? WHERE id=? AND payment_status<>'paid'", now(), order.id);
  addEvent(order.id, 'payment', 'failed', reason || 'Payment marked as failed', actor);
}

/* ---- Razorpay (official REST API; verified server-side). Requires RAZORPAY_* env vars. ---- */
const rz = (path, opts = {}) => fetch('https://api.razorpay.com/v1' + path, {
  ...opts, headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64') },
});
export async function razorpayCreateOrder(order) {
  const existing = q.get("SELECT * FROM payments WHERE order_id=? AND provider='razorpay'", order.id);
  if (existing?.provider_order_id) return existing.provider_order_id;
  const r = await rz('/orders', { method: 'POST', body: JSON.stringify({ amount: order.total, currency: 'INR', receipt: order.number, notes: { order: order.number } }) });
  const j = await r.json();
  if (!r.ok) throw new UserError('Could not start online payment. Please try again or choose another method.', 502);
  q.run('UPDATE payments SET provider_order_id=?, updated_at=? WHERE order_id=? AND provider=?', j.id, now(), order.id, 'razorpay');
  return j.id;
}
export function razorpayVerifySignature(orderId, paymentId, signature, secret = config.razorpay.keySecret) {
  return !!secret && safeEqual(hmac(secret, `${orderId}|${paymentId}`), String(signature || ''));
}
export function razorpayVerifyWebhook(rawBody, signature, secret = config.razorpay.webhookSecret) {
  return !!secret && safeEqual(hmac(secret, rawBody), String(signature || ''));
}
/** Payment confirmed by a verified signature or webhook. Amount and order are matched against our own records. */
export function razorpayCapture({ providerOrderId, providerPaymentId, amount, actor }) {
  return tx(() => {
    const pay = q.get("SELECT * FROM payments WHERE provider='razorpay' AND provider_order_id=?", providerOrderId);
    if (!pay) return { ok: false, reason: 'unknown order' };
    const order = q.get('SELECT * FROM orders WHERE id=?', pay.order_id);
    if (amount != null && Number(amount) !== order.total) return { ok: false, reason: 'amount mismatch' };
    const dup = q.get('SELECT order_id FROM payments WHERE provider_payment_id=? AND id<>?', providerPaymentId, pay.id);
    if (dup) return { ok: false, reason: 'payment id already used' };
    const changed = markPaid(order, { note: `Razorpay payment ${providerPaymentId} verified`, actor, providerPaymentId });
    return { ok: true, changed, order };
  });
}
export async function razorpayRefund(payment, amount) {
  const r = await rz(`/payments/${payment.provider_payment_id}/refund`, { method: 'POST', body: JSON.stringify({ amount }) });
  const j = await r.json();
  if (!r.ok) throw new UserError('The payment gateway rejected the refund: ' + (j?.error?.description || 'unknown error'), 502);
  return j; // { id, status: 'pending' | 'processed' }
}

/* ---------------- fulfilment ---------------- */
export function restock(orderId) {
  const o = q.get('SELECT restocked FROM orders WHERE id=?', orderId);
  if (o.restocked) return;
  for (const it of orderItems(orderId)) {
    if (it.variant_id) q.run('UPDATE variants SET stock=stock+? WHERE id=?', it.qty, it.variant_id);
    else if (it.product_id) q.run('UPDATE products SET stock=stock+? WHERE id=?', it.qty, it.product_id);
  }
  q.run('UPDATE orders SET restocked=1 WHERE id=?', orderId);
}
export function setStatus(order, status, { note = '', actor = 'owner', courier, tracking_no, tracking_url, eta_text } = {}) {
  if (!STATUSES.includes(status)) throw new UserError('Unknown status.');
  return tx(() => {
    const o = q.get('SELECT * FROM orders WHERE id=?', order.id);
    if (o.status === 'cancelled' && status !== 'cancelled') throw new UserError('A cancelled order cannot be reopened.');
    if (status === 'cancelled') {
      if (['delivered', 'returned'].includes(o.status)) throw new UserError('Delivered orders cannot be cancelled; use the return flow.');
      restock(o.id);
    }
    if (status === 'shipped' && !(courier ?? o.courier) && !(tracking_no ?? o.tracking_no) && !note) throw new UserError('Enter courier name and tracking number (or a note) when marking as shipped.');
    q.run(`UPDATE orders SET status=?, courier=COALESCE(?,courier), tracking_no=COALESCE(?,tracking_no), tracking_url=COALESCE(?,tracking_url), eta_text=COALESCE(?,eta_text),
      delivered_at=CASE WHEN ?='delivered' THEN ? ELSE delivered_at END, updated_at=? WHERE id=?`,
      status, courier ?? null, tracking_no ?? null, tracking_url ?? null, eta_text ?? null, status, now(), now(), o.id);
    addEvent(o.id, 'status', status, note, actor);
    if (status === 'delivered' && o.payment_method === 'cod' && o.payment_status !== 'paid') markPaid(o, { note: 'Cash collected on delivery', actor });
    if (o.email) notify({ userId: o.user_id, to: o.email, subject: `Order ${o.number}: ${status.replace(/_/g, ' ')}`, body: `Your order ${o.number} is now ${status.replace(/_/g, ' ')}.${tracking_no ? ' Tracking: ' + tracking_no : ''}` });
  });
}

/* ---------------- cancellation / returns ---------------- */
export const CANCEL_REASONS = ['Ordered by mistake', 'Found a better price', 'Delivery is taking too long', 'Want to change address or items', 'Other'];
export const RETURN_REASONS = ['Item damaged or defective', 'Wrong item received', 'Item not as described', 'No longer needed', 'Other'];
export function cancelOptions(o) {
  if (['placed', 'confirmed'].includes(o.status)) return { mode: 'instant' };
  if (['processing', 'packed'].includes(o.status)) return { mode: 'request' };
  if (o.status === 'delivered' && o.delivered_at) {
    const days = num('return_window_days');
    if (Date.now() <= Date.parse(o.delivered_at) + days * 86400e3) return { mode: 'return', days };
    return { mode: 'none', why: `The ${days}-day return window has ended.` };
  }
  return { mode: 'none', why: o.status === 'cancelled' ? 'This order is cancelled.' : 'This order can no longer be cancelled online. Once delivered you can request a return.' };
}
export function customerCancelOrReturn(order, { reason, details }) {
  const opt = cancelOptions(order);
  if (opt.mode === 'none') throw new UserError(opt.why);
  if (!reason) throw new UserError('Please select a reason.');
  return tx(() => {
    if (q.get("SELECT 1 x FROM order_requests WHERE order_id=? AND status='pending'", order.id)) throw new UserError('A request for this order is already pending.');
    const type = opt.mode === 'return' ? 'return' : 'cancel';
    const r = q.run('INSERT INTO order_requests(order_id,user_id,type,reason,details,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', order.id, order.user_id, type, reason, String(details || '').slice(0, 1000), now(), now());
    addEvent(order.id, 'request', '', `${type === 'cancel' ? 'Cancellation' : 'Return'} requested: ${reason}`, 'customer');
    if (opt.mode === 'instant') { approveRequest(Number(r.lastInsertRowid), { actor: 'customer (auto-approved)', note: 'Order was not yet processed' }); return { instant: true }; }
    return { instant: false };
  });
}
export function approveRequest(id, { actor = 'owner', note = '' } = {}) {
  return tx(() => {
    const r = q.get('SELECT * FROM order_requests WHERE id=?', id);
    if (!r || r.status !== 'pending') throw new UserError('Request is not pending.');
    const o = q.get('SELECT * FROM orders WHERE id=?', r.order_id);
    q.run("UPDATE order_requests SET status='approved', admin_note=?, updated_at=? WHERE id=?", note, now(), id);
    if (r.type === 'cancel') {
      setStatus(o, 'cancelled', { note: `Cancelled: ${r.reason}`, actor });
      if (paidAmount(o.id) > 0) createRefundRecord(o, paidAmount(o.id) - refundedAmount(o.id), 'Order cancelled after payment', actor);
    } else addEvent(o.id, 'request', '', `Return approved. ${note}`.trim(), actor);
  });
}
export function rejectRequest(id, note, actor = 'owner') {
  const r = q.get('SELECT * FROM order_requests WHERE id=?', id);
  if (!r || r.status !== 'pending') throw new UserError('Request is not pending.');
  q.run("UPDATE order_requests SET status='rejected', admin_note=?, updated_at=? WHERE id=?", note || '', now(), id);
  addEvent(r.order_id, 'request', '', `${r.type === 'cancel' ? 'Cancellation' : 'Return'} request declined. ${note || ''}`.trim(), actor);
}

/* ---------------- refunds ---------------- */
function createRefundRecord(order, amount, reason, actor) {
  if (amount <= 0) return null;
  const pay = q.get("SELECT * FROM payments WHERE order_id=? AND status IN('paid','refunded') ORDER BY id LIMIT 1", order.id);
  const r = q.run("INSERT INTO refunds(order_id,payment_id,amount,status,reason,created_at,updated_at) VALUES(?,?,?,'approved',?,?,?)", order.id, pay?.id ?? null, amount, reason || '', now(), now());
  addEvent(order.id, 'refund', 'approved', `Refund of ₹${(amount / 100).toFixed(2)} approved. It is not complete until the payment is actually returned.`, actor);
  return Number(r.lastInsertRowid);
}
/** Owner-issued refund. Gateway payments go through the Razorpay refund API; others are recorded for manual payout. */
export async function issueRefund(order, amount, reason, actor = 'owner') {
  const paid = paidAmount(order.id);
  if (!paid) throw new UserError('No paid amount to refund for this order.');
  if (amount <= 0 || amount + refundedAmount(order.id) > paid) throw new UserError('Refund amount exceeds the amount paid.');
  const id = createRefundRecord(order, amount, reason, actor);
  const pay = q.get('SELECT * FROM payments WHERE id=?', q.get('SELECT payment_id FROM refunds WHERE id=?', id).payment_id);
  if (pay?.provider === 'razorpay' && pay.provider_payment_id) {
    try {
      const j = await razorpayRefund(pay, amount);
      q.run('UPDATE refunds SET provider_refund_id=?, status=?, updated_at=? WHERE id=?', j.id, j.status === 'processed' ? 'processed' : 'processing', now(), id);
      if (j.status === 'processed') finalizeRefund(order.id);
      addEvent(order.id, 'refund', j.status, `Refund submitted to payment gateway (${j.id}), status: ${j.status}`, actor);
    } catch (e) { q.run("UPDATE refunds SET status='failed', updated_at=? WHERE id=?", now(), id); throw e; }
  }
  return id;
}
export function markRefundProcessed(refundId, reference, actor = 'owner') {
  const r = q.get('SELECT * FROM refunds WHERE id=?', refundId);
  if (!r || !['approved', 'processing'].includes(r.status)) throw new UserError('Refund is not awaiting payout.');
  if (!reference) throw new UserError('Enter the payout reference (UTR / transaction id) to confirm the refund was sent.');
  q.run("UPDATE refunds SET status='processed', reference=?, updated_at=? WHERE id=?", reference, now(), refundId);
  addEvent(r.order_id, 'refund', 'processed', `Refund of ₹${(r.amount / 100).toFixed(2)} sent. Reference: ${reference}`, actor);
  finalizeRefund(r.order_id);
}
export function finalizeRefund(orderId) {
  const o = q.get('SELECT * FROM orders WHERE id=?', orderId);
  const done = refundedDone(orderId), paid = paidAmount(orderId);
  if (done <= 0) return;
  q.run('UPDATE orders SET payment_status=?, updated_at=? WHERE id=?', done >= paid ? 'refunded' : 'partially_refunded', now(), orderId);
  if (o.email) notify({ userId: o.user_id, to: o.email, subject: `Refund processed for ${o.number}`, body: 'Your refund has been sent. It may take a few days to reflect in your account.' });
}
/** Razorpay webhook refund.processed/failed */
export function razorpayRefundUpdate(providerRefundId, status) {
  const r = q.get('SELECT * FROM refunds WHERE provider_refund_id=?', providerRefundId);
  if (!r) return;
  if (status === 'processed' && r.status !== 'processed') { q.run("UPDATE refunds SET status='processed', updated_at=? WHERE id=?", now(), r.id); addEvent(r.order_id, 'refund', 'processed', 'Gateway confirmed the refund was processed', 'razorpay'); finalizeRefund(r.order_id); }
  if (status === 'failed') { q.run("UPDATE refunds SET status='failed', updated_at=? WHERE id=?", now(), r.id); addEvent(r.order_id, 'refund', 'failed', 'Gateway reported the refund failed', 'razorpay'); }
}
export const randomKey = () => crypto.randomBytes(16).toString('hex');
