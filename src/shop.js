/* Catalog queries, server-side pricing, cart and coupon logic. The browser is never trusted for prices. */
import { q, now } from './db.js';
import { S, num, flag } from './settings.js';
import { UserError, clampInt, inr } from './util.js';

const LIVE = `p.status='published' AND (p.publish_at IS NULL OR p.publish_at<=@now)`;
const EFF = `CASE WHEN p.sale_price IS NOT NULL AND p.sale_price<p.price AND (p.sale_start IS NULL OR p.sale_start<=@now) AND (p.sale_end IS NULL OR p.sale_end>=@now) THEN p.sale_price ELSE p.price END`;
const STOCK = `COALESCE((SELECT SUM(v.stock) FROM variants v WHERE v.product_id=p.id), p.stock)`;
const SELECT = `SELECT p.*, b.name AS brand, c.name AS category_name, c.slug AS category_slug,
  (${EFF}) AS eff_price, (${STOCK}) AS stock_total,
  COALESCE((SELECT path FROM product_images i WHERE i.product_id=p.id ORDER BY is_primary DESC, position, id LIMIT 1),'') AS image,
  COALESCE((SELECT alt FROM product_images i WHERE i.product_id=p.id ORDER BY is_primary DESC, position, id LIMIT 1),'') AS image_alt,
  (SELECT AVG(rating) FROM reviews r WHERE r.product_id=p.id AND r.status='published') AS rating,
  (SELECT COUNT(*) FROM reviews r WHERE r.product_id=p.id AND r.status='published') AS review_count,
  (SELECT COUNT(*) FROM variants v WHERE v.product_id=p.id) AS variants_n
  FROM products p LEFT JOIN brands b ON b.id=p.brand_id LEFT JOIN categories c ON c.id=p.category_id`;

// node:sqlite named parameters need the prefix in the key and only accept parameters that appear in the SQL
function named(sql, params) {
  const out = {}; for (const k of Object.keys(params)) if (sql.includes('@' + k)) out['@' + k] = params[k]; return out;
}
function all(sql, params) { return q.all(sql.replace(/@(\w+)/g, '@$1'), named(sql, params)); }

export function priceOf(p, v = null, at = Date.now()) {
  const base = v && v.price != null ? v.price : p.price;
  const onSale = p.sale_price != null && p.sale_price < p.price
    && (!p.sale_start || Date.parse(p.sale_start) <= at) && (!p.sale_end || Date.parse(p.sale_end) >= at);
  if (!onSale) return { price: base, mrp: base, onSale: false };
  const price = v && v.price != null ? Math.round(v.price * (p.sale_price / p.price)) : p.sale_price;
  return { price, mrp: base, onSale: true };
}
export const discountPct = (p) => (p.eff_price < p.price ? Math.round((1 - p.eff_price / p.price) * 100) : 0);

export function categoryTree(includeUnpublished = false) {
  const rows = q.all(`SELECT * FROM categories ${includeUnpublished ? '' : 'WHERE published=1'} ORDER BY position, name`);
  const byId = new Map(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots = [];
  for (const r of byId.values()) { const par = r.parent_id && byId.get(r.parent_id); (par ? par.children : roots).push(r); }
  return roots;
}
export function categoryIds(id) {
  return q.all('WITH RECURSIVE t(id) AS (SELECT ? UNION ALL SELECT c.id FROM categories c JOIN t ON c.parent_id=t.id) SELECT id FROM t', id).map((r) => r.id);
}
export function breadcrumbs(catId) {
  const trail = []; let id = catId;
  while (id && trail.length < 6) { const c = q.get('SELECT id,name,slug,parent_id FROM categories WHERE id=?', id); if (!c) break; trail.unshift(c); id = c.parent_id; }
  return trail;
}

export function listProducts({ search = '', cat = null, brand = '', min = 0, max = 0, rating = 0, instock = false, sort = 'popular', page = 1, per = 12, flagName = '', onlyDeals = false, exclude = 0, ids = null } = {}) {
  const where = [LIVE]; const p = { now: now() };
  if (search) {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
    words.forEach((w, i) => {
      p['w' + i] = '%' + w.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
      where.push(`(lower(p.name) LIKE @w${i} ESCAPE '\\' OR lower(COALESCE(b.name,'')) LIKE @w${i} ESCAPE '\\' OR lower(p.tags) LIKE @w${i} ESCAPE '\\' OR lower(p.sku) LIKE @w${i} ESCAPE '\\' OR lower(COALESCE(c.name,'')) LIKE @w${i} ESCAPE '\\')`);
    });
  }
  if (cat) { const ids2 = categoryIds(cat); where.push(`p.category_id IN (${ids2.map(Number).join(',') || 0})`); }
  if (brand && brand.length) { const bs = [].concat(brand).slice(0, 10); where.push(`b.slug IN (${bs.map((_, i) => '@b' + i).join(',')})`); bs.forEach((b, i) => { p['b' + i] = b; }); }
  if (min) { where.push(`(${EFF}) >= @min`); p.min = min; }
  if (max) { where.push(`(${EFF}) <= @max`); p.max = max; }
  if (rating) { where.push(`COALESCE((SELECT AVG(rating) FROM reviews r WHERE r.product_id=p.id AND r.status='published'),0) >= @rating`); p.rating = rating; }
  if (instock) where.push(`(${STOCK}) > 0`);
  if (flagName) where.push(`p.${{ trending: 'trending', bestseller: 'bestseller', featured: 'featured' }[flagName]}=1`);
  if (onlyDeals) where.push(`(${EFF}) < p.price`);
  if (exclude) { where.push('p.id<>@exclude'); p.exclude = exclude; }
  if (ids) where.push(`p.id IN (${ids.map(Number).join(',') || 0})`);
  const order = {
    price_asc: 'eff_price ASC', price_desc: 'eff_price DESC', newest: 'p.created_at DESC',
    rating: 'COALESCE(rating,0) DESC, review_count DESC',
    popular: `(SELECT COALESCE(SUM(oi.qty),0) FROM order_items oi WHERE oi.product_id=p.id) DESC, p.bestseller DESC, p.featured DESC, p.id DESC`,
    discount: `(1.0 - (${EFF}) * 1.0 / NULLIF(p.price,0)) DESC`,
  }[sort] || 'p.id DESC';
  const ws = where.join(' AND ');
  const from = `FROM products p LEFT JOIN brands b ON b.id=p.brand_id LEFT JOIN categories c ON c.id=p.category_id WHERE ${ws}`;
  const total = q.get(`SELECT COUNT(*) n ${from}`.replace(/@(\w+)/g, '@$1'), named(from, p)).n;
  const sql = `${SELECT} WHERE ${ws} ORDER BY ${order}, p.id DESC LIMIT ${clampInt(per, 1, 60)} OFFSET ${(clampInt(page, 1, 100000) - 1) * clampInt(per, 1, 60)}`;
  return { items: all(sql, p), total };
}

export function getProductBySlug(slug, { includeDrafts = false } = {}) {
  const sql = `${SELECT} WHERE p.slug=@slug ${includeDrafts ? '' : `AND ${LIVE}`}`;
  const p = all(sql, { slug, now: now() })[0];
  if (!p) return null;
  p.images = q.all('SELECT * FROM product_images WHERE product_id=? ORDER BY is_primary DESC, position, id', p.id);
  p.variants = q.all('SELECT * FROM variants WHERE product_id=? ORDER BY position, id', p.id);
  try { p.specList = JSON.parse(p.specs || '[]'); } catch { p.specList = []; }
  return p;
}
export function getProductsByIds(ids) { return ids.length ? listProducts({ ids, per: 60 }).items : []; }
export function brandsFor(catId) {
  const cond = catId ? `AND p.category_id IN (${categoryIds(catId).join(',')})` : '';
  return all(`SELECT b.name,b.slug,COUNT(*) n FROM products p JOIN brands b ON b.id=p.brand_id WHERE ${LIVE} ${cond} GROUP BY b.id ORDER BY n DESC, b.name LIMIT 30`, { now: now() });
}
export function suggest(term) {
  const t = term.toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c).slice(0, 60);
  const prods = all(`SELECT p.name,p.slug,(${EFF}) AS eff_price FROM products p WHERE ${LIVE} AND (lower(p.name) LIKE @t ESCAPE '\\' OR lower(p.tags) LIKE @t ESCAPE '\\') ORDER BY (lower(p.name) LIKE @s ESCAPE '\\') DESC, p.name LIMIT 6`, { now: now(), t: `%${t}%`, s: `${t}%` });
  const cats = q.all("SELECT name,slug FROM categories WHERE published=1 AND lower(name) LIKE ? ESCAPE '\\' LIMIT 3", `%${t}%`);
  return { products: prods, categories: cats };
}
export const stockOf = (p, v) => (v ? v.stock : p.variants && p.variants.length ? 0 : p.stock);

/* ---------------- cart ---------------- */
export function cartAdd(ownerKey, productId, variantId, qty) {
  const p = getProductBySlugById(productId);
  if (!p) throw new UserError('This product is not available.');
  const variants = q.all('SELECT * FROM variants WHERE product_id=?', productId);
  let v = null;
  if (variants.length) { v = variants.find((x) => x.id === variantId); if (!v) throw new UserError('Please choose an option (e.g. size, colour or storage).'); }
  else variantId = 0;
  const stock = v ? v.stock : p.stock;
  qty = clampInt(qty, 1, 20, 1);
  const cur = q.get('SELECT qty FROM cart_items WHERE owner_key=? AND product_id=? AND variant_id=?', ownerKey, productId, variantId || 0)?.qty || 0;
  if (stock <= 0) throw new UserError('Sorry, this item is out of stock.');
  const next = Math.min(cur + qty, 20);
  if (next > stock) throw new UserError(`Only ${stock} left in stock.`);
  q.run(`INSERT INTO cart_items(owner_key,product_id,variant_id,qty,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(owner_key,product_id,variant_id) DO UPDATE SET qty=excluded.qty, updated_at=excluded.updated_at`, ownerKey, productId, variantId || 0, next, now());
}
function getProductBySlugById(id) {
  return all(`${SELECT} WHERE p.id=@id AND ${LIVE}`, { id, now: now() })[0];
}
export function cartSet(ownerKey, itemId, qty) {
  const it = q.get('SELECT * FROM cart_items WHERE id=? AND owner_key=?', itemId, ownerKey);
  if (!it) return;
  if (qty <= 0) { q.run('DELETE FROM cart_items WHERE id=?', itemId); return; }
  const stock = it.variant_id ? q.get('SELECT stock FROM variants WHERE id=?', it.variant_id)?.stock ?? 0 : q.get('SELECT stock FROM products WHERE id=?', it.product_id)?.stock ?? 0;
  if (qty > stock) throw new UserError(`Only ${stock} left in stock.`);
  q.run('UPDATE cart_items SET qty=?, updated_at=? WHERE id=?', Math.min(qty, 20), now(), itemId);
}
export const cartRemove = (ownerKey, itemId) => q.run('DELETE FROM cart_items WHERE id=? AND owner_key=?', itemId, ownerKey);
export const cartCount = (ownerKey) => q.get('SELECT COALESCE(SUM(qty),0) n FROM cart_items WHERE owner_key=?', ownerKey).n;
export function cartMerge(guestKey, userKey) {
  for (const it of q.all('SELECT * FROM cart_items WHERE owner_key=?', guestKey)) {
    const ex = q.get('SELECT qty FROM cart_items WHERE owner_key=? AND product_id=? AND variant_id=?', userKey, it.product_id, it.variant_id);
    if (ex) q.run('UPDATE cart_items SET qty=? WHERE owner_key=? AND product_id=? AND variant_id=?', Math.min(20, ex.qty + it.qty), userKey, it.product_id, it.variant_id);
    else q.run('UPDATE cart_items SET owner_key=? WHERE id=?', userKey, it.id);
  }
  q.run('DELETE FROM cart_items WHERE owner_key=?', guestKey);
}

/** Lines with live, server-computed prices and stock status. */
export function cartLines(ownerKey) {
  const lines = [];
  for (const it of q.all('SELECT * FROM cart_items WHERE owner_key=? ORDER BY id', ownerKey)) {
    const p = getProductBySlugById(it.product_id);
    if (!p) { q.run('DELETE FROM cart_items WHERE id=?', it.id); continue; }
    const v = it.variant_id ? q.get('SELECT * FROM variants WHERE id=? AND product_id=?', it.variant_id, p.id) : null;
    if (it.variant_id && !v) { q.run('DELETE FROM cart_items WHERE id=?', it.id); continue; }
    const stock = v ? v.stock : p.stock;
    const pr = priceOf(p, v);
    let problem = '';
    if (stock <= 0) problem = 'Out of stock'; else if (it.qty > stock) problem = `Only ${stock} left`;
    lines.push({ id: it.id, product: p, variant: v, qty: it.qty, unit: pr.price, mrp: pr.mrp, total: pr.price * it.qty, stock, problem, image: p.image });
  }
  return lines;
}

/* ---------------- coupons ---------------- */
export function validateCoupon(code, { user, lines, subtotal }) {
  const c = code ? q.get('SELECT * FROM coupons WHERE code=?', String(code).trim()) : null;
  const fail = (error) => ({ error });
  if (!c || !c.active) return fail('This coupon code is not valid.');
  const t = Date.now();
  if (c.starts_at && Date.parse(c.starts_at) > t) return fail('This coupon is not active yet.');
  if (c.ends_at && Date.parse(c.ends_at) < t) return fail('This coupon has expired.');
  if (c.usage_limit && c.used_count >= c.usage_limit) return fail('This coupon has reached its usage limit.');
  if (c.first_order_only) {
    if (!user) return fail('Please sign in to use this first-order coupon.');
    if (q.get("SELECT 1 x FROM orders WHERE user_id=? AND status<>'cancelled'", user.id)) return fail('This coupon is only for your first order.');
  }
  if (c.per_user_limit) {
    if (!user) return fail('Please sign in to use this coupon.');
    const used = q.get("SELECT COUNT(*) n FROM orders WHERE user_id=? AND coupon_code=? COLLATE NOCASE AND status<>'cancelled'", user.id, c.code).n;
    if (used >= c.per_user_limit) return fail('You have already used this coupon the maximum number of times.');
  }
  const cats = c.category_id ? new Set(categoryIds(c.category_id)) : null;
  const eligible = lines.filter((l) => (!c.product_id || l.product.id === c.product_id) && (!cats || cats.has(l.product.category_id)));
  const base = eligible.reduce((s, l) => s + l.total, 0);
  if (!base) return fail('This coupon does not apply to the items in your cart.');
  if (subtotal < c.min_order) return fail(`A minimum order of ${inr(c.min_order)} is required for this coupon.`);
  let d = c.type === 'percent' ? Math.floor((base * c.value) / 100) : Math.min(c.value, base);
  if (c.max_discount && d > c.max_discount) d = c.max_discount;
  return { coupon: c, discount: Math.max(0, Math.min(d, subtotal)), freeShip: !!c.free_shipping };
}

/** Full server-side totals. Prices are GST-inclusive; `tax` is the GST portion contained in the total. */
export function calcTotals(lines, { couponCode = '', user = null } = {}) {
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  let discount = 0, freeShip = false, couponError = '', coupon = null;
  if (couponCode && lines.length) {
    const r = validateCoupon(couponCode, { user, lines, subtotal });
    if (r.error) couponError = r.error; else { discount = r.discount; freeShip = r.freeShip; coupon = r.coupon; }
  }
  const afterDiscount = subtotal - discount;
  const freeByThreshold = num('free_ship_threshold') > 0 && afterDiscount >= num('free_ship_threshold');
  const shipping = !lines.length || freeShip || freeByThreshold ? 0 : num('shipping_fee');
  const total = afterDiscount + shipping;
  const rate = num('tax_percent');
  const tax = rate ? Math.round(afterDiscount - afterDiscount / (1 + rate / 100)) : 0;
  return { subtotal, discount, shipping, tax, total, coupon, couponError, freeShipping: shipping === 0 && lines.length > 0, count: lines.reduce((s, l) => s + l.qty, 0) };
}
export const codAllowed = (total) => flag('cod_enabled') && (!num('cod_max_order') || total <= num('cod_max_order'));
export { S };
