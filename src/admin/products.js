import { q, now, tx } from '../db.js';
import { html, raw, inr, fromPaise, toPaise, slugify, saveImage, UserError, csv, parseCsv, fromLocalInput, toLocalInput, pageParam, esc } from '../util.js';
import { csrfField, pager, statusPill } from '../views.js';
import { aget, apost, adminPage, fld, readFields, log } from './core.js';
import { categoryTree } from '../shop.js';

const catOptions = () => { const out = [['', '- none -']]; const walk = (list, d = 0) => list.forEach((c) => { out.push([c.id, '\u00a0\u00a0'.repeat(d) + c.name]); walk(c.children, d + 1); }); walk(categoryTree(true)); return out; };
const FIELDS = [
  { name: 'name', label: 'Product name', required: true, maxlength: 200 }, { name: 'sku', label: 'SKU', required: true, pattern: /^[\w.-]{2,40}$/, help: 'Letters, numbers, dash, underscore. Must be unique.' },
  { name: 'slug', label: 'URL slug', help: 'Leave blank to generate from the name. Changing it creates a 301 redirect from the old URL.' },
  { name: 'brand', label: 'Brand', help: 'Type a brand name; new brands are created automatically.' },
  { name: 'category_id', label: 'Category', type: 'select', options: catOptions, nullable: true, numeric: true },
  { name: 'short_desc', label: 'Short description (one line, shown on cards)' },
  { name: 'description', label: 'Full description (HTML allowed: p, ul, li, strong, h2...)', type: 'textarea', rows: 6 },
  { name: 'price', label: 'Regular price (MRP, GST-inclusive)', type: 'rupees', required: true }, { name: 'sale_price', label: 'Sale price', type: 'rupees', help: 'Must be lower than the regular price. Leave blank for no discount.' },
  { name: 'sale_start', label: 'Sale starts', type: 'datetime' }, { name: 'sale_end', label: 'Sale ends', type: 'datetime', help: 'The server stops applying the sale price automatically at this time.' },
  { name: 'stock', label: 'Stock quantity (ignored when variants are used)', type: 'number', min: 0 },
  { name: 'status', label: 'Status', type: 'select', required: true, options: () => [['draft', 'Draft (hidden)'], ['published', 'Published'], ['archived', 'Archived (hidden)']] },
  { name: 'publish_at', label: 'Publish at (schedule)', type: 'datetime', help: 'Published products with a future date stay hidden until then.' },
  { name: 'featured', label: 'Featured', type: 'bool' }, { name: 'trending', label: 'Trending', type: 'bool' }, { name: 'bestseller', label: 'Best seller', type: 'bool' },
  { name: 'tags', label: 'Tags (comma separated)' }, { name: 'warranty', label: 'Warranty information' }, { name: 'shipping_note', label: 'Shipping information' }, { name: 'weight_g', label: 'Weight (grams)', type: 'number', min: 0 },
  { name: 'seo_title', label: 'SEO title (optional)', maxlength: 70 }, { name: 'seo_desc', label: 'SEO meta description (optional)', type: 'textarea', rows: 2 },
];
const specsToText = (j) => { try { return JSON.parse(j || '[]').map((s) => `${s.k}: ${s.v}`).join('\n'); } catch { return ''; } };
const variantsToText = (vs) => vs.map((v) => [v.label, v.price == null ? '' : fromPaise(v.price), v.stock, v.sku].join(' | ')).join('\n');

function form(ctx, p, err) {
  const imgs = p?.id ? q.all('SELECT * FROM product_images WHERE product_id=? ORDER BY is_primary DESC, position, id', p.id) : [];
  const vs = p?.id ? q.all('SELECT * FROM variants WHERE product_id=? ORDER BY position,id', p.id) : [];
  const brand = p?.brand_id ? q.get('SELECT name FROM brands WHERE id=?', p.brand_id)?.name : p?.brand;
  const val = (f) => (f.name === 'brand' ? brand : p?.[f.name]);
  adminPage(ctx, { status: err ? 400 : 200, title: p?.id ? `Edit product` : 'New product', active: '/admin/products', body: html`${err ? html`<p class="flash err" role="alert">${err}</p>` : ''}${p?.is_sample ? html`<p class="flash warn">This is sample data. Replace it with your real product or remove sample data in Store settings.</p>` : ''}
  <form method="post" action="/admin/products/save" enctype="multipart/form-data" class="card pad stack formw">${csrfField(ctx)}<input type="hidden" name="id" value="${p?.id || ''}">
    ${FIELDS.map((f) => fld(f, val(f)))}
    <label>Specifications (one per line, "Name: Value")<textarea name="specs" rows="4">${p?.specs_text ?? specsToText(p?.specs)}</textarea></label>
    <label>Variants (one per line: "Label | price (optional) | stock | SKU (optional)"), e.g. size, colour, storage<textarea name="variants" rows="4" placeholder="128GB | | 10 | NOVA-128&#10;256GB | 79999 | 5 | NOVA-256">${p?.variants_text ?? variantsToText(vs)}</textarea></label>
    <fieldset><legend>Images</legend>${imgs.map((i) => html`<div class="imgrow"><img src="${i.path}" alt="" class="thumb"><label>Alt text <input name="alt_${i.id}" value="${i.alt}"></label><label class="chk"><input type="radio" name="primary" value="${i.id}" ${i.is_primary ? raw('checked') : ''}> Primary</label><label class="chk"><input type="checkbox" name="del_${i.id}" value="1"> Remove</label></div>`)}
      <label>Add images (JPG/PNG/WebP, max 3 MB each)<input type="file" name="images" accept="image/png,image/jpeg,image/webp" multiple></label><label>Alt text for new images <input name="new_alt" placeholder="Describe the product photo"></label></fieldset>
    <div class="btnrow"><button class="btn btn-orange">Save product</button><a class="btn" href="/admin/products">Cancel</a>${p?.slug && p?.id ? html`<a class="btn" href="/p/${p.slug}" target="_blank">View on store</a>` : ''}</div></form>` });
}
function parseSpecs(t) { return String(t || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 60).map((l) => { const i = l.indexOf(':'); return i > 0 ? { k: l.slice(0, i).trim(), v: l.slice(i + 1).trim() } : null; }).filter(Boolean); }
function parseVariants(t) {
  return String(t || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 60).map((l) => {
    const [label, price, stock, sku] = l.split('|').map((x) => x.trim());
    if (!label) throw new UserError('Each variant needs a label.');
    const pr = price ? toPaise(price) : null; const st = parseInt(stock || '0', 10);
    if ((price && !(pr >= 0)) || !(st >= 0)) throw new UserError(`Variant "${label}" has an invalid price or stock.`);
    return { label, price: pr, stock: st, sku: sku || '' };
  });
}
function uniqueSlug(base, ignoreId) { let s = base, n = 2; while (q.get('SELECT 1 x FROM products WHERE slug=? AND id<>?', s, ignoreId || 0)) s = `${base}-${n++}`; return s; }
function brandId(name) { name = String(name || '').trim(); if (!name) return null; const b = q.get('SELECT id FROM brands WHERE name=?', name); return b ? b.id : Number(q.run('INSERT INTO brands(name,slug) VALUES(?,?)', name.slice(0, 60), slugify(name) + '-' + Math.random().toString(36).slice(2, 5)).lastInsertRowid); }

export function saveProduct(vals, row) {
  if (vals.sale_price != null && vals.sale_price >= vals.price) throw new UserError('Sale price must be lower than the regular price.');
  if (vals.sale_start && vals.sale_end && vals.sale_end <= vals.sale_start) throw new UserError('Sale end must be after the sale start.');
  const slug = uniqueSlug(slugify(vals.slug || vals.name), row?.id);
  const bid = brandId(vals.brand); delete vals.brand;
  const data = { ...vals, slug, brand_id: bid, updated_at: now() };
  let id;
  if (row) { const keys = Object.keys(data); q.run(`UPDATE products SET ${keys.map((k) => k + '=?').join(',')} WHERE id=?`, ...keys.map((k) => data[k]), row.id); id = row.id; if (row.slug !== slug) q.run('INSERT OR REPLACE INTO redirects(from_path,to_path) VALUES(?,?)', `/p/${row.slug}`, `/p/${slug}`); }
  else { data.created_at = now(); const keys = Object.keys(data); id = Number(q.run(`INSERT INTO products(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, ...keys.map((k) => data[k])).lastInsertRowid); }
  q.run('DELETE FROM redirects WHERE from_path=?', `/p/${slug}`);
  return id;
}

aget('/admin/products', (ctx) => {
  const Q = ctx.query, page = pageParam(Q.get('page')), per = 25; const w = ['1=1']; const p = [];
  const STOCK = 'COALESCE((SELECT SUM(stock) FROM variants v WHERE v.product_id=p.id), p.stock)';
  if (Q.get('q')) { w.push('(p.name LIKE ? OR p.sku LIKE ?)'); p.push(`%${Q.get('q')}%`, `%${Q.get('q')}%`); }
  if (['draft', 'published', 'archived'].includes(Q.get('status'))) { w.push('p.status=?'); p.push(Q.get('status')); }
  if (Q.get('cat')) { w.push('p.category_id=?'); p.push(Number(Q.get('cat'))); }
  if (Q.get('stock') === 'out') w.push(`${STOCK}<=0`); if (Q.get('stock') === 'low') w.push(`${STOCK} BETWEEN 1 AND 5`);
  const total = q.get(`SELECT COUNT(*) n FROM products p WHERE ${w.join(' AND ')}`, ...p).n;
  const rows = q.all(`SELECT p.*, ${STOCK} AS st, (SELECT path FROM product_images i WHERE i.product_id=p.id ORDER BY is_primary DESC,id LIMIT 1) img, (SELECT name FROM categories c WHERE c.id=p.category_id) cat FROM products p WHERE ${w.join(' AND ')} ORDER BY p.id DESC LIMIT ${per} OFFSET ${(page - 1) * per}`, ...p);
  adminPage(ctx, { title: 'Products', active: '/admin/products', body: html`<div class="btnrow"><a class="btn btn-orange" href="/admin/products/new">+ New product</a><a class="btn" href="/admin/products/export.csv">Export CSV</a></div>
  <form class="filterbar" method="get"><input name="q" placeholder="Search name or SKU" value="${Q.get('q') || ''}"><select name="status"><option value="">Any status</option>${['draft', 'published', 'archived'].map((s) => html`<option ${Q.get('status') === s ? raw('selected') : ''}>${s}</option>`)}</select><select name="cat">${catOptions().map(([v, l]) => html`<option value="${v}" ${String(v) === Q.get('cat') ? raw('selected') : ''}>${v === '' ? 'Any category' : l}</option>`)}</select><select name="stock"><option value="">Any stock</option><option value="low" ${Q.get('stock') === 'low' ? raw('selected') : ''}>Low stock</option><option value="out" ${Q.get('stock') === 'out' ? raw('selected') : ''}>Out of stock</option></select><button class="btn btn-sm">Filter</button></form>
  <form method="post" action="/admin/products/bulk">${csrfField(ctx)}<div class="tablewrap"><table class="table"><thead><tr><th><span class="sr">Select</span></th><th></th><th>Product</th><th>Price</th><th>Stock</th><th>Status</th><th></th></tr></thead><tbody>
  ${rows.map((r) => html`<tr><td><input type="checkbox" name="ids" value="${r.id}" aria-label="Select ${r.name}"></td><td>${r.img ? html`<img class="thumb" src="${r.img}" alt="">` : ''}</td><td><a href="/admin/products/${r.id}"><b>${r.name}</b></a>${r.is_sample ? html` <span class="pill">sample</span>` : ''}<br><span class="muted small">${r.sku} &middot; ${r.cat || 'Uncategorised'}</span></td><td>${inr(r.price)}${r.sale_price != null ? html`<br><span class="ok-t small">Sale ${inr(r.sale_price)}</span>` : ''}</td><td class="${r.st <= 0 ? 'err-t' : ''}">${r.st}</td><td>${statusPill(r.status)}</td><td class="nowrap"><a class="btn btn-sm" href="/admin/products/${r.id}">Edit</a> <button class="btn btn-sm btn-danger" type="submit" formaction="/admin/products/${r.id}/delete" formmethod="post" formnovalidate data-confirm="Delete this product? This cannot be undone.">Delete</button></td></tr>`)}${rows.length ? '' : html`<tr><td colspan="7" class="muted">No products match.</td></tr>`}</tbody></table></div>
  <fieldset class="bulk"><legend>Bulk update selected</legend><select name="action" required><option value="">Choose action</option><option value="publish">Publish</option><option value="draft">Unpublish (draft)</option><option value="archive">Archive</option><option value="feature_on">Mark featured</option><option value="feature_off">Remove featured</option><option value="trending_on">Mark trending</option><option value="trending_off">Remove trending</option><option value="bestseller_on">Mark best seller</option><option value="bestseller_off">Remove best seller</option><option value="set_category">Set category &rarr;</option><option value="price_pct">Change prices by % &rarr;</option><option value="set_stock">Set stock to &rarr;</option></select>
  <select name="category_id">${catOptions().map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select><input name="value" type="number" step="0.01" placeholder="Value (% or quantity)"><button class="btn btn-orange btn-sm" data-confirm="Apply to all selected products?">Apply</button></fieldset></form>
  ${pager(ctx, page, total, per)}
  <form method="post" action="/admin/products/import" enctype="multipart/form-data" class="card pad stack formw">${csrfField(ctx)}<h2>Import products (CSV)</h2><p class="muted small">Columns: sku,name,category_slug,brand,price,sale_price,stock,status,short_desc,tags (prices in rupees). Existing SKUs are updated; new SKUs are created. Max 2000 rows.</p><input type="file" name="csv" accept=".csv,text/csv" required><button class="btn">Import</button></form>` });
});
aget('/admin/products/new', (ctx) => form(ctx, null));
aget('/admin/products/export.csv', (ctx) => {
  const rows = q.all('SELECT p.*, b.name brand, c.slug cat FROM products p LEFT JOIN brands b ON b.id=p.brand_id LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.id');
  log(ctx, 'products.export', 'products', rows.length);
  ctx.text(csv([['sku', 'name', 'category_slug', 'brand', 'price', 'sale_price', 'stock', 'status', 'short_desc', 'tags'], ...rows.map((r) => [r.sku, r.name, r.cat, r.brand, fromPaise(r.price), fromPaise(r.sale_price), r.stock, r.status, r.short_desc, r.tags])]), 'text/csv; charset=utf-8', { 'Content-Disposition': 'attachment; filename="products.csv"' });
});
aget('/admin/products/:id', (ctx) => { const p = q.get('SELECT * FROM products WHERE id=?', ctx.params.id); if (!p) return ctx.notFound(); form(ctx, p); });

apost('/admin/products/save', (ctx) => {
  const row = ctx.body.id ? q.get('SELECT * FROM products WHERE id=?', ctx.body.id) : null;
  try {
    const id = tx(() => {
      const vals = readFields(ctx, FIELDS, row || {});
      vals.specs = JSON.stringify(parseSpecs(ctx.body.specs));
      const vs = parseVariants(ctx.body.variants);
      const pid = saveProduct(vals, row);
      // variants: update by label, insert new, delete removed
      const existing = q.all('SELECT * FROM variants WHERE product_id=?', pid);
      vs.forEach((v, i) => { const ex = existing.find((e) => e.label === v.label); if (ex) q.run('UPDATE variants SET price=?, stock=?, sku=?, position=? WHERE id=?', v.price, v.stock, v.sku, i, ex.id); else q.run('INSERT INTO variants(product_id,label,sku,price,stock,position) VALUES(?,?,?,?,?,?)', pid, v.label, v.sku, v.price, v.stock, i); });
      for (const ex of existing) if (!vs.some((v) => v.label === ex.label)) q.run('DELETE FROM variants WHERE id=?', ex.id);
      // images
      for (const i of q.all('SELECT * FROM product_images WHERE product_id=?', pid)) {
        if (ctx.body['del_' + i.id]) q.run('DELETE FROM product_images WHERE id=?', i.id);
        else q.run('UPDATE product_images SET alt=? WHERE id=?', String(ctx.body['alt_' + i.id] ?? i.alt).slice(0, 200), i.id);
      }
      let added = 0;
      for (const f of ctx.files.filter((x) => x.name === 'images' && x.filename)) { const path = saveImage(f); if (path) { q.run('INSERT INTO product_images(product_id,path,alt,position) VALUES(?,?,?,?)', pid, path, String(ctx.body.new_alt || vals.name).slice(0, 200), 100 + added++); } }
      const imgs = q.all('SELECT id FROM product_images WHERE product_id=? ORDER BY position,id', pid);
      const want = Number(ctx.body.primary); const prim = imgs.find((i) => i.id === want) || imgs[0];
      q.run('UPDATE product_images SET is_primary=0 WHERE product_id=?', pid); if (prim) q.run('UPDATE product_images SET is_primary=1 WHERE id=?', prim.id);
      return pid;
    });
    log(ctx, row ? 'product.update' : 'product.create', 'product', `${ctx.body.name} (#${id})`);
    ctx.flash('ok', 'Product saved.'); ctx.redirect('/admin/products/' + id);
  } catch (e) {
    if (/UNIQUE constraint failed: products.sku/.test(e.message)) e = new UserError('That SKU is already used by another product.');
    if (!e.user) throw e;
    form(ctx, { ...(row || {}), ...ctx.body, id: row?.id, price: toPaise(ctx.body.price) || 0, sale_price: ctx.body.sale_price ? toPaise(ctx.body.sale_price) : null, specs_text: ctx.body.specs, variants_text: ctx.body.variants, brand: ctx.body.brand }, e.message);
  }
});
apost('/admin/products/:id/delete', (ctx) => {
  const p = q.get('SELECT * FROM products WHERE id=?', ctx.params.id); if (!p) return ctx.redirect('/admin/products');
  if (q.get('SELECT 1 x FROM order_items WHERE product_id=?', p.id)) { q.run("UPDATE products SET status='archived', updated_at=? WHERE id=?", now(), p.id); ctx.flash('ok', 'This product has past orders, so it was archived instead of deleted.'); }
  else { q.run('DELETE FROM products WHERE id=?', p.id); ctx.flash('ok', 'Product deleted.'); }
  log(ctx, 'product.delete', 'product', p.name); ctx.redirect('/admin/products');
});
apost('/admin/products/bulk', (ctx) => {
  const ids = [].concat(ctx.body.ids || []).map(Number).filter(Boolean).slice(0, 500); const a = ctx.body.action;
  if (!ids.length || !a) { ctx.flash('err', 'Select products and an action.'); return ctx.redirect('/admin/products'); }
  const ph = ids.map(() => '?').join(','); const val = Number(ctx.body.value);
  try {
    tx(() => {
      const m = { publish: "status='published'", draft: "status='draft'", archive: "status='archived'", feature_on: 'featured=1', feature_off: 'featured=0', trending_on: 'trending=1', trending_off: 'trending=0', bestseller_on: 'bestseller=1', bestseller_off: 'bestseller=0' };
      if (m[a]) q.run(`UPDATE products SET ${m[a]}, updated_at=? WHERE id IN (${ph})`, now(), ...ids);
      else if (a === 'set_category') q.run(`UPDATE products SET category_id=?, updated_at=? WHERE id IN (${ph})`, ctx.body.category_id ? Number(ctx.body.category_id) : null, now(), ...ids);
      else if (a === 'set_stock') { if (!(val >= 0)) throw new UserError('Enter a valid stock quantity.'); q.run(`UPDATE products SET stock=?, updated_at=? WHERE id IN (${ph}) AND id NOT IN (SELECT product_id FROM variants)`, Math.floor(val), now(), ...ids); }
      else if (a === 'price_pct') { if (!Number.isFinite(val) || val <= -90 || val > 500) throw new UserError('Enter a percentage between -90 and 500.'); q.run(`UPDATE products SET price=MAX(1,CAST(ROUND(price*(1+?/100.0)) AS INTEGER)), sale_price=CASE WHEN sale_price IS NULL THEN NULL ELSE MAX(0,CAST(ROUND(sale_price*(1+?/100.0)) AS INTEGER)) END, updated_at=? WHERE id IN (${ph})`, val, val, now(), ...ids); }
      else throw new UserError('Unknown action.');
    });
    log(ctx, 'products.bulk', a, `${ids.length} products`); ctx.flash('ok', `Updated ${ids.length} product(s).`);
  } catch (e) { if (!e.user) throw e; ctx.flash('err', e.message); }
  ctx.redirect('/admin/products');
});
apost('/admin/products/import', (ctx) => {
  const f = ctx.files.find((x) => x.name === 'csv'); if (!f) { ctx.flash('err', 'Choose a CSV file.'); return ctx.redirect('/admin/products'); }
  const rows = parseCsv(f.body.toString('utf8').replace(/^\ufeff/, '')); const head = rows.shift()?.map((h) => h.trim().toLowerCase()) || [];
  if (!['sku', 'name', 'price'].every((c) => head.includes(c))) { ctx.flash('err', 'CSV must have at least sku, name and price columns.'); return ctx.redirect('/admin/products'); }
  if (rows.length > 2000) { ctx.flash('err', 'Too many rows (max 2000).'); return ctx.redirect('/admin/products'); }
  let created = 0, updated = 0; const errors = [];
  tx(() => rows.forEach((r, i) => {
    const o = Object.fromEntries(head.map((h, j) => [h, (r[j] || '').trim()]));
    try {
      const price = toPaise(o.price), sale = o.sale_price ? toPaise(o.sale_price) : null;
      if (!o.sku || !o.name || !(price >= 0)) throw new UserError('missing sku, name or valid price');
      const cat = o.category_slug ? q.get('SELECT id FROM categories WHERE slug=?', o.category_slug)?.id ?? null : null;
      const row = q.get('SELECT * FROM products WHERE sku=?', o.sku);
      const status = ['draft', 'published', 'archived'].includes(o.status) ? o.status : row?.status || 'draft';
      const vals = { name: o.name.slice(0, 200), sku: o.sku, slug: row?.slug || '', brand: o.brand, category_id: cat ?? row?.category_id ?? null, short_desc: o.short_desc || row?.short_desc || '', price, sale_price: sale, stock: Math.max(0, parseInt(o.stock || row?.stock || 0, 10) || 0), status, tags: o.tags || row?.tags || '' };
      saveProduct(vals, row); row ? updated++ : created++;
    } catch (e) { errors.push(`Row ${i + 2}: ${e.message}`); }
  }));
  log(ctx, 'products.import', 'products', `created ${created}, updated ${updated}, errors ${errors.length}`);
  ctx.flash(errors.length ? 'err' : 'ok', `Import finished: ${created} created, ${updated} updated${errors.length ? `, ${errors.length} skipped (${errors.slice(0, 3).join('; ')})` : ''}.`);
  ctx.redirect('/admin/products');
});
