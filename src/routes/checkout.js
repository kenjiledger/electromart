import { get, post } from '../router.js';
import { q, now } from '../db.js';
import { S, num, pinInfo, flag } from '../settings.js';
import { html, raw, inr, fmtDate, UserError, cookie, label, clampInt } from '../util.js';
import { csrfField, imgTag, statusPill } from '../views.js';
import { cartLines, calcTotals, codAllowed } from '../shop.js';
import { rateLimit } from '../auth.js';
import { config } from '../config.js';
import * as O from '../orders.js';

export function orderDetail(ctx, o, { account }) {
  const items = O.orderItems(o.id), events = O.orderEvents(o.id);
  const addr = JSON.parse(o.ship_address);
  const reqs = q.all('SELECT * FROM order_requests WHERE order_id=? ORDER BY id DESC', o.id);
  const refunds = q.all('SELECT * FROM refunds WHERE order_id=? ORDER BY id', o.id);
  const opt = O.cancelOptions(o);
  const pendingReq = reqs.find((r) => r.status === 'pending');
  const needsPay = ['upi_qr', 'razorpay'].includes(o.payment_method) && ['pending', 'failed'].includes(o.payment_status) && o.status !== 'cancelled';
  const refundText = { approved: 'Approved - waiting for payout', processing: 'Processing with the payment gateway', processed: 'Sent', failed: 'Failed - the store will contact you', rejected: 'Rejected' };
  const steps = ['placed', 'confirmed', 'processing', 'packed', 'shipped', 'out_for_delivery', 'delivered'];
  const idx = steps.indexOf(o.status);
  return html`<div class="order">
    <div class="card pad"><div class="order-head"><div><h2>Order ${o.number}</h2><p class="muted small">Placed ${fmtDate(o.created_at)}</p></div><div>${statusPill(o.status)} <span class="pill pill-pay-${o.payment_status}">Payment: ${label(o.payment_status)}</span></div></div>
      ${['cancelled', 'returned'].includes(o.status) ? '' : html`<ol class="steps" aria-label="Order progress">${steps.map((s, i) => html`<li class="${i <= idx ? 'done' : ''}">${label(s)}</li>`)}</ol>`}
      ${o.courier || o.tracking_no ? html`<p><b>Shipment:</b> ${o.courier} ${o.tracking_no ? html`&middot; Tracking no. <b>${o.tracking_no}</b>` : ''} ${/^https?:\/\//.test(o.tracking_url) ? html`&middot; <a href="${o.tracking_url}" rel="noopener nofollow" target="_blank">Track with courier</a>` : ''}</p>` : ''}
      ${o.eta_text ? html`<p><b>Estimated delivery:</b> ${o.eta_text}</p>` : ''}
      ${needsPay ? html`<p class="flash warn">Payment pending. <a class="btn btn-sm btn-orange" href="/pay/${o.number}">Complete payment</a></p>` : ''}
      ${o.payment_status === 'awaiting_verification' ? html`<p class="flash warn">We received your payment reference and are verifying it. The order will be confirmed once the payment is verified.</p>` : ''}</div>
    <div class="card pad"><h3>Items</h3>${items.map((i) => html`<div class="cline">${imgTag(i.image, i.name, { w: 64, h: 64 })}<div class="cinfo"><b>${i.name}</b>${i.variant_label ? html`<p class="muted small">Option: ${i.variant_label}</p>` : ''}<p class="muted small">Qty ${i.qty} &times; ${inr(i.unit_price)}</p></div><div class="cprice">${inr(i.unit_price * i.qty)}</div></div>`)}
      <dl class="totals"><dt>Subtotal</dt><dd>${inr(o.subtotal)}</dd>${o.discount ? html`<dt>Discount ${o.coupon_code ? '(' + o.coupon_code + ')' : ''}</dt><dd>-${inr(o.discount)}</dd>` : ''}<dt>Shipping</dt><dd>${o.shipping ? inr(o.shipping) : 'FREE'}</dd><dt class="grand">Total</dt><dd class="grand">${inr(o.total)}</dd></dl>${o.tax ? html`<p class="muted small">Includes GST ${inr(o.tax)}</p>` : ''}</div>
    <div class="card pad"><h3>Delivery address</h3><p>${addr.name}<br>${addr.line1}${addr.line2 ? ', ' + addr.line2 : ''}<br>${addr.city}, ${addr.state} - ${addr.pin}<br>Phone: ${addr.phone}</p><p class="muted small">Payment method: ${{ cod: 'Cash on Delivery', upi_qr: 'UPI (QR)', razorpay: 'Online payment (Razorpay)' }[o.payment_method]}</p></div>
    ${refunds.length ? html`<div class="card pad"><h3>Refunds</h3>${refunds.map((r) => html`<p>${inr(r.amount)} &ndash; <b>${refundText[r.status]}</b>${r.reference ? html` (ref ${r.reference})` : ''}</p>`)}<p class="muted small">A refund is complete only when its status shows "Sent".</p></div>` : ''}
    ${reqs.length ? html`<div class="card pad"><h3>Requests</h3>${reqs.map((r) => html`<p>${r.type === 'cancel' ? 'Cancellation' : 'Return'} request (${r.reason}) &ndash; <b>${label(r.status)}</b>${r.admin_note ? html`<br><span class="muted small">Note from store: ${r.admin_note}</span>` : ''}</p>`)}</div>` : ''}
    ${account && !pendingReq && opt.mode !== 'none' ? html`<form method="post" action="/account/orders/${o.number}/cancel" class="card pad stack" data-confirm="${opt.mode === 'instant' ? 'Cancel this order?' : 'Submit this request?'}">${csrfField(ctx)}<h3>${opt.mode === 'return' ? 'Request a return / refund' : opt.mode === 'instant' ? 'Cancel this order' : 'Request cancellation'}</h3>${opt.mode === 'request' ? html`<p class="muted small">Your order is already being prepared, so the store needs to approve this request.</p>` : ''}${opt.mode === 'return' ? html`<p class="muted small">Return window: ${opt.days} days from delivery.</p>` : ''}
      <label>Reason <select name="reason" required><option value="">Select a reason</option>${(opt.mode === 'return' ? O.RETURN_REASONS : O.CANCEL_REASONS).map((r) => html`<option>${r}</option>`)}</select></label><label>Details (optional) <textarea name="details" rows="2" maxlength="1000"></textarea></label><button class="btn btn-danger">${opt.mode === 'return' ? 'Submit return request' : opt.mode === 'instant' ? 'Cancel order' : 'Submit request'}</button></form>`
      : account && opt.mode === 'none' && opt.why ? html`<p class="muted small">${opt.why}</p>` : ''}
    <div class="card pad"><h3>Order history</h3><ul class="timeline">${events.map((e) => html`<li><b>${e.status ? label(e.status) : label(e.kind)}</b> <span class="muted small">${fmtDate(e.created_at)}</span>${e.note ? html`<br>${e.note}` : ''}</li>`)}</ul></div></div>`;
}

const canView = (ctx, o) => (ctx.user && o.user_id === ctx.user.id) || ctx.cookies.lo === o.number;

get('/checkout', (ctx) => {
  const lines = cartLines(ctx.ownerKey);
  if (!lines.length) { ctx.flash('err', 'Your cart is empty.'); return ctx.redirect('/cart'); }
  if (lines.some((l) => l.problem)) { ctx.flash('err', 'Please fix the stock issues in your cart first.'); return ctx.redirect('/cart'); }
  const t = calcTotals(lines, { couponCode: ctx.cookies.cpn, user: ctx.user });
  const saved = ctx.user ? q.all('SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC,id', ctx.user.id) : [];
  const a = saved[0] || {}; const u = ctx.user || {};
  const methods = [];
  if (codAllowed(t.total)) methods.push(['cod', 'Cash on Delivery', 'Pay in cash when your order arrives.']);
  if (O.upiConfigured()) methods.push(['upi_qr', 'UPI (scan QR)', 'Pay by scanning the store QR, then enter your transaction reference.']);
  if (O.razorpayConfigured()) methods.push(['razorpay', 'Cards, UPI, Net Banking', 'Secure online payment via Razorpay.']);
  const f = (n, l, v = '', extra = '') => html`<label>${l}<input name="${n}" value="${v ?? ''}" required ${raw(extra)}></label>`;
  const body = html`<div class="wrap"><h1>Checkout</h1><ol class="steps cksteps" aria-label="Checkout progress"><li class="done">Cart</li><li class="done">Details &amp; payment</li><li>Confirmation</li></ol>
  <form method="post" class="cart-layout" id="checkout">${csrfField(ctx)}<input type="hidden" name="idem" value="${O.randomKey()}">
    <div class="stack">
      ${!ctx.user ? html`<p class="flash">Have an account? <a href="/login?next=/checkout">Sign in</a> for faster checkout and order history, or continue as guest.</p>` : ''}
      <section class="card pad stack"><h2>1. Contact &amp; delivery address</h2>
        ${saved.length ? html`<label>Saved address <select data-addr-pick><option value="">Enter a new address</option>${saved.map((s) => html`<option value="${s.id}" data-n="${s.name}" data-p="${s.phone}" data-l1="${s.line1}" data-l2="${s.line2}" data-c="${s.city}" data-s="${s.state}" data-z="${s.pin}" ${s.id === a.id ? raw('selected') : ''}>${s.name}, ${s.line1}, ${s.pin}</option>`)}</select></label>` : ''}
        <div class="row2">${f('name', 'Full name', a.name || u.name, 'autocomplete="name"')}${f('phone', 'Mobile number', a.phone || u.phone, 'inputmode="numeric" autocomplete="tel"')}</div>
        <label>Email (for order updates) <input type="email" name="email" value="${u.email || ''}" autocomplete="email"></label>
        ${f('line1', 'Address line 1', a.line1, 'autocomplete="address-line1"')}<label>Address line 2 <input name="line2" value="${a.line2 || ''}"></label>
        <div class="row2">${f('city', 'City', a.city)}${f('state', 'State', a.state)}</div>
        <label>PIN code <input name="pin" value="${a.pin || ''}" required inputmode="numeric" maxlength="6" data-pin></label><p class="small" data-pin-msg role="status"></p>
        ${ctx.user ? html`<label class="chk"><input type="checkbox" name="save_addr" value="1" ${saved.length ? '' : raw('checked')}> Save this address</label>` : ''}</section>
      <section class="card pad stack"><h2>2. Payment method</h2>${methods.length ? methods.map(([v, t1, d], i) => html`<label class="radio"><input type="radio" name="method" value="${v}" ${i === 0 ? raw('checked') : ''} required><span><b>${t1}</b><br><span class="muted small">${d}</span></span></label>`) : html`<p class="err-t">No payment method is currently available. Please contact the store.</p>`}</section></div>
    <aside class="card pad summary"><h2>Order summary</h2>${lines.map((l) => html`<div class="mini"><span>${l.product.name}${l.variant ? ' (' + l.variant.label + ')' : ''} &times; ${l.qty}</span><b>${inr(l.total)}</b></div>`)}
      <dl class="totals"><dt>Subtotal</dt><dd>${inr(t.subtotal)}</dd>${t.discount ? html`<dt>Discount (${t.coupon.code})</dt><dd class="ok-t">-${inr(t.discount)}</dd>` : ''}<dt>Shipping</dt><dd>${t.shipping ? inr(t.shipping) : 'FREE'}</dd><dt class="grand">Total</dt><dd class="grand">${inr(t.total)}</dd></dl>
      ${t.tax ? html`<p class="muted small">Includes GST ${inr(t.tax)}.</p>` : ''}${t.couponError ? html`<p class="err-t small">${t.couponError} <a href="/cart">Fix in cart</a></p>` : ''}
      <button class="btn btn-orange btn-block" ${methods.length ? '' : raw('disabled')}>Place order</button><p class="muted small">By placing this order you agree to our <a href="/page/terms">Terms</a> and <a href="/page/returns">Return Policy</a>. Prices and stock are re-checked when you place the order.</p></aside></form></div>`;
  ctx.page(200, { title: 'Checkout', noindex: true, body });
});

post('/checkout', (ctx) => {
  if (!rateLimit('co:' + ctx.ip, 20, 600e3)) throw new UserError('Too many attempts. Please wait a few minutes.', 429);
  const b = ctx.body;
  try {
    const address = O.validateAddress(b); const contact = O.validateContact(b);
    if (!pinInfo(address.pin).ok) throw new UserError(`Sorry, we do not deliver to PIN code ${address.pin} yet.`);
    const { order, duplicate } = O.placeOrder({ user: ctx.user, ownerKey: ctx.ownerKey, contact, address, method: b.method, couponCode: ctx.cookies.cpn || '', idemKey: String(b.idem || ''), actor: ctx.user ? 'customer' : 'guest' });
    if (!duplicate && ctx.user && b.save_addr && !q.get('SELECT 1 x FROM addresses WHERE user_id=? AND line1=? AND pin=?', ctx.user.id, address.line1, address.pin))
      q.run('INSERT INTO addresses(user_id,name,phone,line1,line2,city,state,pin,is_default) VALUES(?,?,?,?,?,?,?,?,?)', ctx.user.id, address.name, address.phone, address.line1, address.line2, address.city, address.state, address.pin, q.get('SELECT 1 x FROM addresses WHERE user_id=?', ctx.user.id) ? 0 : 1);
    ctx.setCookies.push(cookie('lo', order.number, { maxAge: 86400 * 7 }), cookie('cpn', '', { maxAge: 0 }));
    ctx.redirect(order.payment_method === 'cod' || order.payment_status === 'paid' ? `/order/${order.number}/confirmation` : `/pay/${order.number}`);
  } catch (e) { if (!e.user) throw e; ctx.flash('err', e.message); ctx.redirect('/checkout'); }
});

get('/order/:number/confirmation', (ctx) => {
  const o = O.getOrder(ctx.params.number);
  if (!o || !canView(ctx, o)) return ctx.notFound();
  ctx.page(200, { title: `Order ${o.number} confirmed`, noindex: true, body: html`<div class="wrap narrow"><div class="card pad center confirm"><h1>Thank you, ${o.name.split(' ')[0]}!</h1><p>Your order <b>${o.number}</b> has been placed.${o.payment_method === 'cod' ? ' Please keep <b>' + inr(o.total).replace(/^/, '') + '</b> ready to pay on delivery.' : ''}</p><p class="muted">The store will confirm your order shortly. You can follow its progress any time.</p><p><a class="btn btn-orange" href="${ctx.user ? '/account/orders/' + o.number : '/track?number=' + o.number}">Track order</a> <a class="btn" href="/">Continue shopping</a></p></div>${orderDetail(ctx, o, { account: false })}</div>` });
});

/* ---------------- payment page ---------------- */
get('/pay/:number', (ctx) => {
  const o = O.getOrder(ctx.params.number);
  if (!o || !canView(ctx, o)) return ctx.notFound();
  if (o.payment_method === 'cod' || o.payment_status === 'paid') return ctx.redirect(`/order/${o.number}/confirmation`);
  const s = S(); const pay = q.get('SELECT * FROM payments WHERE order_id=? ORDER BY id DESC LIMIT 1', o.id);
  let inner;
  if (o.payment_method === 'upi_qr') {
    const upi = s.upi_id ? `upi://pay?pa=${encodeURIComponent(s.upi_id)}&pn=${encodeURIComponent(s.upi_payee || s.store_name)}&am=${(o.total / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(o.number)}` : '';
    inner = html`<h2>Pay ${inr(o.total)} via UPI</h2><ol><li>Scan the QR with any UPI app (or tap the button on mobile).</li><li>Pay exactly <b>${inr(o.total)}</b>. Add <b>${o.number}</b> as the note if your app allows.</li><li>Enter the UPI transaction / UTR reference below.</li></ol>
      <div class="center">${s.upi_qr_path ? html`<img class="qr" src="${s.upi_qr_path}" alt="UPI payment QR code" width="260" height="260">` : ''}${upi ? html`<p><a class="btn btn-yellow" href="${upi}">Open UPI app</a></p>` : ''}${s.upi_id ? html`<p class="muted small">UPI ID: <b>${s.upi_id}</b></p>` : ''}</div>
      ${o.payment_status === 'awaiting_verification' ? html`<p class="flash warn">Reference <b>${pay?.utr}</b> received. The store will verify it against its bank records and confirm your order. You do not need to pay again.</p>` : html`<form method="post" action="/pay/${o.number}/utr" class="stack">${csrfField(ctx)}<label>UPI transaction / UTR reference <input name="utr" required minlength="10" maxlength="30" autocomplete="off" placeholder="e.g. 412345678901"></label><button class="btn btn-orange">I have paid - submit reference</button></form><p class="muted small">Your order is not confirmed until the store verifies the payment. Submitting a wrong reference will delay your order.</p>`}`;
  } else {
    inner = html`<h2>Pay ${inr(o.total)} securely</h2><p>You will pay on Razorpay's secure page (UPI, cards, net banking). We never see or store your card details or UPI PIN.</p><button id="rzp-btn" class="btn btn-orange btn-block" data-number="${o.number}" data-key="${config.razorpay.keyId}" data-csrf="${ctx.csrf}">Pay ${inr(o.total)}</button><p id="rzp-msg" class="small" role="status"></p><script src="https://checkout.razorpay.com/v1/checkout.js" defer></script>`;
  }
  ctx.page(200, { title: `Pay for order ${o.number}`, noindex: true, body: html`<div class="wrap narrow"><div class="card pad stack"><p class="muted">Order ${o.number}</p>${inner}</div><p class="center"><a href="/order/${o.number}/confirmation">View order</a></p></div>` });
});
post('/pay/:number/utr', (ctx) => {
  const o = O.getOrder(ctx.params.number);
  if (!o || !canView(ctx, o)) return ctx.notFound();
  if (!rateLimit('utr:' + ctx.ip, 10, 3600e3)) throw new UserError('Too many attempts.', 429);
  try { O.submitUtr(o, ctx.body.utr); ctx.flash('ok', 'Reference received. We will verify your payment shortly.'); } catch (e) { if (!e.user) throw e; ctx.flash('err', e.message); return ctx.redirect(`/pay/${o.number}`); }
  ctx.redirect(`/order/${o.number}/confirmation`);
});
post('/pay/:number/razorpay', async (ctx) => {
  const o = O.getOrder(ctx.params.number);
  if (!o || !canView(ctx, o) || o.payment_method !== 'razorpay' || o.payment_status === 'paid') return ctx.json({ error: 'Not allowed' }, 403);
  if (!O.razorpayConfigured()) return ctx.json({ error: 'Online payment is not configured' }, 503);
  try { const id = await O.razorpayCreateOrder(o); ctx.json({ order_id: id, amount: o.total, currency: 'INR', name: S().store_name, key: config.razorpay.keyId }); }
  catch (e) { ctx.json({ error: e.user ? e.message : 'Payment could not be started' }, 502); }
});
post('/pay/:number/razorpay/verify', (ctx) => {
  const o = O.getOrder(ctx.params.number);
  if (!o || !canView(ctx, o)) return ctx.json({ error: 'Not allowed' }, 403);
  const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = ctx.body;
  const pay = q.get("SELECT * FROM payments WHERE order_id=? AND provider='razorpay'", o.id);
  if (!pay || pay.provider_order_id !== oid || !O.razorpayVerifySignature(oid, pid, sig)) return ctx.json({ ok: false, error: 'Payment signature could not be verified. If money was deducted, it will be reconciled automatically or contact support.' }, 400);
  const r = O.razorpayCapture({ providerOrderId: oid, providerPaymentId: String(pid), amount: o.total, actor: 'razorpay (signature verified)' });
  ctx.json({ ok: r.ok, redirect: `/order/${o.number}/confirmation` });
});
/** Webhook: authenticity proven by HMAC over the RAW body; idempotent by event id. */
post('/webhooks/razorpay', (ctx) => {
  const sig = ctx.req.headers['x-razorpay-signature'];
  const raw = ctx.raw ? ctx.raw.toString('utf8') : '';
  if (!O.razorpayVerifyWebhook(raw, sig)) return ctx.json({ error: 'bad signature' }, 400);
  let ev; try { ev = JSON.parse(raw); } catch { return ctx.json({ error: 'bad json' }, 400); }
  const evId = ctx.req.headers['x-razorpay-event-id'] || `${ev.event}:${ev.payload?.payment?.entity?.id || ev.payload?.refund?.entity?.id}`;
  if (q.run('INSERT OR IGNORE INTO webhook_events(id,provider,received_at) VALUES(?,?,?)', evId, 'razorpay', now()).changes === 0) return ctx.json({ ok: true, duplicate: true });
  const pe = ev.payload?.payment?.entity, re = ev.payload?.refund?.entity;
  if (['payment.captured', 'order.paid'].includes(ev.event) && pe) O.razorpayCapture({ providerOrderId: pe.order_id, providerPaymentId: pe.id, amount: pe.amount, actor: 'razorpay webhook' });
  else if (ev.event === 'payment.failed' && pe) { const pay = q.get("SELECT * FROM payments WHERE provider='razorpay' AND provider_order_id=?", pe.order_id); if (pay) { const o = q.get('SELECT * FROM orders WHERE id=?', pay.order_id); if (o.payment_status !== 'paid') O.markPaymentFailed(o, pe.error_description || 'Payment failed', 'razorpay webhook'); } }
  else if (ev.event === 'refund.processed' && re) O.razorpayRefundUpdate(re.id, 'processed');
  else if (ev.event === 'refund.failed' && re) O.razorpayRefundUpdate(re.id, 'failed');
  ctx.json({ ok: true });
}, { csrf: false, limit: 512 * 1024 });
