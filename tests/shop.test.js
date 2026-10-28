import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, ownerClient } from './helpers.js';

let app, owner;
before(async () => { app = await boot(); owner = await ownerClient(app); });
after(async () => { await app.close(); });

const PNG = () => new Blob([Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001', 'hex'), Buffer.alloc(20)], { type: 'image/png' });
const prodForm = (o = {}) => ({ id: '', name: 'Test Gadget Pro', sku: 'TST-001', slug: '', brand: 'Testco', category_id: '', short_desc: 'A test gadget', description: '<p>Nice</p><script>alert(1)</script>', price: '1999', sale_price: '', stock: '10', status: 'published', featured: '1', tags: 'gadget', specs: 'Color: Black\nWeight: 1kg', variants: '', new_alt: 'Gadget photo', ...o });

test('owner creates a product with an image; it appears on the storefront with correct price and SEO data', async () => {
  const r = await owner.postMultipart('/admin/products/save', { ...prodForm({ category_id: app.q.get("SELECT id FROM categories WHERE slug='electronics'").id }), images: Object.assign(PNG(), { name: 'g.png' }) });
  assert.equal(r.status, 303, r.text.slice(0, 300));
  const p = app.q.get("SELECT * FROM products WHERE sku='TST-001'");
  assert.equal(p.price, 199900); assert.equal(p.slug, 'test-gadget-pro');
  assert.equal(app.q.get('SELECT COUNT(*) n FROM product_images WHERE product_id=?', p.id).n, 1);
  const page = await app.client().get('/p/test-gadget-pro');
  assert.equal(page.status, 200); assert.match(page.text, /₹1,999/);
  assert.ok(!page.text.includes('<script>alert(1)</script>'), 'owner HTML is sanitised');
  assert.match(page.text, /<link rel="canonical" href="[^"]+\/p\/test-gadget-pro">/);
  assert.match(page.text, /property="og:title"/);
  const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(page.text)[1]);
  assert.equal(ld['@type'], 'Product'); assert.equal(ld.offers.price, '1999.00'); assert.equal(ld.offers.priceCurrency, 'INR'); assert.equal(ld.offers.availability, 'https://schema.org/InStock');
  assert.equal(ld.aggregateRating, undefined, 'no fabricated ratings');
});

test('owner edits product: price, sale, stock; changing the slug creates a 301 redirect', async () => {
  const p = app.q.get("SELECT * FROM products WHERE sku='TST-001'");
  const r = await owner.postMultipart('/admin/products/save', prodForm({ id: p.id, price: '2499', sale_price: '1799', stock: '3', slug: 'test-gadget-v2' }));
  assert.equal(r.status, 303);
  const u = app.q.get('SELECT * FROM products WHERE id=?', p.id);
  assert.equal(u.price, 249900); assert.equal(u.sale_price, 179900); assert.equal(u.stock, 3);
  const c = app.client();
  const old = await c.get('/p/test-gadget-pro'); assert.equal(old.status, 301); assert.equal(old.location, '/p/test-gadget-v2');
  const page = (await c.get('/p/test-gadget-v2')).text; assert.match(page, /₹1,799/); assert.match(page, /Only 3 left/);
  const bad = await owner.postMultipart('/admin/products/save', prodForm({ id: p.id, price: '100', sale_price: '200' }));
  assert.equal(bad.status, 400); assert.match(bad.text, /Sale price must be lower/);
});

test('product images: SVG and fake image types are refused', async () => {
  const svg = Object.assign(new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], { type: 'image/svg+xml' }), { name: 'x.svg' });
  const r = await owner.postMultipart('/admin/products/save', { ...prodForm({ sku: 'TST-SVG', name: 'Svg Test' }), images: svg });
  assert.equal(r.status, 400); assert.match(r.text, /Only JPG, PNG, WebP or GIF/);
  assert.equal(app.q.get("SELECT COUNT(*) n FROM products WHERE sku='TST-SVG'").n, 0, 'transaction rolled back');
});

test('draft, archived and future-scheduled products are hidden from customers', async () => {
  const c = app.client();
  const mk = async (sku, extra) => { await owner.postMultipart('/admin/products/save', prodForm({ sku, name: 'Hidden ' + sku, ...extra })); return app.q.get('SELECT * FROM products WHERE sku=?', sku); };
  const d = await mk('H-DRAFT', { status: 'draft' }); const a = await mk('H-ARCH', { status: 'archived' });
  const future = await mk('H-FUT', { publish_at: new Date(Date.now() + 5 * 864e5 + 19800000).toISOString().slice(0, 16) });
  for (const p of [d, a, future]) assert.equal((await c.get('/p/' + p.slug)).status, 404, p.sku);
  assert.ok(!(await c.get('/sitemap.xml')).text.includes(future.slug));
  app.q.run('UPDATE products SET publish_at=? WHERE id=?', new Date(Date.now() - 1000).toISOString(), future.id);
  assert.equal((await c.get('/p/' + future.slug)).status, 200, 'goes live once the schedule time passes');
});

test('banner: create, schedule, expire and disable are reflected on the homepage', async () => {
  const c = app.client();
  const base = { zone: 'hero', title: 'Test Banner Alpha', eyebrow: 'TEST', subtitle: 'sub', btn_text: 'Go', btn_url: '/deals', position: '0', active: '1' };
  assert.equal((await owner.postMultipart('/admin/banners/save', { id: '', ...base })).status, 303);
  assert.match((await c.get('/')).text, /Test Banner Alpha/);
  const id = app.q.get("SELECT id FROM banners WHERE title='Test Banner Alpha'").id;
  await owner.postMultipart('/admin/banners/save', { id, ...base, ends_at: '2020-01-01T10:00' });
  assert.ok(!(await c.get('/')).text.includes('Test Banner Alpha'), 'expired banner hidden');
  await owner.postMultipart('/admin/banners/save', { id, ...base, starts_at: '2099-01-01T10:00' });
  assert.ok(!(await c.get('/')).text.includes('Test Banner Alpha'), 'not yet started banner hidden');
  await owner.postMultipart('/admin/banners/save', { id, ...base, active: '' });
  assert.ok(!(await c.get('/')).text.includes('Test Banner Alpha'), 'disabled banner hidden');
  const prev = await owner.get('/admin/preview'); assert.match(prev.text, /Test Banner Alpha/, 'owner preview shows drafts');
  await owner.post('/admin/banners/' + id + '/delete');
  assert.equal(app.q.get('SELECT COUNT(*) n FROM banners WHERE id=?', id).n, 0);
  assert.equal((await owner.postMultipart('/admin/banners/save', { id: '', ...base, starts_at: '2030-01-02T10:00', ends_at: '2030-01-01T10:00' })).status, 400, 'end before start rejected');
});

test('categories are dynamic: new category appears in navigation; loops are rejected', async () => {
  await owner.postMultipart('/admin/categories/save', { id: '', name: 'Zebra Gear', slug: '', parent_id: '', position: '99', published: '1' });
  const c = app.client(); assert.match((await c.get('/')).text, /Zebra Gear/); assert.equal((await c.get('/c/zebra-gear')).status, 200);
  const cat = app.q.get("SELECT * FROM categories WHERE slug='zebra-gear'");
  const self = await owner.postMultipart('/admin/categories/save', { id: cat.id, name: 'Zebra Gear', slug: 'zebra-gear', parent_id: cat.id, position: '1', published: '1' });
  assert.equal(self.status, 400);
  await owner.postMultipart('/admin/categories/save', { id: cat.id, name: 'Zebra Gear', slug: 'zebra-gear', parent_id: '', position: '1', published: '' });
  assert.equal((await c.get('/c/zebra-gear')).status, 404, 'unpublished category hidden');
});

test('search, filters, sorting and pagination work against real product data', async () => {
  const c = app.client();
  const find = async (qs) => (await c.get('/search?' + qs)).text;
  const ids = (t) => [...t.matchAll(/class="ptitle"><a href="\/p\/([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids(await find('q=headphones')).some((s) => s.startsWith('aria-wireless')));
  assert.equal(ids(await find('q=zzzznotfound')).length, 0); assert.match(await find('q=zzzznotfound'), /No products found/);
  const asc = ids(await find('sort=price_asc&q=')); const prices = asc.map((s) => app.q.get("SELECT CASE WHEN sale_price IS NOT NULL THEN sale_price ELSE price END p FROM products WHERE slug=?", s).p);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  const cheap = ids(await find('max=500&q=')); for (const s of cheap) { const p = app.q.get('SELECT price,sale_price FROM products WHERE slug=?', s); assert.ok((p.sale_price ?? p.price) <= 50000); }
  const brand = ids(await find('brand=nova&q=')); assert.ok(brand.length >= 2); for (const s of brand) assert.equal(app.q.get('SELECT b.slug b FROM products p JOIN brands b ON b.id=p.brand_id WHERE p.slug=?', s).b, 'nova');
  const p1 = ids(await find('q=&page=1')), p2 = ids(await find('q=&page=2')); assert.equal(p1.length, 12); assert.ok(p2.length > 0); assert.equal(p1.filter((x) => p2.includes(x)).length, 0);
  const sug = (await c.get('/api/suggest?q=nova')).json(); assert.ok(sug.products.length >= 1);
  assert.match(await find('q=phone'), /name="robots" content="noindex/);
  const listing = (await c.get('/c/electronics?sort=newest')).text; assert.match(listing, /noindex/, 'filtered/sorted listing URLs are noindex (duplicate-content protection)');
  assert.match((await c.get('/c/electronics')).text, /<link rel="canonical" href="[^"]+\/c\/electronics">/);
});

test('cart: totals, shipping threshold, quantity limits and stock validation are computed on the server', async () => {
  const c = app.client();
  const p = app.q.get("SELECT * FROM products WHERE name LIKE 'Quartz%'"); // sale price 299
  assert.equal((await c.post('/cart/add', { product_id: p.id, qty: '2', price: '1', back: '/cart' })).status, 303);
  let cart = (await c.get('/cart')).text;
  assert.match(cart, /₹598/, 'uses server price, ignores browser-sent price'); assert.match(cart, /₹99/, 'shipping fee below threshold');
  await c.post('/cart/add', { product_id: p.id, qty: '20' }); assert.match((await c.get('/cart')).text, /Only \d+ left|₹/);
  const tv = app.q.get("SELECT * FROM products WHERE name LIKE 'Vista 43%'"); app.q.run('UPDATE products SET stock=2 WHERE id=?', tv.id);
  await c.post('/cart/add', { product_id: tv.id, qty: '1' });
  const over = await c.post('/cart/update', { item_id: app.q.get('SELECT id FROM cart_items WHERE product_id=?', tv.id).id, qty: '5' });
  assert.equal(app.q.get('SELECT qty FROM cart_items WHERE product_id=?', tv.id).qty, 1, 'cannot exceed stock');
  app.q.run('UPDATE products SET stock=0 WHERE id=?', tv.id);
  assert.match((await c.get('/cart')).text, /Out of stock/); assert.equal((await c.get('/checkout')).status, 303, 'checkout blocked with unavailable stock');
  const oos = await c.post('/cart/add', { product_id: tv.id, qty: '1', back: '/cart' }); assert.equal(oos.status, 303);
  const ph = app.q.get("SELECT * FROM products WHERE name LIKE 'Nova X5%'"); const noVar = await c.post('/cart/add', { product_id: ph.id, qty: '1', back: '/cart' });
  assert.equal(app.q.get('SELECT COUNT(*) n FROM cart_items WHERE product_id=?', ph.id).n, 0, 'variant products require choosing an option');
});

test('coupons are validated on the server (minimum, expiry, limits, scope, first order, free shipping)', async () => {
  const c = app.client();
  const heads = app.q.get("SELECT * FROM products WHERE name LIKE 'Aria Wireless%'");
  await c.post('/cart/add', { product_id: heads.id, qty: '1' }); // 18,999
  const apply = async (code) => { await c.post('/cart/coupon', { code }); return (await c.get('/cart')).text; };
  assert.match(await apply('NOPE'), /not valid/);
  let t = await apply('DIWALI10'); assert.match(t, /DIWALI10<\/b> applied/); assert.match(t, /-₹1,000/, 'capped by max discount');
  app.q.run("UPDATE coupons SET ends_at='2020-01-01T00:00:00.000Z' WHERE code='DIWALI10'"); await c.post('/cart/coupon', { remove: '1' });
  assert.match(await apply('DIWALI10'), /expired/);
  app.q.run("UPDATE coupons SET ends_at=NULL, usage_limit=1, used_count=1 WHERE code='DIWALI10'"); assert.match(await apply('DIWALI10'), /usage limit/);
  app.q.run("UPDATE coupons SET usage_limit=0, min_order=99999900 WHERE code='DIWALI10'"); assert.match(await apply('DIWALI10'), /minimum order/i);
  assert.match(await apply('WELCOME100'), /sign in/i, 'first-order coupon needs an account');
  const scoped = app.q.run("INSERT INTO coupons(code,type,value,category_id,active) VALUES('FASHION5','percent',5,(SELECT id FROM categories WHERE slug='fashion'),1)");
  assert.match(await apply('FASHION5'), /does not apply/);
  app.q.run("UPDATE coupons SET min_order=0 WHERE code='FREESHIP'"); const cheap = app.q.get("SELECT * FROM products WHERE name LIKE 'Quartz%'"); const c2 = app.client(); await c2.post('/cart/add', { product_id: cheap.id, qty: '1' }); await c2.post('/cart/coupon', { code: 'FREESHIP' });
  assert.match((await c2.get('/cart')).text, /FREE/);
  // admin validation
  assert.equal((await owner.postMultipart('/admin/coupons/save', { id: '', code: 'BAD', type: 'percent', value: '150', active: '1' })).status, 400);
  assert.equal((await owner.postMultipart('/admin/coupons/save', { id: '', code: 'NEWYEAR', type: 'percent', value: '15', min_order: '500', active: '1' })).status, 303);
  assert.equal(app.q.get("SELECT min_order m FROM coupons WHERE code='NEWYEAR'").m, 50000);
});

test('flash sale: sale price only applies inside its window and is decided by the server', async () => {
  const p = app.q.get("SELECT * FROM products WHERE name LIKE 'Glow Steel%'");
  const s = (ms) => new Date(Date.now() + ms).toISOString();
  app.q.run('UPDATE products SET sale_price=10000, sale_start=?, sale_end=? WHERE id=?', s(-1000), s(60000), p.id);
  let page = (await app.client().get('/p/' + p.slug)).text; assert.match(page, /₹100/); 
  app.q.run('UPDATE products SET sale_end=? WHERE id=?', s(-500), p.id);
  page = (await app.client().get('/p/' + p.slug)).text; assert.match(page, /₹799/); assert.ok(!page.includes('% off'));
  const c = app.client(); await c.post('/cart/add', { product_id: p.id, qty: '1' }); assert.match((await c.get('/cart')).text, /₹799/, 'expired sale not honoured in cart');
  await owner.post('/admin/promotions/apply', { category_id: '', pct: '20', start: '2020-01-01T00:00', end: '2099-01-01T00:00', show_deals: '1' });
  const q2 = app.q.get('SELECT price,sale_price FROM products WHERE id=?', p.id); assert.equal(q2.sale_price, Math.round(q2.price * 0.8));
});

test('SEO: robots, sitemap, 404 page, indexing switch, homepage structured data', async () => {
  const c = app.client();
  assert.match((await c.get('/robots.txt')).text, /Disallow: \//, 'indexing off by default');
  await owner.postMultipart('/admin/settings', { allow_indexing: '1', store_name: 'The ElectroMart', cod_enabled: '1', tax_percent: '18', delivery_days: '5', return_window_days: '7', shipping_fee: '99', free_ship_threshold: '999', serviceable_pins: '78*, 11*, 40*, 56*, 70*, 60*', low_stock_threshold: '5', hero_autoplay_secs: '6', cod_max_order: '50000' });
  const robots = (await c.get('/robots.txt')).text; assert.match(robots, /Disallow: \/admin/); assert.match(robots, /Sitemap: /);
  const sm = (await c.get('/sitemap.xml')).text; assert.match(sm, /<urlset/); assert.match(sm, /\/p\/aria-wireless/); assert.ok(!sm.includes('/admin'));
  const home = (await c.get('/')).text; assert.match(home, /name="robots" content="index,follow"/); assert.match(home, /"@type":"WebSite"/); assert.match(home, /"@type":"Organization"/);
  const nf = await c.get('/does-not-exist'); assert.equal(nf.status, 404); assert.match(nf.text, /Page not found/);
  const cart = (await c.get('/cart')).text; assert.match(cart, /noindex/);
  const titles = new Set(); for (const u of ['/', '/deals', '/c/electronics', '/page/about']) titles.add(/<title>(.*?)<\/title>/.exec((await c.get(u)).text)[1]); assert.equal(titles.size, 4, 'unique titles');
});

test('pages & policies: draft is private until published; scripts are stripped', async () => {
  const c = app.client();
  await owner.post('/admin/pages/about', { title: 'About Us', body: '<p>DRAFT-TEXT</p><script>x()</script><img src=x onerror=alert(1)>', act: 'draft' });
  assert.ok(!(await c.get('/page/about')).text.includes('DRAFT-TEXT'));
  assert.match((await owner.get('/admin/pages/about/preview')).text, /DRAFT-TEXT/);
  await owner.post('/admin/pages/about', { title: 'About Us', body: '<p>LIVE-TEXT</p><script>x()</script><img src=x onerror=alert(1)>', act: 'publish' });
  const t = (await c.get('/page/about')).text; assert.match(t, /LIVE-TEXT/); assert.ok(!/<script>x\(\)/.test(t)); assert.ok(!/onerror/.test(t));
});

test('CSV: export and import products; bulk update', async () => {
  const exp = await owner.get('/admin/products/export.csv'); assert.match(exp.text, /^sku,name,category_slug/);
  const csv = 'sku,name,category_slug,brand,price,sale_price,stock,status\nCSV-1,CSV Widget,electronics,Csvco,499,399,7,published\nCSV-BAD,,electronics,X,abc,,1,draft\n';
  await owner.postMultipart('/admin/products/import', { csv: Object.assign(new Blob([csv], { type: 'text/csv' }), { name: 'p.csv' }) });
  const p = app.q.get("SELECT * FROM products WHERE sku='CSV-1'"); assert.equal(p.price, 49900); assert.equal(p.sale_price, 39900); assert.equal(p.status, 'published');
  assert.equal(app.q.get("SELECT COUNT(*) n FROM products WHERE sku='CSV-BAD'").n, 0);
  await owner.post('/admin/products/bulk', { ids: String(p.id), action: 'set_stock', value: '42' }); assert.equal(app.q.get('SELECT stock FROM products WHERE id=?', p.id).stock, 42);
  await owner.post('/admin/products/bulk', { ids: String(p.id), action: 'draft' }); assert.equal(app.q.get('SELECT status FROM products WHERE id=?', p.id).status, 'draft');
});

test('responsive markup sanity (static checks only; real device rendering was NOT tested)', async () => {
  const home = (await app.client().get('/')).text;
  assert.match(home, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(home, /fetchpriority="high"/, 'hero image prioritised'); assert.match(home, /loading="lazy"/);
  const css = (await app.client().get('/css/style.css')).text; assert.match(css, /@media \(max-width:860px\)/); assert.match(css, /@media \(max-width:520px\)/);
});

test('banners can be placed in many zones with their own width, height and shape', async () => {
  const c = app.client();
  const sec = app.q.get("SELECT id FROM home_sections WHERE title='Trending Products'");
  const mk = (o) => owner.postMultipart('/admin/banners/save', { id: '', eyebrow: '', subtitle: 'sub', btn_text: 'Go', btn_url: '/deals', position: '0', active: '1', theme: 'dark', fit: 'cover', text_align: 'left', ...o });
  assert.equal((await mk({ zone: 'home_row', after_section_id: sec.id, title: 'Row Banner A', width: '1-2', height_px: '150', shape: 'pill' })).status, 303);
  assert.equal((await mk({ zone: 'home_row', after_section_id: sec.id, title: 'Row Banner B', width: '1-2', height_px: '150', shape: 'square' })).status, 303);
  const home = (await c.get('/')).text;
  assert.match(home, /class="bn w-1-2 shape-pill align-left[^"]*" style="--h:150px"/); assert.match(home, /shape-square/);
  const iTrend = home.indexOf('<h2>Trending Products</h2>'), iA = home.indexOf('Row Banner A'), iNext = home.indexOf('<h2>Best Sellers</h2>');
  assert.ok(iTrend < iA && iA < iNext, 'row appears right after the chosen section');
  const elec = app.q.get("SELECT id FROM categories WHERE slug='electronics'").id;
  await mk({ zone: 'category', category_id: elec, title: 'Electronics Only Banner', width: 'full', height_px: '120', shape: 'rounded' });
  assert.match((await c.get('/c/electronics')).text, /Electronics Only Banner/); assert.ok(!(await c.get('/c/fashion')).text.includes('Electronics Only Banner'));
  await mk({ zone: 'category', title: 'All Category Banner', width: '1-3', height_px: '100', shape: 'rounded' });
  assert.match((await c.get('/c/fashion')).text, /All Category Banner/); assert.match((await c.get('/deals')).text, /All Category Banner/);
  await mk({ zone: 'product', title: 'Product Page Banner', width: 'full', height_px: '90', shape: 'rounded' });
  const slug = app.q.get("SELECT slug FROM products WHERE status='published' LIMIT 1").slug; assert.match((await c.get('/p/' + slug)).text, /Product Page Banner/);
  await mk({ zone: 'cart', title: 'Cart Page Banner', width: 'full', height_px: '90', shape: 'rounded' }); assert.match((await c.get('/cart')).text, /Cart Page Banner/);
  assert.ok(!(await c.get('/cart')).text.includes('Product Page Banner'), 'banners stay in their own zone');
  assert.equal((await mk({ zone: 'cart', title: 'Too tall', width: 'full', height_px: '5000', shape: 'rounded' })).status, 400, 'height limited to 60-600');
  assert.equal((await mk({ zone: 'cart', title: 'Bad width', width: 'huge', height_px: '100', shape: 'rounded' })).status, 400, 'only allowed widths');
});

test('product box design is controlled from settings and per section', async () => {
  const c = app.client();
  const post = (o) => owner.postMultipart('/admin/settings', { cod_enabled: '1', tax_percent: '18', delivery_days: '5', return_window_days: '7', shipping_fee: '99', free_ship_threshold: '999', serviceable_pins: '78*', low_stock_threshold: '5', hero_autoplay_secs: '6', cod_max_order: '50000', ...o });
  assert.equal((await post({ card_min_width: '260', card_image_ratio: 'portrait', card_image_fit: 'cover', card_radius: '0', card_shadow: 'strong', card_btn_style: 'outline', card_cols_mobile: '1', card_show_rating: '1', card_show_badge: '', card_show_wishlist: '', card_show_brand_line: '' })).status, 303);
  const home = (await c.get('/')).text;
  assert.match(home, /--card-min:260px;--card-radius:0px;--card-ratio:3\/4;--card-fit:cover;/); assert.match(home, /--cols-m:1/);
  assert.match(home, /btn-outline-orange/); assert.ok(!/class="badge"/.test(home), 'badge hidden'); assert.ok(!/class="wish"/.test(home), 'wishlist heart hidden');
  await owner.postMultipart('/admin/settings', { card_min_width: '50' });
  assert.notEqual(app.q.get("SELECT value v FROM settings WHERE key='card_min_width'").v, '50', 'out-of-range width rejected');
  assert.ok(!(await c.get('/')).text.includes('--card-min:50px'));
  const sec = app.q.get("SELECT * FROM home_sections WHERE title='Best Sellers'");
  await owner.postMultipart('/admin/sections/save', { id: sec.id, title: sec.title, type: sec.type, category_id: '', item_limit: '6', card_size: 'large', position: String(sec.position), active: '1' });
  assert.match((await c.get('/')).text, /class="grid" style="--card-min:250px"/);
  await post({ card_min_width: '190', card_image_ratio: 'square', card_image_fit: 'contain', card_radius: '10', card_shadow: 'soft', card_btn_style: 'filled', card_cols_mobile: '2', card_show_badge: '1', card_show_wishlist: '1', card_show_brand_line: '1' });
  assert.match((await c.get('/')).text, /class="badge"/);
  assert.equal((await owner.get('/admin/banners/new')).status, 200); assert.match((await owner.get('/admin/banners/new')).text, /a row between sections/);
});

test('uploaded logo is shown at a controlled size in header and footer (not at its original size)', async () => {
  const png = Object.assign(new Blob([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(40)], { type: 'image/png' }), { name: 'logo.png' });
  await owner.postMultipart('/admin/settings', { store_name: 'The ElectroMart', shipping_fee: '99', free_ship_threshold: '999', cod_max_order: '50000', logo_path: png });
  const home = (await app.client().get('/')).text;
  assert.equal((home.match(/class="logo-img"/g) || []).length, 2, 'header and footer');
  const css = (await app.client().get('/css/style.css')).text; assert.match(css, /\.logo-img\{height:44px;width:auto;max-width:210px/);
  assert.match(home, /style\.css\?v=\d{5,}/, 'cache-busting version follows the file, so CSS fixes always reach the browser');
});

test('homepage layout: first product row sits under the banner, inside the three-column area (no empty gap)', async () => {
  const home = (await app.client().get('/')).text;
  const iDeals = home.indexOf('<div class="home-deals">'), iTitle = home.indexOf('<h2>Best Deals For You</h2>'), iSide = home.indexOf('<div class="home-side">');
  assert.ok(iDeals > 0 && iDeals < iTitle && iTitle < iSide, 'first section is in the grid beside the side column');
  assert.match((await app.client().get('/css/style.css')).text, /grid-template-areas:"rail hero side" "deals deals side"/);
});
