import { q, now, tx } from '../db.js';
import { fromPaise, html, raw, inr, fmtDate, label, slugify, csv, UserError, pageParam, sanitizeHtml, saveImage, toPaise, fromLocalInput, toLocalInput, esc, isPin } from '../util.js';
import { csrfField, pager, statusPill, ASSET_V } from '../views.js';
import { S, setSetting, loadSettings } from '../settings.js';
import { aget, apost, adminPage, crud, fld, readFields, log } from './core.js';
import { categoryTree, categoryIds } from '../shop.js';
import { destroyUserSessions } from '../auth.js';
import { removeSampleData } from '../seed.js';
import { razorpayConfigured } from '../orders.js';
import { config } from '../config.js';

const catOpts = (blank = '- none -') => () => { const out = [['', blank]]; const walk = (l, d = 0) => l.forEach((c) => { out.push([c.id, '\u00a0\u00a0'.repeat(d) + c.name]); walk(c.children, d + 1); }); walk(categoryTree(true)); return out; };
const yn = (v) => (v ? 'Yes' : 'No');

/* ---- categories: dynamic, reorderable, slug changes create redirects ---- */
crud({ base: '/admin/categories', table: 'categories', title: 'Categories', singular: 'Category', orderBy: 'COALESCE(parent_id,id), parent_id IS NOT NULL, position, name',
  intro: 'Categories and subcategories shown in the storefront menu. Lower "order" numbers appear first.',
  fields: [{ name: 'name', label: 'Name', required: true, maxlength: 80 }, { name: 'slug', label: 'URL slug (blank = from name)' }, { name: 'parent_id', label: 'Parent category', type: 'select', options: catOpts(), nullable: true, numeric: true }, { name: 'description', label: 'Description (SEO)', type: 'textarea', rows: 2 }, { name: 'image', label: 'Image', type: 'image' }, { name: 'position', label: 'Order', type: 'number', min: 0, max: 9999 }, { name: 'published', label: 'Published', type: 'bool', default: 1 }],
  cols: [{ label: 'Name', render: (r) => html`${r.parent_id ? '\u2514 ' : ''}${r.name}` }, { label: 'URL', render: (r) => `/c/${r.slug}` }, { label: 'Order', key: 'position' }, { label: 'Published', render: (r) => yn(r.published) }],
  before(v, row) {
    const ids = row ? categoryIds(row.id) : [];
    if (v.parent_id && ids.includes(v.parent_id)) throw new UserError('A category cannot be placed under itself or its own subcategory.');
    v.slug = slugify(v.slug || v.name);
    const clash = q.get('SELECT id FROM categories WHERE slug=? AND id<>?', v.slug, row?.id || 0); if (clash) throw new UserError('Another category already uses that URL slug.');
    if (row && row.slug !== v.slug) q.run('INSERT OR REPLACE INTO redirects(from_path,to_path) VALUES(?,?)', `/c/${row.slug}`, `/c/${v.slug}`);
    q.run('DELETE FROM redirects WHERE from_path=?', `/c/${v.slug}`);
  } });

/* ---- banners (hero slider, side banners) with scheduling + preview ---- */
crud({ base: '/admin/banners', table: 'banners', title: 'Banners', singular: 'Banner', orderBy: 'slot, position, id',
  intro: 'Place banners anywhere: the hero slider, the side column, between homepage sections, on category pages, product pages or the cart. Each banner has its own width, height and shape. Banners with the same placement sit side by side in one row.',
  prep: (r) => ({ ...r, zone: r.zone || r.slot }),
  fields: [{ name: 'zone', label: 'Where should it appear?', type: 'select', required: true, options: () => [['hero', 'Homepage - hero slider (top)'], ['side', 'Homepage - right column'], ['home_row', 'Homepage - a row between sections'], ['category', 'Category / Deals / New arrivals pages'], ['product', 'Product pages (under the title)'], ['cart', 'Cart page (top)']] },
    { name: 'after_section_id', label: 'For "a row between sections": show it after which section?', type: 'select', numeric: true, options: () => [['0', 'Right below the top area (before all sections)'], ...q.all('SELECT id,title FROM home_sections ORDER BY position,id').map((s) => [s.id, 'After: ' + s.title])] },
    { name: 'category_id', label: 'For category pages: only this category (blank = all)', type: 'select', options: catOpts('- all categories -'), nullable: true, numeric: true },
    { name: 'width', label: 'Width (a row has 12 parts; banners with the same placement sit side by side)', type: 'select', options: () => [['full', 'Full width'], ['2-3', 'Two thirds'], ['1-2', 'Half'], ['1-3', 'One third'], ['1-4', 'One quarter']] },
    { name: 'height_px', label: 'Height in pixels (60 to 600)', type: 'number', min: 60, max: 600, default: 220 },
    { name: 'shape', label: 'Corner shape', type: 'select', options: () => [['rounded', 'Rounded corners'], ['square', 'Square corners'], ['pill', 'Fully rounded (pill)']] },
    { name: 'fit', label: 'Image fitting', type: 'select', options: () => [['cover', 'Fill the box (may crop)'], ['contain', 'Show whole image (may leave space)']] },
    { name: 'text_align', label: 'Text position', type: 'select', options: () => [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']] }, { name: 'title', label: 'Heading', required: true, maxlength: 90 }, { name: 'eyebrow', label: 'Small heading above (e.g. THIS DIWALI)', maxlength: 40 }, { name: 'subtitle', label: 'Description', maxlength: 200 }, { name: 'btn_text', label: 'Button text', maxlength: 30 }, { name: 'btn_url', label: 'Button destination (/c/electronics or https://...)', type: 'url' },
    { name: 'desktop_img', label: 'Desktop image (recommended 1200x420)', type: 'image' }, { name: 'mobile_img', label: 'Mobile image (recommended 800x600)', type: 'image' }, { name: 'img_alt', label: 'Image alt text', maxlength: 150 }, { name: 'theme', label: 'Text colour / theme', type: 'select', options: () => [['dark', 'Dark background (white text)'], ['light', 'Light background (dark text)'], ['warm', 'Warm (side column)'], ['cool', 'Cool (side column)'], ['green', 'Green (side column)']] },
    { name: 'position', label: 'Order', type: 'number', min: 0, max: 999 }, { name: 'active', label: 'Enabled', type: 'bool', default: 1 }, { name: 'starts_at', label: 'Publish at', type: 'datetime' }, { name: 'ends_at', label: 'Expire at', type: 'datetime' }, { name: 'show_countdown', label: 'Show countdown to the expiry time', type: 'bool', help: 'Only shown when an expiry time is set, so the timer is always a real, scheduled deadline.' }],
  cols: [{ label: 'Banner', render: (r) => html`${r.desktop_img ? html`<img class="thumb" src="${r.desktop_img}" alt="">` : ''} <b>${r.title}</b>${r.is_sample ? html` <span class="pill">sample</span>` : ''}` }, { label: 'Placement', render: (r) => label(r.zone || r.slot) }, { label: 'Size', render: (r) => (['hero', 'side'].includes(r.zone || r.slot) ? 'automatic' : `${r.width} x ${r.height_px}px`) }, { label: 'Order', key: 'position' }, { label: 'Enabled', render: (r) => yn(r.active) }, { label: 'Schedule', render: (r) => (r.starts_at || r.ends_at ? `${r.starts_at ? fmtDate(r.starts_at) : 'now'} \u2192 ${r.ends_at ? fmtDate(r.ends_at) : 'no end'}` : 'Always') }],
  before(v) {
    if (v.starts_at && v.ends_at && v.ends_at <= v.starts_at) throw new UserError('Expiry must be after the publish time.');
    v.slot = v.zone === 'hero' ? 'hero' : v.zone === 'side' ? 'side' : 'promo';
    v.after_section_id = v.after_section_id || 0; v.height_px = v.height_px || 220;
    if (v.zone !== 'home_row') v.after_section_id = 0; if (v.zone !== 'category') v.category_id = null;
  } });

/* ---- homepage sections ---- */
crud({ base: '/admin/sections', table: 'home_sections', title: 'Homepage sections', singular: 'Section', orderBy: 'position, id',
  intro: 'Product rows shown on the homepage, in this order. Content is chosen automatically from live product data (flags set in Products).',
  fields: [{ name: 'title', label: 'Section title', required: true, maxlength: 80 }, { name: 'type', label: 'Content', type: 'select', required: true, options: () => [['deals', 'Best deals (discounted products)'], ['trending', 'Trending products'], ['bestsellers', 'Best sellers'], ['new', 'New arrivals'], ['recommended', 'Recommended (top rated)'], ['featured', 'Featured products'], ['category', 'A specific category']] }, { name: 'category_id', label: 'Category (for "A specific category")', type: 'select', options: catOpts(), nullable: true, numeric: true }, { name: 'item_limit', label: 'Number of products', type: 'number', min: 2, max: 12, default: 6 }, { name: 'card_size', label: 'Product box size in this section', type: 'select', options: () => [['default', 'Use the store-wide size'], ['small', 'Small boxes (more per row)'], ['medium', 'Medium boxes'], ['large', 'Large boxes (fewer per row)']] }, { name: 'position', label: 'Order', type: 'number', min: 0, max: 999 }, { name: 'active', label: 'Visible', type: 'bool', default: 1 }],
  cols: [{ label: 'Title', key: 'title' }, { label: 'Type', key: 'type' }, { label: 'Order', key: 'position' }, { label: 'Visible', render: (r) => yn(r.active) }],
  before(v) { if (v.type === 'category' && !v.category_id) throw new UserError('Choose a category for a category section.'); } });

/* ---- coupons (validated again on the server at cart and checkout) ---- */
crud({ base: '/admin/coupons', table: 'coupons', title: 'Coupons', singular: 'Coupon', orderBy: 'id DESC', prep: (r) => ({ ...r, value: r.type === 'fixed' ? fromPaise(r.value) : r.value }),
  intro: 'Percent coupons use the percentage value; fixed coupons use a rupee amount. Every coupon is re-validated on the server at cart and at order placement.',
  fields: [{ name: 'code', label: 'Code', required: true, pattern: /^[A-Za-z0-9_-]{3,30}$/ }, { name: 'description', label: 'Description (internal)' }, { name: 'type', label: 'Type', type: 'select', required: true, options: () => [['percent', 'Percentage off'], ['fixed', 'Fixed amount off']] }, { name: 'value', label: 'Value (percent e.g. 10; for fixed, rupees e.g. 100; for free-shipping-only coupons enter 1)', type: 'text', required: true },
    { name: 'max_discount', label: 'Maximum discount', type: 'rupees', help: 'For percentage coupons. Blank = no cap.' }, { name: 'min_order', label: 'Minimum order value', type: 'rupees' }, { name: 'usage_limit', label: 'Total usage limit (0 = unlimited)', type: 'number', min: 0 }, { name: 'per_user_limit', label: 'Per-customer limit (0 = unlimited; requires sign-in)', type: 'number', min: 0 },
    { name: 'starts_at', label: 'Starts', type: 'datetime' }, { name: 'ends_at', label: 'Expires', type: 'datetime' }, { name: 'first_order_only', label: 'First order only (requires sign-in)', type: 'bool' }, { name: 'free_shipping', label: 'Free shipping', type: 'bool' },
    { name: 'category_id', label: 'Only for category (optional)', type: 'select', options: catOpts('- all -'), nullable: true, numeric: true }, { name: 'product_id', label: 'Only for product ID (optional)', type: 'number', min: 1, nullable: true }, { name: 'active', label: 'Active', type: 'bool', default: 1 }],
  cols: [{ label: 'Code', render: (r) => html`<b>${r.code}</b>${r.is_sample ? html` <span class="pill">sample</span>` : ''}` }, { label: 'Offer', render: (r) => (r.type === 'percent' ? `${r.value}%` : inr(r.value)) + (r.free_shipping ? ' + free shipping' : '') }, { label: 'Used', render: (r) => `${r.used_count}${r.usage_limit ? '/' + r.usage_limit : ''}` }, { label: 'Expires', render: (r) => (r.ends_at ? fmtDate(r.ends_at) : '-') }, { label: 'Active', render: (r) => yn(r.active) }],
  before(v, row) {
    v.code = v.code.toUpperCase();
    if (v.type === 'percent') { const n = parseInt(v.value, 10); if (!(n >= 1 && n <= 100)) throw new UserError('Percentage must be between 1 and 100.'); v.value = n; }
    else { const p = toPaise(v.value); if (!(p > 0)) throw new UserError('Enter the discount amount in rupees.'); v.value = p; }
    if (v.free_shipping && !(v.value > 0)) v.value = 1;
    v.max_discount = v.max_discount || 0; v.min_order = v.min_order || 0;
    if (v.starts_at && v.ends_at && v.ends_at <= v.starts_at) throw new UserError('Expiry must be after the start.');
    if (v.product_id && !q.get('SELECT 1 x FROM products WHERE id=?', v.product_id)) throw new UserError('Product ID not found.');
  } });

/* ---- flash sales / festival campaigns: set sale prices in bulk with a real schedule ---- */
aget('/admin/promotions', (ctx) => adminPage(ctx, { title: 'Flash sales & campaigns', active: '/admin/promotions', body: html`<p class="muted">Apply a percentage discount to a category (or all products) for a scheduled window. The storefront shows the sale price only inside the window; the server decides at checkout. Individual products can still be tuned in Products.</p>
  <form method="post" action="/admin/promotions/apply" class="card pad stack formw">${csrfField(ctx)}<label>Category <select name="category_id">${catOpts('All products')().map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></label><label>Discount % off the regular price <input type="number" name="pct" min="1" max="90" required></label><label>Starts (IST) <input type="datetime-local" name="start" required></label><label>Ends (IST) <input type="datetime-local" name="end" required></label><label class="chk"><input type="checkbox" name="show_deals" value="1" checked> Only published products</label><button class="btn btn-orange" data-confirm="Apply this sale to the selected products?">Apply sale</button></form>
  <form method="post" action="/admin/promotions/clear" class="card pad stack formw">${csrfField(ctx)}<h2>End sales early</h2><label>Category <select name="category_id">${catOpts('All products')().map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></label><button class="btn btn-danger" data-confirm="Remove sale prices from the selected products?">Remove sale prices</button></form>` }));
apost('/admin/promotions/apply', (ctx) => {
  try {
    const pct = parseInt(ctx.body.pct, 10), s = fromLocalInput(ctx.body.start), e = fromLocalInput(ctx.body.end);
    if (!(pct >= 1 && pct <= 90)) throw new UserError('Discount must be 1-90%.'); if (!s || !e || e <= s) throw new UserError('Choose a valid start and a later end time.');
    const ids = ctx.body.category_id ? categoryIds(Number(ctx.body.category_id)) : null;
    const r = q.run(`UPDATE products SET sale_price=MAX(0,CAST(ROUND(price*(100-?)/100.0) AS INTEGER)), sale_start=?, sale_end=?, updated_at=? WHERE price>0 ${ctx.body.show_deals ? "AND status='published'" : ''} ${ids ? `AND category_id IN (${ids.join(',')})` : ''}`, pct, s, e, now());
    log(ctx, 'promotion.apply', ctx.body.category_id || 'all', `${pct}% for ${r.changes} products, ${s} - ${e}`); ctx.flash('ok', `Sale applied to ${r.changes} product(s).`);
  } catch (err) { if (!err.user) throw err; ctx.flash('err', err.message); }
  ctx.redirect('/admin/promotions');
});
apost('/admin/promotions/clear', (ctx) => { const ids = ctx.body.category_id ? categoryIds(Number(ctx.body.category_id)) : null; const r = q.run(`UPDATE products SET sale_price=NULL, sale_start=NULL, sale_end=NULL, updated_at=? WHERE sale_price IS NOT NULL ${ids ? `AND category_id IN (${ids.join(',')})` : ''}`, now()); log(ctx, 'promotion.clear', ctx.body.category_id || 'all', `${r.changes} products`); ctx.flash('ok', `Sale prices removed from ${r.changes} product(s).`); ctx.redirect('/admin/promotions'); });

/* ---- customers (never shows password hashes or payment data) ---- */
aget('/admin/customers', (ctx) => {
  const Q = ctx.query, page = pageParam(Q.get('page')), per = 25; const w = ["u.role='customer'"], p = [];
  if (Q.get('q')) { const t = `%${Q.get('q')}%`; w.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)'); p.push(t, t, t); }
  if (['active', 'suspended', 'deletion_requested', 'deleted'].includes(Q.get('status'))) { w.push('u.status=?'); p.push(Q.get('status')); }
  const total = q.get(`SELECT COUNT(*) n FROM users u WHERE ${w.join(' AND ')}`, ...p).n;
  const rows = q.all(`SELECT u.id,u.name,u.email,u.phone,u.status,u.created_at,(SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id) orders FROM users u WHERE ${w.join(' AND ')} ORDER BY u.id DESC LIMIT ${per} OFFSET ${(page - 1) * per}`, ...p);
  adminPage(ctx, { title: 'Customers', active: '/admin/customers', body: html`<form class="filterbar" method="get"><input name="q" placeholder="Name, email or phone" value="${Q.get('q') || ''}"><select name="status"><option value="">Any status</option>${['active', 'suspended', 'deletion_requested', 'deleted'].map((s) => html`<option value="${s}" ${Q.get('status') === s ? raw('selected') : ''}>${label(s)}</option>`)}</select><button class="btn btn-sm">Filter</button><a class="btn btn-sm" href="/admin/customers/export.csv">Export CSV</a></form>
  <div class="tablewrap"><table class="table"><thead><tr><th>Name</th><th>Contact</th><th>Orders</th><th>Joined</th><th>Status</th><th></th></tr></thead><tbody>${rows.length ? rows.map((u) => html`<tr><td>${u.name}</td><td>${u.email || ''}<br><span class="muted small">${u.phone || ''}</span></td><td>${u.orders}</td><td>${fmtDate(u.created_at, false)}</td><td>${statusPill(u.status)}</td><td><a class="btn btn-sm" href="/admin/customers/${u.id}">View</a></td></tr>`) : html`<tr><td colspan="6" class="muted">No customers yet.</td></tr>`}</tbody></table></div>${pager(ctx, page, total, per)}` });
});
aget('/admin/customers/export.csv', (ctx) => {
  const rows = q.all("SELECT name,email,phone,status,created_at,(SELECT COUNT(*) FROM orders o WHERE o.user_id=users.id) n FROM users WHERE role='customer' AND status<>'deleted' ORDER BY id");
  log(ctx, 'customers.export', 'users', rows.length);
  ctx.text(csv([['name', 'email', 'phone', 'status', 'joined', 'orders'], ...rows.map((r) => [r.name, r.email, r.phone, r.status, r.created_at, r.n])]), 'text/csv; charset=utf-8', { 'Content-Disposition': 'attachment; filename="customers.csv"' });
});
aget('/admin/customers/:id', (ctx) => {
  const u = q.get("SELECT id,name,email,phone,status,created_at,email_verified FROM users WHERE id=? AND role='customer'", ctx.params.id); if (!u) return ctx.notFound();
  const orders = q.all('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 50', u.id);
  const f = (path, inner, conf) => html`<form method="post" action="/admin/customers/${u.id}/${path}" class="inl" ${conf ? raw(`data-confirm="${esc(conf)}"`) : ''}>${csrfField(ctx)}${inner}</form>`;
  adminPage(ctx, { title: u.name || 'Customer', active: '/admin/customers', body: html`<section class="card pad"><p>${u.email || ''} ${u.email ? (u.email_verified ? '(verified)' : '(unverified)') : ''} &middot; ${u.phone || ''}<br>Joined ${fmtDate(u.created_at, false)} &middot; ${statusPill(u.status)}</p><div class="btnrow">
    ${u.status === 'active' ? f('suspend', html`<button class="btn btn-danger">Suspend account</button>`, 'Suspend this customer? They will be signed out and unable to sign in.') : ''}${u.status === 'suspended' ? f('reactivate', html`<button class="btn">Reactivate account</button>`) : ''}
    ${u.status === 'deletion_requested' ? f('delete', html`<button class="btn btn-danger">Process deletion request</button>`, 'Erase this customer\u2019s profile and addresses? Order records are kept in anonymised form for accounting.') : ''}</div></section>
  <section class="card pad"><h2>Orders</h2>${orders.length ? html`<table class="table"><tbody>${orders.map((o) => html`<tr><td><a href="/admin/orders/${o.number}">${o.number}</a></td><td>${fmtDate(o.created_at, false)}</td><td>${inr(o.total)}</td><td>${statusPill(o.status)}</td></tr>`)}</tbody></table>` : html`<p class="muted">No orders.</p>`}</section>` });
});
apost('/admin/customers/:id/suspend', (ctx) => { q.run("UPDATE users SET status='suspended', updated_at=? WHERE id=? AND role='customer'", now(), ctx.params.id); destroyUserSessions(ctx.params.id); log(ctx, 'customer.suspend', 'user', ctx.params.id); ctx.flash('ok', 'Account suspended.'); ctx.redirect('/admin/customers/' + ctx.params.id); });
apost('/admin/customers/:id/reactivate', (ctx) => { q.run("UPDATE users SET status='active', updated_at=? WHERE id=? AND role='customer'", now(), ctx.params.id); log(ctx, 'customer.reactivate', 'user', ctx.params.id); ctx.flash('ok', 'Account reactivated.'); ctx.redirect('/admin/customers/' + ctx.params.id); });
apost('/admin/customers/:id/delete', (ctx) => {
  const u = q.get("SELECT * FROM users WHERE id=? AND role='customer' AND status='deletion_requested'", ctx.params.id);
  if (!u) { ctx.flash('err', 'Only accounts with a pending deletion request can be erased here.'); return ctx.redirect('/admin/customers'); }
  tx(() => { destroyUserSessions(u.id); q.run('DELETE FROM addresses WHERE user_id=?', u.id); q.run('DELETE FROM wishlist WHERE user_id=?', u.id); q.run('DELETE FROM cart_items WHERE owner_key=?', 'u:' + u.id); q.run('DELETE FROM tokens WHERE user_id=?', u.id);
    q.run("UPDATE users SET name='Deleted customer', email=NULL, phone=NULL, pass_hash='deleted', status='deleted', notify_email=0, notify_sms=0, updated_at=? WHERE id=?", now(), u.id);
    q.run("UPDATE reviews SET status='hidden' WHERE user_id=?", u.id); });
  log(ctx, 'customer.erase', 'user', u.id); ctx.flash('ok', 'Customer data erased; order records retained in anonymised form.'); ctx.redirect('/admin/customers');
});

/* ---- support inbox ---- */
aget('/admin/support', (ctx) => { const rows = q.all('SELECT * FROM support_requests ORDER BY (status=\'open\') DESC, id DESC LIMIT 100'); adminPage(ctx, { title: 'Support inbox', active: '/admin/support', body: html`${rows.length ? rows.map((r) => html`<article class="card pad"><p><b>${r.subject}</b> <span class="pill">${r.status}</span><br><span class="muted small">${r.name} &lt;${r.email}&gt; &middot; ${fmtDate(r.created_at)}</span></p><p>${r.message}</p><p><a class="btn btn-sm" href="mailto:${r.email}?subject=Re: ${encodeURIComponent(r.subject)}">Reply by email</a> ${r.status === 'open' ? html`<form class="inl" method="post" action="/admin/support/${r.id}/close">${csrfField(ctx)}<button class="btn btn-sm">Mark resolved</button></form>` : ''}</p></article>`) : html`<p class="muted">No messages yet.</p>`}` }); });
apost('/admin/support/:id/close', (ctx) => { q.run("UPDATE support_requests SET status='closed' WHERE id=?", ctx.params.id); ctx.redirect('/admin/support'); });

/* ---- pages & policies: draft -> preview -> publish ---- */
aget('/admin/pages', (ctx) => { const rows = q.all('SELECT * FROM pages ORDER BY title'); adminPage(ctx, { title: 'Pages & policies', active: '/admin/pages', body: html`<div class="tablewrap"><table class="table"><tbody>${rows.map((p) => html`<tr><td><b>${p.title}</b><br><span class="muted small">/page/${p.slug}</span></td><td>${p.draft_body != null ? html`<span class="pill pill-pending">Unpublished draft</span>` : 'Published'}</td><td><a class="btn btn-sm" href="/admin/pages/${p.slug}">Edit</a></td></tr>`)}</tbody></table></div>` }); });
aget('/admin/pages/:slug', (ctx) => {
  const p = q.get('SELECT * FROM pages WHERE slug=?', ctx.params.slug); if (!p) return ctx.notFound();
  adminPage(ctx, { title: `Edit: ${p.title}`, active: '/admin/pages', body: html`<form method="post" class="card pad stack formw">${csrfField(ctx)}<label>Title <input name="title" value="${p.title}" required></label><label>Content (HTML)<textarea name="body" rows="16">${p.draft_body ?? p.body}</textarea></label><label>SEO title <input name="seo_title" value="${p.seo_title}"></label><label>SEO description <textarea name="seo_desc" rows="2">${p.seo_desc}</textarea></label>
    <div class="btnrow"><button class="btn" name="act" value="draft">Save draft</button><button class="btn btn-orange" name="act" value="publish" data-confirm="Publish to the live site?">Publish</button>${p.draft_body != null ? html`<button class="btn btn-ghost" name="act" value="discard">Discard draft</button>` : ''}<a class="btn" href="/admin/pages/${p.slug}/preview" target="_blank">Preview draft</a></div></form>` });
});
aget('/admin/pages/:slug/preview', (ctx) => { const p = q.get('SELECT * FROM pages WHERE slug=?', ctx.params.slug); if (!p) return ctx.notFound(); ctx.html(html`<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/style.css?v=${ASSET_V}"><body><p class="flash warn">Draft preview &ndash; not live until published.</p><div class="wrap narrow"><h1>${p.title}</h1><div class="prose">${raw(sanitizeHtml(p.draft_body ?? p.body))}</div></div></body>`); });
apost('/admin/pages/:slug', (ctx) => {
  const p = q.get('SELECT * FROM pages WHERE slug=?', ctx.params.slug); if (!p) return ctx.notFound(); const b = ctx.body; const body = sanitizeHtml(b.body);
  if (b.act === 'discard') q.run('UPDATE pages SET draft_body=NULL WHERE slug=?', p.slug);
  else if (b.act === 'publish') q.run('UPDATE pages SET title=?, body=?, draft_body=NULL, seo_title=?, seo_desc=?, updated_at=? WHERE slug=?', String(b.title).slice(0, 120), body, String(b.seo_title || '').slice(0, 70), String(b.seo_desc || '').slice(0, 300), now(), p.slug);
  else q.run('UPDATE pages SET title=?, draft_body=?, seo_title=?, seo_desc=? WHERE slug=?', String(b.title).slice(0, 120), body, String(b.seo_title || '').slice(0, 70), String(b.seo_desc || '').slice(0, 300), p.slug);
  log(ctx, `page.${b.act || 'draft'}`, 'page', p.slug); ctx.flash('ok', b.act === 'publish' ? 'Page published.' : b.act === 'discard' ? 'Draft discarded.' : 'Draft saved (not live yet).'); ctx.redirect('/admin/pages/' + p.slug);
});

/* ---- store settings (includes the owner-uploaded payment QR) ---- */
const G = (title, fields) => ({ title, fields });
const SETTING_GROUPS = [
  G('Branding & content', [['store_name', 'Store name'], ['tagline', 'Tagline'], ['logo_path', 'Store logo', 'image'], ['favicon_path', 'Favicon', 'image'], ['announce_1', 'Announcement bar 1'], ['announce_2', 'Announcement bar 2'], ['announce_3', 'Announcement bar 3'], ['announce_4', 'Announcement bar 4'], ['campaign_label', 'Campaign menu label (e.g. Diwali Special)'], ['campaign_url', 'Campaign menu link'], ['trust_lines', 'Trust strip (one per line: Title|Subtitle)', 'textarea'], ['why_lines', '"Why choose us" (one per line: Title|Subtitle)', 'textarea']]),
  G('Contact & social', [['contact_email', 'Contact email'], ['contact_phone', 'Contact phone'], ['contact_address', 'Address', 'textarea'], ['social_facebook', 'Facebook URL'], ['social_instagram', 'Instagram URL'], ['social_youtube', 'YouTube URL'], ['social_twitter', 'X / Twitter URL'], ['social_whatsapp', 'WhatsApp link']]),
  G('Payments', [['cod_enabled', 'Enable Cash on Delivery', 'bool'], ['cod_max_order', 'Maximum COD order value', 'rupees'], ['upi_enabled', 'Enable UPI QR payment', 'bool'], ['upi_qr_path', 'Your UPI payment QR image', 'image'], ['upi_id', 'UPI ID (optional, enables the "open UPI app" button)'], ['upi_payee', 'Payee name shown in UPI apps']]),
  G('Shipping, tax & returns', [['shipping_fee', 'Shipping fee', 'rupees'], ['free_ship_threshold', 'Free shipping above (0 = never)', 'rupees'], ['delivery_days', 'Standard delivery (days)', 'int'], ['serviceable_pins', 'Serviceable PIN codes (comma list; 78* = prefix; * = everywhere)', 'textarea'], ['tax_percent', 'GST % included in prices', 'int'], ['return_window_days', 'Return window (days after delivery)', 'int'], ['low_stock_threshold', 'Low-stock alert at', 'int']]),
  G('Product box design (all product cards)', [['card_min_width', 'Box width in pixels (140 small to 340 large)', 'int'], ['card_image_ratio', 'Photo shape', 'select', [['square', 'Square'], ['portrait', 'Tall (3:4)'], ['landscape', 'Wide (4:3)']]], ['card_image_fit', 'Photo fitting', 'select', [['contain', 'Show whole photo'], ['cover', 'Fill the box (may crop)']]], ['card_radius', 'Corner roundness in pixels (0 to 30)', 'int'], ['card_shadow', 'Shadow', 'select', [['none', 'None'], ['soft', 'Soft'], ['strong', 'Strong']]], ['card_btn_style', 'Add to Cart button style', 'select', [['filled', 'Solid orange'], ['outline', 'Outlined']]], ['card_cols_mobile', 'Boxes per row on phones', 'select', [['2', '2'], ['1', '1']]], ['card_show_badge', 'Show discount badge', 'bool'], ['card_show_wishlist', 'Show wishlist heart', 'bool'], ['card_show_rating', 'Show star rating', 'bool'], ['card_show_brand_line', 'Show short description line', 'bool']]),
  G('Orders, invoices & email', [['order_prefix', 'Order number prefix'], ['email_notifications', 'Queue customer email notifications', 'bool'], ['invoice_company', 'Invoice: business name'], ['invoice_gstin', 'Invoice: GSTIN'], ['invoice_address', 'Invoice: address', 'textarea'], ['invoice_footer', 'Invoice footer note']]),
  G('SEO & visibility', [['allow_indexing', 'Allow search engines to index the site (turn on when you launch)', 'bool'], ['seo_default_title', 'Default page title'], ['seo_default_desc', 'Default meta description', 'textarea'], ['og_image', 'Default social-sharing image', 'image'], ['hero_autoplay_secs', 'Hero slider seconds per slide', 'int'], ['maintenance_mode', 'Maintenance mode (storefront shows "back soon"; admin keeps working)', 'bool']]),
];
aget('/admin/settings', (ctx) => {
  const s = S();
  const input = ([k, l, t = 'text', opts]) => {
    if (t === 'select') return html`<label>${l}<select name="${k}">${opts.map(([v, n]) => html`<option value="${v}" ${s[k] === v ? raw('selected') : ''}>${n}</option>`)}</select></label>`;
    if (t === 'bool') return html`<label class="chk"><input type="checkbox" name="${k}" value="1" ${s[k] === '1' ? raw('checked') : ''}> ${l}</label>`;
    if (t === 'textarea') return html`<label>${l}<textarea name="${k}" rows="3">${s[k]}</textarea></label>`;
    if (t === 'rupees') return html`<label>${l} (₹)<input type="number" step="0.01" min="0" name="${k}" value="${fromPaise(Number(s[k]) || 0)}"></label>`;
    if (t === 'int') return html`<label>${l}<input type="number" min="0" name="${k}" value="${s[k]}"></label>`;
    if (t === 'image') return html`<label>${l}<input type="file" name="${k}" accept="image/png,image/jpeg,image/webp,image/gif"></label>${s[k] ? html`<p><img class="${k === 'upi_qr_path' ? 'qr-prev' : 'thumb'}" src="${s[k]}" alt=""> <label class="chk"><input type="checkbox" name="remove_${k}" value="1"> Remove</label></p>` : ''}`;
    return html`<label>${l}<input name="${k}" value="${s[k]}"></label>`;
  };
  adminPage(ctx, { title: 'Store settings', active: '/admin/settings', body: html`<p>Currency: INR (₹). Dates are shown in IST. Razorpay: ${razorpayConfigured() ? html`<b class="ok-t">configured via server environment</b>` : html`<b>not configured</b> (set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET in the server environment; see docs/PAYMENTS.md)`}.</p>
  <form method="post" action="/admin/settings" enctype="multipart/form-data" class="stack">${csrfField(ctx)}${SETTING_GROUPS.map((g) => html`<fieldset class="card pad stack formw"><legend><h2>${g.title}</h2></legend>${g.fields.map(input)}</fieldset>`)}<div><button class="btn btn-orange">Save settings</button></div></form>
  <form method="post" action="/admin/settings/remove-sample" class="card pad stack formw">${csrfField(ctx)}<h2>Sample data</h2><p class="muted">Removes the demo banners and coupons, and archives/deletes the demo products (those with past orders are archived).</p><button class="btn btn-danger" data-confirm="Remove all sample data?">Remove sample data</button></form>` });
});
apost('/admin/settings', (ctx) => {
  try {
    const b = ctx.body; const changed = [];
    tx(() => { for (const g of SETTING_GROUPS) for (const [k, , t = 'text', opts] of g.fields) {
      let v;
      if (t === 'select') { v = b[k] === undefined ? S()[k] : String(b[k]); if (!opts.some(([o]) => o === v)) throw new UserError('Invalid choice for ' + k); }
      else if (t === 'int' && b[k] === undefined) v = S()[k];
      else if (t === 'bool') v = b[k] ? '1' : '0';
      else if (t === 'image') { v = S()[k] || ''; if (b['remove_' + k]) v = ''; const part = ctx.files.find((p) => p.name === k); const sv = saveImage(part); if (sv) v = sv; }
      else if (t === 'rupees') { const n = toPaise(b[k] || 0); if (!(n >= 0)) throw new UserError('Invalid amount.'); v = String(n); }
      else if (t === 'int') { const n = parseInt(b[k], 10); if (!(n >= 0 && n < 100000)) throw new UserError('Invalid number in ' + k); v = String(n); }
      else v = String(b[k] ?? '').slice(0, 4000);
      if (k === 'card_min_width' && !(Number(v) >= 140 && Number(v) <= 340)) throw new UserError('Box width must be between 140 and 340 pixels.');
      if (k === 'card_radius' && Number(v) > 30) throw new UserError('Corner roundness must be 0 to 30.');
      if (k === 'tax_percent' && Number(v) > 100) throw new UserError('GST % must be 0-100.');
      if (k === 'serviceable_pins') for (const r of v.split(/[,\s]+/).filter(Boolean)) if (!(r === '*' || /^\d{1,6}\*?$/.test(r))) throw new UserError(`PIN rule "${r}" is not valid.`);
      if (k === 'upi_enabled' && v === '1' && !((S().upi_qr_path && !b.remove_upi_qr_path) || ctx.files.some((p) => p.name === 'upi_qr_path' && p.body.length))) throw new UserError('Upload your UPI QR image before enabling UPI payments.');
      if (v !== S()[k]) changed.push(k);
      setSetting(k, v);
    } });
    log(ctx, 'settings.update', 'settings', changed.filter((k) => !/qr|gstin/.test(k)).join(', ') || 'no changes');
    ctx.flash('ok', 'Settings saved.');
  } catch (e) { loadSettings(); if (!e.user) throw e; ctx.flash('err', e.message); }
  ctx.redirect('/admin/settings');
});
apost('/admin/settings/remove-sample', (ctx) => { removeSampleData(); log(ctx, 'sample.remove', 'data'); ctx.flash('ok', 'Sample data removed.'); ctx.redirect('/admin/settings'); });

aget('/admin/audit', (ctx) => { const page = pageParam(ctx.query.get('page')); const rows = q.all(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT 50 OFFSET ${(page - 1) * 50}`); const n = q.get('SELECT COUNT(*) n FROM audit_logs').n;
  adminPage(ctx, { title: 'Audit log', active: '/admin/audit', body: html`<div class="tablewrap"><table class="table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th><th>IP</th></tr></thead><tbody>${rows.map((r) => html`<tr><td>${fmtDate(r.created_at)}</td><td>${r.actor}</td><td>${r.action}</td><td>${r.entity} ${r.detail}</td><td>${r.ip}</td></tr>`)}</tbody></table></div>${pager(ctx, page, n, 50)}` }); });
aget('/admin/outbox', (ctx) => { const rows = q.all('SELECT * FROM notifications ORDER BY id DESC LIMIT 100'); adminPage(ctx, { title: 'Email outbox', active: '/admin/outbox', body: html`<p class="muted">Notifications are recorded here. No email transport is configured by default, so status stays "queued" until you connect a provider (see docs/DEPLOY.md). Nothing is shown as sent unless it was.</p><div class="tablewrap"><table class="table"><thead><tr><th>When</th><th>To</th><th>Subject</th><th>Status</th></tr></thead><tbody>${rows.map((r) => html`<tr><td>${fmtDate(r.created_at)}</td><td>${r.to_addr}</td><td>${r.subject}</td><td>${r.status}</td></tr>`)}</tbody></table></div>` }); });
