import { get, post } from '../router.js';
import { q, now } from '../db.js';
import { S, pinInfo, num } from '../settings.js';
import { html, raw, inr, esc, fmtDate, isEmail, isPin, toPaise, sanitizeHtml, UserError, parseCookies, cookie, clampInt, pageParam, label } from '../util.js';
import { layout, productCard, imgTag, stars, pager, icon, csrfField } from '../views.js';
import { listProducts, getProductBySlug, categoryTree, categoryIds, breadcrumbs, brandsFor, suggest, cartAdd, cartSet, cartRemove, cartLines, calcTotals, cartMerge, priceOf, discountPct, getProductsByIds } from '../shop.js';
import { config } from '../config.js';
import { rateLimit } from '../auth.js';
import { codAllowed } from '../shop.js';

const ACTIVE = `active=1 AND (starts_at IS NULL OR starts_at<=@n) AND (ends_at IS NULL OR ends_at>=@n)`;
export const activeBanners = (slot, preview = false) =>
  preview ? q.all('SELECT * FROM banners WHERE slot=? ORDER BY position,id', slot)
    : q.all(`SELECT * FROM banners WHERE slot=? AND ${ACTIVE.replace(/@n/g, '?')} ORDER BY position,id`, slot, now(), now());

const wishSet = (ctx) => new Set(ctx.user ? q.all('SELECT product_id FROM wishlist WHERE user_id=?', ctx.user.id).map((r) => r.product_id) : []);
const lines2 = (txt) => String(txt || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.split('|').map((x) => x.trim()));

const BW = ['full', '2-3', '1-2', '1-3', '1-4'], SH = ['rounded', 'square', 'pill'], AL = ['left', 'center', 'right'];
/** Banners for one placement (zone). Scheduling/enable flags are applied here; preview shows everything. */
export function bannersForZone(zone, { afterSectionId = 0, categoryId = null, preview = false } = {}) {
  const w = ['zone=?']; const p = [zone];
  if (!preview) { w.push('active=1', '(starts_at IS NULL OR starts_at<=?)', '(ends_at IS NULL OR ends_at>=?)'); p.push(now(), now()); }
  if (zone === 'home_row') { w.push('after_section_id=?'); p.push(afterSectionId); }
  if (zone === 'category') { w.push('(category_id IS NULL OR category_id=?)'); p.push(categoryId || 0); }
  return q.all(`SELECT * FROM banners WHERE ${w.join(' AND ')} ORDER BY position,id`, ...p);
}
function promoBanner(b) {
  const h = Math.min(600, Math.max(60, b.height_px || 220));
  const cls = `bn w-${BW.includes(b.width) ? b.width : 'full'} shape-${SH.includes(b.shape) ? b.shape : 'rounded'} align-${AL.includes(b.text_align) ? b.text_align : 'left'} ${b.theme === 'light' ? 'light' : ''} ${b.fit === 'contain' ? 'fit-contain' : ''}`;
  const inner = html`${b.desktop_img ? html`<picture>${b.mobile_img ? html`<source media="(max-width:700px)" srcset="${b.mobile_img}">` : ''}<img class="bn-img" src="${b.desktop_img}" alt="${b.img_alt || ''}" loading="lazy" decoding="async"></picture>` : ''}
    <div class="bn-text">${b.eyebrow ? html`<p class="eyebrow">${b.eyebrow}</p>` : ''}<h3>${b.title}</h3>${b.subtitle ? html`<p>${b.subtitle}</p>` : ''}
    ${b.show_countdown && b.ends_at ? html`<p class="countdown" data-end="${b.ends_at}">Offer ends in <b>--</b></p>` : ''}${b.btn_text ? html`<span class="btn btn-sm btn-yellow">${b.btn_text} &rarr;</span>` : ''}</div>`;
  return b.btn_url ? html`<a class="${cls}" style="--h:${h}px" href="${b.btn_url}">${inner}</a>` : html`<div class="${cls}" style="--h:${h}px">${inner}</div>`;
}
export function bannerRow(zone, opts = {}) {
  const list = bannersForZone(zone, opts);
  if (!list.length) return '';
  const row = html`<div class="brow">${list.map(promoBanner)}</div>`;
  return opts.wrap ? html`<div class="wrap brow-wrap">${row}</div>` : row;
}

function heroSlide(b, first) {
  const img = b.desktop_img ? html`<picture>${b.mobile_img ? html`<source media="(max-width:700px)" srcset="${b.mobile_img}">` : ''}<img src="${b.desktop_img}" alt="${b.img_alt || ''}" width="1200" height="420" ${first ? raw('fetchpriority="high"') : raw('loading="lazy"')}></picture>` : '';
  return html`<div class="slide ${b.theme === 'light' ? 'light' : ''}" ${first ? '' : raw('hidden')}>${img}<div class="slide-text">
    ${b.eyebrow ? html`<p class="eyebrow">${b.eyebrow}</p>` : ''}<h2>${b.title}</h2>${b.subtitle ? html`<p>${b.subtitle}</p>` : ''}
    ${b.show_countdown && b.ends_at ? html`<p class="countdown" data-end="${b.ends_at}" aria-live="off">Offer ends in <b>--</b></p>` : ''}
    ${b.btn_text ? html`<a class="btn btn-yellow" href="${b.btn_url || '/'}">${b.btn_text} &rarr;</a>` : ''}</div></div>`;
}

export function renderHome(ctx, { preview = false } = {}) {
  ctx.wishIds = wishSet(ctx);
  const s = S();
  const hero = activeBanners('hero', preview), side = activeBanners('side', preview);
  const tops = categoryTree();
  const sections = q.all(`SELECT * FROM home_sections ${preview ? '' : 'WHERE active=1'} ORDER BY position,id`);
  const CARD_PX = { small: 150, medium: 190, large: 250 };
  const secHtml = sections.map((sec, idx) => {
    let r;
    const o = { per: sec.item_limit };
    if (sec.type === 'deals') r = listProducts({ ...o, onlyDeals: true, sort: 'discount' });
    else if (sec.type === 'trending') r = listProducts({ ...o, flagName: 'trending' });
    else if (sec.type === 'bestsellers') r = listProducts({ ...o, sort: 'popular', flagName: 'bestseller' });
    else if (sec.type === 'new') r = listProducts({ ...o, sort: 'newest' });
    else if (sec.type === 'featured') r = listProducts({ ...o, flagName: 'featured' });
    else if (sec.type === 'category' && sec.category_id) r = listProducts({ ...o, cat: sec.category_id, sort: 'popular' });
    else r = listProducts({ ...o, sort: 'rating' }); // recommended: best-rated first, then most popular
    const rowAfter = bannerRow('home_row', { afterSectionId: sec.id, preview, wrap: idx !== 0 });
    if (!r.items.length) return rowAfter;
    const cat = sec.category_id ? q.get('SELECT slug FROM categories WHERE id=?', sec.category_id) : null;
    const more = cat ? `/c/${cat.slug}` : { deals: '/deals', bestsellers: '/best-sellers', new: '/new-arrivals' }[sec.type] || '/search?q=';
    return html`<section class="${idx === 0 ? 'section' : 'section wrap'}"><div class="section-h"><h2>${sec.title}</h2><a href="${more}">View All &rarr;</a></div><div class="grid" ${CARD_PX[sec.card_size] ? raw(`style="--card-min:${CARD_PX[sec.card_size]}px"`) : ''}>${r.items.map((p) => productCard(p, ctx))}</div></section>${rowAfter}`;
  });
  const trust = lines2(s.trust_lines), why = lines2(s.why_lines);
  const revs = q.all(`SELECT r.*, u.name uname, p.name pname, p.slug FROM reviews r JOIN users u ON u.id=r.user_id JOIN products p ON p.id=r.product_id WHERE r.status='published' AND r.rating>=4 ORDER BY r.id DESC LIMIT 3`);
  const sideCls = { warm: 'warm', cool: 'cool', green: 'green' };
  return html`${preview ? html`<p class="flash ok wrap">Preview mode: showing draft/inactive banners and sections. <a href="/admin">Back to dashboard</a></p>` : ''}
  <div class="wrap home-top">
    <aside class="catrail" aria-label="Categories"><h2 class="catrail-h">All Categories</h2><ul>${tops.map((c) => html`<li><a href="/c/${c.slug}">${c.name}</a></li>`)}</ul></aside>
    <div class="home-main">
      ${hero.length ? html`<div class="hero" data-hero data-autoplay="${num('hero_autoplay_secs') || 6}" role="region" aria-roledescription="carousel" aria-label="Promotions">${hero.map((b, i) => heroSlide(b, i === 0))}
        ${hero.length > 1 ? html`<div class="hero-ctl"><button data-prev aria-label="Previous slide">&lsaquo;</button><span class="dots">${hero.map((_, i) => html`<button data-dot="${i}" aria-label="Slide ${i + 1}" class="${i === 0 ? 'on' : ''}"></button>`)}</span><button data-next aria-label="Next slide">&rsaquo;</button></div>` : ''}</div>`
        : html`<div class="hero hero-empty"><p>No active banner. Add one in Admin &gt; Banners.</p></div>`}
      <ul class="trust">${trust.map(([t, sub]) => html`<li><b>${t}</b><span>${sub}</span></li>`)}</ul>
    </div>
    <div class="home-deals">${secHtml[0] || ''}</div>
    <div class="home-side">
      ${side.map((b) => html`<a class="sidebn ${sideCls[b.theme] || ''}" href="${b.btn_url || '/'}">${b.desktop_img ? imgTag(b.desktop_img, b.img_alt, { w: 120, h: 90 }) : ''}<h3>${b.title}</h3><p>${b.subtitle}</p>${b.btn_text ? html`<span class="btn btn-sm btn-orange">${b.btn_text} &rarr;</span>` : ''}</a>`)}
      <section class="why"><h2>Why Choose Us?</h2><ul>${why.map(([t, sub]) => html`<li><b>${t}</b><span>${sub}</span></li>`)}</ul></section>
      <section class="newsletter"><h2>Get Exclusive Offers</h2><p>Subscribe to our newsletter and get the latest deals, offers &amp; updates.</p>
        <form method="post" action="/newsletter" class="nl">${csrfField(ctx)}<label class="sr" for="nl-email">Email address</label><input id="nl-email" type="email" name="email" placeholder="Enter your email address" required autocomplete="email"><button class="btn btn-yellow">Subscribe</button></form></section>
    </div>
  </div>
  ${bannerRow('home_row', { afterSectionId: 0, preview, wrap: true })}
  ${secHtml.slice(1)}
  <section class="section wrap" id="reviews"><div class="section-h"><h2>Customer Reviews</h2></div>
    ${revs.length ? html`<div class="revgrid">${revs.map((r) => html`<blockquote class="card rev"><p>${stars(r.rating, 1)}</p><p><b>${r.title}</b></p><p>${r.body}</p><footer class="muted small">${(r.uname || 'Customer').split(' ')[0]} on <a href="/p/${r.slug}">${r.pname}</a></footer></blockquote>`)}</div>`
      : html`<p class="muted">Reviews from verified buyers appear here. Purchased something? Rate it from your order page.</p>`}</section>`;
}

get('/', (ctx) => {
  const jsonld = [
    { '@context': 'https://schema.org', '@type': 'Organization', name: S().store_name, url: config.baseUrl, ...(S().logo_path ? { logo: config.baseUrl + S().logo_path } : {}), ...(S().contact_email ? { email: S().contact_email } : {}) },
    { '@context': 'https://schema.org', '@type': 'WebSite', name: S().store_name, url: config.baseUrl, potentialAction: { '@type': 'SearchAction', target: `${config.baseUrl}/search?q={search_term_string}`, 'query-input': 'required name=search_term_string' } },
  ];
  ctx.page(200, { title: '', canonical: '/', jsonld, body: renderHome(ctx), main: true });
});

/* ---------------- listing ---------------- */
function listing(ctx, { title, h1, desc, path, cat, search = '', preset = {}, crumbs = [], noindexAlways = false }) {
  ctx.wishIds = wishSet(ctx);
  const Q = ctx.query;
  const sort = ['popular', 'price_asc', 'price_desc', 'newest', 'rating', 'discount'].includes(Q.get('sort')) ? Q.get('sort') : (preset.sort || 'popular');
  const brand = Q.getAll('brand').filter((b) => /^[\w-]+$/.test(b));
  const min = Math.max(0, toPaise(Q.get('min') || 0) || 0), max = Math.max(0, toPaise(Q.get('max') || 0) || 0);
  const rating = clampInt(Q.get('rating'), 0, 5, 0), instock = Q.get('instock') === '1';
  const page = pageParam(Q.get('page')), per = 12;
  const r = listProducts({ search, cat, brand, min, max, rating, instock, sort, page, per, onlyDeals: preset.onlyDeals, flagName: preset.flagName });
  const filtered = [...Q.keys()].some((k) => !['page', 'q'].includes(k)) || (search && path === '/search');
  const brands = brandsFor(cat);
  const sel = (v, cur) => (v === cur ? raw('selected') : '');
  const body = html`<div class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li>${crumbs.map((c) => html`<li>${c.href ? html`<a href="${c.href}">${c.name}</a>` : c.name}</li>`)}</ol></nav>
    ${bannerRow('category', { categoryId: cat })}
    <div class="list-head"><h1>${h1}</h1><span class="muted">${r.total} product${r.total === 1 ? '' : 's'}</span></div>
    <div class="list-layout">
      <form class="filters card" method="get" action="${path}"><details open><summary><h2>Filters</h2></summary>
        ${search ? html`<input type="hidden" name="q" value="${search}">` : ''}
        <label>Sort by <select name="sort"><option value="popular" ${sel('popular', sort)}>Popularity</option><option value="price_asc" ${sel('price_asc', sort)}>Price: low to high</option><option value="price_desc" ${sel('price_desc', sort)}>Price: high to low</option><option value="newest" ${sel('newest', sort)}>Newest</option><option value="rating" ${sel('rating', sort)}>Customer rating</option><option value="discount" ${sel('discount', sort)}>Discount</option></select></label>
        ${brands.length ? html`<fieldset><legend>Brand</legend>${brands.map((b) => html`<label class="chk"><input type="checkbox" name="brand" value="${b.slug}" ${brand.includes(b.slug) ? raw('checked') : ''}> ${b.name} <span class="muted small">(${b.n})</span></label>`)}</fieldset>` : ''}
        <fieldset><legend>Price (₹)</legend><div class="row2"><input type="number" name="min" min="0" placeholder="Min" value="${Q.get('min') || ''}" aria-label="Minimum price"><input type="number" name="max" min="0" placeholder="Max" value="${Q.get('max') || ''}" aria-label="Maximum price"></div></fieldset>
        <label>Customer rating <select name="rating"><option value="0">Any</option>${[4, 3, 2].map((n) => html`<option value="${n}" ${rating === n ? raw('selected') : ''}>${n}&#9733; &amp; up</option>`)}</select></label>
        <label class="chk"><input type="checkbox" name="instock" value="1" ${instock ? raw('checked') : ''}> In stock only</label>
        <button class="btn btn-orange btn-block">Apply</button> ${filtered ? html`<a class="btn btn-block" href="${path}${search ? '?q=' + encodeURIComponent(search) : ''}">Clear</a>` : ''}</details></form>
      <div>${r.items.length ? html`<div class="grid grid-list">${r.items.map((p) => productCard(p, ctx))}</div>${pager(ctx, page, r.total, per)}`
        : html`<div class="empty card"><h2>No products found</h2><p>Try different keywords or remove some filters.</p><a class="btn btn-orange" href="/">Continue shopping</a></div>`}</div></div></div>`;
  const canonical = path + (page > 1 ? `?${search && path === '/search' ? 'q=' + encodeURIComponent(search) + '&' : ''}page=${page}` : '');
  const itemList = r.items.length ? [{ '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: r.items.map((p, i) => ({ '@type': 'ListItem', position: (page - 1) * per + i + 1, url: `${config.baseUrl}/p/${p.slug}` })) }] : [];
  ctx.page(200, { title: page > 1 ? `${title} - Page ${page}` : title, desc, canonical, noindex: noindexAlways || filtered, jsonld: itemList, body });
}

get('/c/:slug', (ctx) => {
  const c = q.get('SELECT * FROM categories WHERE slug=? AND published=1', ctx.params.slug);
  if (!c) return ctx.notFound();
  const trail = breadcrumbs(c.id);
  listing(ctx, { title: c.name, h1: c.name, desc: c.description || `Shop ${c.name} online at ${S().store_name}.`, path: `/c/${c.slug}`, cat: c.id, crumbs: trail.map((t, i) => ({ name: t.name, href: i < trail.length - 1 ? `/c/${t.slug}` : null })) });
});
get('/search', (ctx) => {
  const term = (ctx.query.get('q') || '').trim().slice(0, 80);
  listing(ctx, { title: term ? `Search: ${term}` : 'Search', h1: term ? `Results for "${term}"` : 'All products', path: '/search', search: term, crumbs: [{ name: 'Search' }], noindexAlways: true });
});
get('/deals', (ctx) => listing(ctx, { title: 'Best Deals', h1: 'Best Deals', desc: 'Discounted products with limited-time prices.', path: '/deals', preset: { onlyDeals: true, sort: 'discount' }, crumbs: [{ name: 'Deals' }] }));
get('/best-sellers', (ctx) => listing(ctx, { title: 'Best Sellers', h1: 'Best Sellers', path: '/best-sellers', preset: { flagName: 'bestseller' }, crumbs: [{ name: 'Best Sellers' }] }));
get('/new-arrivals', (ctx) => listing(ctx, { title: 'New Arrivals', h1: 'New Arrivals', path: '/new-arrivals', preset: { sort: 'newest' }, crumbs: [{ name: 'New Arrivals' }] }));

get('/api/suggest', (ctx) => {
  if (!rateLimit('suggest:' + ctx.ip, 120, 60e3)) return ctx.json({ products: [], categories: [] }, 429);
  const t = (ctx.query.get('q') || '').trim();
  ctx.json(t.length < 2 ? { products: [], categories: [] } : suggest(t));
});
get('/api/pin', (ctx) => {
  const pin = ctx.query.get('pin') || '';
  if (!isPin(pin)) return ctx.json({ ok: false, msg: 'Enter a valid 6-digit PIN code.' });
  const i = pinInfo(pin);
  ctx.json(i.ok ? { ok: true, msg: `Delivery available. Estimated delivery in ${i.days}-${i.days + 2} days.` } : { ok: false, msg: 'Sorry, we do not deliver to this PIN code yet.' });
});

/* ---------------- product page ---------------- */
get('/p/:slug', (ctx) => {
  const p = getProductBySlug(ctx.params.slug);
  if (!p) return ctx.notFound();
  ctx.wishIds = wishSet(ctx);
  const rv = (ctx.cookies.rv || '').split('.').map(Number).filter(Boolean);
  const nrv = [p.id, ...rv.filter((x) => x !== p.id)].slice(0, 8);
  ctx.setCookies.push(cookie('rv', nrv.join('.'), { maxAge: 86400 * 30 }));
  const related = listProducts({ cat: p.category_id, exclude: p.id, per: 6, sort: 'popular' }).items;
  const recent = getProductsByIds(rv.filter((x) => x !== p.id).slice(0, 6));
  const reviews = q.all("SELECT r.*, u.name uname FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.product_id=? AND r.status='published' ORDER BY r.id DESC LIMIT 20", p.id);
  const pct = discountPct(p);
  const inStock = p.stock_total > 0;
  const hasV = p.variants.length > 0;
  const trail = breadcrumbs(p.category_id);
  const canReview = ctx.user && q.get("SELECT 1 x FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.user_id=? AND oi.product_id=? AND o.status='delivered'", ctx.user.id, p.id);
  const mine = ctx.user && q.get('SELECT * FROM reviews WHERE product_id=? AND user_id=?', p.id, ctx.user.id);
  const imgs = p.images.length ? p.images : [{ path: '/img/sample/placeholder.svg', alt: p.name }];
  const abs = (u) => (u.startsWith('http') ? u : config.baseUrl + u);
  const offer = { '@type': 'Offer', url: `${config.baseUrl}/p/${p.slug}`, priceCurrency: 'INR', price: (p.eff_price / 100).toFixed(2), availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', itemCondition: 'https://schema.org/NewCondition', ...(pct && p.sale_end ? { priceValidUntil: p.sale_end.slice(0, 10) } : {}) };
  const jsonld = [{ '@context': 'https://schema.org', '@type': 'Product', name: p.name, image: imgs.map((i) => abs(i.path)), description: (p.short_desc || p.name).slice(0, 300), sku: p.sku, ...(p.brand ? { brand: { '@type': 'Brand', name: p.brand } } : {}), offers: offer, ...(p.review_count ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: Number(p.rating.toFixed(1)), reviewCount: p.review_count } } : {}) },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ name: 'Home', url: '/' }, ...trail.map((t) => ({ name: t.name, url: `/c/${t.slug}` })), { name: p.name, url: `/p/${p.slug}` }].map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: config.baseUrl + c.url })) }];
  const body = html`<div class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li>${trail.map((t) => html`<li><a href="/c/${t.slug}">${t.name}</a></li>`)}<li aria-current="page">${p.name}</li></ol></nav>
    <div class="pdp">
      <div class="gallery"><div class="gallery-main">${imgTag(imgs[0].path, imgs[0].alt || p.name, { w: 600, h: 600, eager: true, cls: 'gal-big' })}</div>
        ${imgs.length > 1 ? html`<ul class="thumbs">${imgs.map((i, n) => html`<li><button type="button" data-gal="${i.path}" data-alt="${i.alt || p.name}" aria-label="Show image ${n + 1}">${imgTag(i.path, i.alt || '', { w: 64, h: 64 })}</button></li>`)}</ul>` : ''}</div>
      <div class="pinfo">
        <h1>${p.name}</h1>
        ${p.brand ? html`<p class="muted">Brand: <a href="/search?q=${encodeURIComponent(p.brand)}">${p.brand}</a> &middot; SKU ${p.sku}</p>` : ''}
        <div class="rating">${p.review_count ? stars(p.rating, p.review_count) : html`<span class="muted small">No reviews yet</span>`}</div>
        <p class="bigprice"><strong>${inr(p.eff_price)}</strong> ${pct ? html`<s class="muted">${inr(p.price)}</s> <span class="badge inline">${pct}% off</span>` : ''}</p>
        ${bannerRow('product')}
        <p class="muted small">Inclusive of all taxes.${hasV ? ' Price shown is for the base option; selected option price is applied in your cart.' : ''}</p>
        ${p.short_desc ? html`<p>${p.short_desc}</p>` : ''}
        <p class="${inStock ? 'ok-t' : 'err-t'}"><b>${inStock ? (p.stock_total <= 5 ? `Only ${p.stock_total} left in stock` : 'In stock') : 'Currently out of stock'}</b></p>
        ${inStock ? html`<form method="post" action="/cart/add" class="buy">${csrfField(ctx)}<input type="hidden" name="product_id" value="${p.id}">
          ${hasV ? html`<label>Choose option <select name="variant_id" required><option value="">Select</option>${p.variants.map((v) => html`<option value="${v.id}" ${v.stock <= 0 ? raw('disabled') : ''}>${v.label}${v.price != null ? ' - ' + inr(priceOf(p, v).price) : ''}${v.stock <= 0 ? ' (out of stock)' : ''}</option>`)}</select></label>` : ''}
          <label>Quantity <input type="number" name="qty" value="1" min="1" max="${Math.min(20, p.stock_total)}" class="qty"></label>
          <div class="btnrow"><button class="btn btn-orange" name="act" value="add">Add to Cart</button><button class="btn btn-yellow" name="act" value="buy">Buy Now</button></div></form>` : ''}
        <form method="post" action="/wishlist/toggle" class="inl">${csrfField(ctx)}<input type="hidden" name="product_id" value="${p.id}"><input type="hidden" name="back" value="/p/${p.slug}"><button class="btn btn-sm">${ctx.wishIds.has(p.id) ? 'Remove from wishlist' : 'Add to wishlist'}</button></form>
        <div class="card pincheck"><label for="pin">Check delivery</label><div class="row2"><input id="pin" inputmode="numeric" maxlength="6" placeholder="Enter PIN code" data-pin><button type="button" class="btn btn-sm" data-pin-btn>Check</button></div><p class="small" data-pin-msg role="status"></p></div>
        <ul class="facts">${p.warranty ? html`<li><b>Warranty:</b> ${p.warranty}</li>` : ''}${p.shipping_note ? html`<li><b>Shipping:</b> ${p.shipping_note}</li>` : ''}<li><b>Returns:</b> ${num('return_window_days')}-day return window after delivery (see <a href="/page/returns">policy</a>)</li></ul>
      </div></div>
    ${p.description ? html`<section class="card pad"><h2>About this item</h2><div class="prose">${raw(sanitizeHtml(p.description))}</div></section>` : ''}
    ${p.specList.length ? html`<section class="card pad"><h2>Specifications</h2><table class="specs"><tbody>${p.specList.map((s) => html`<tr><th scope="row">${s.k}</th><td>${s.v}</td></tr>`)}</tbody></table></section>` : ''}
    <section class="card pad" id="reviews"><h2>Customer reviews</h2>
      ${reviews.length ? reviews.map((r) => html`<article class="review"><p>${stars(r.rating, 1)} <b>${r.title}</b></p><p>${r.body}</p><p class="muted small">${(r.uname || 'Customer').split(' ')[0]} &middot; ${fmtDate(r.created_at, false)} &middot; Verified purchase</p></article>`) : html`<p class="muted">No reviews yet.</p>`}
      ${canReview && !mine ? html`<form method="post" action="/p/${p.slug}/review" class="stack">${csrfField(ctx)}<h3>Write a review</h3><label>Rating <select name="rating" required><option value="">Select</option>${[5, 4, 3, 2, 1].map((n) => html`<option>${n}</option>`)}</select></label><label>Title <input name="title" maxlength="80" required></label><label>Review <textarea name="body" rows="3" maxlength="1000" required></textarea></label><button class="btn btn-orange">Submit review</button></form>` : ''}
      ${mine ? html`<p class="muted small">You have already reviewed this product.</p>` : ''}</section>
    ${related.length ? html`<section class="section"><div class="section-h"><h2>Related products</h2></div><div class="grid">${related.map((x) => productCard(x, ctx))}</div></section>` : ''}
    ${recent.length ? html`<section class="section"><div class="section-h"><h2>Recently viewed</h2></div><div class="grid">${recent.map((x) => productCard(x, ctx))}</div></section>` : ''}</div>`;
  ctx.page(200, { title: p.seo_title || p.name, desc: p.seo_desc || (p.short_desc ? `${p.short_desc}. Buy ${p.name} online at ${inr(p.eff_price)}.` : `Buy ${p.name} online at ${inr(p.eff_price)}.`), canonical: `/p/${p.slug}`, og: { type: 'product', image: imgs[0].path }, jsonld, body });
});

post('/p/:slug/review', (ctx) => {
  if (!ctx.user) return ctx.redirect('/login?next=' + encodeURIComponent('/p/' + ctx.params.slug));
  const p = q.get('SELECT id FROM products WHERE slug=?', ctx.params.slug);
  if (!p) return ctx.notFound();
  if (!q.get("SELECT 1 x FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.user_id=? AND oi.product_id=? AND o.status='delivered'", ctx.user.id, p.id)) throw new UserError('Only customers with a delivered order can review this product.', 403);
  const rating = clampInt(ctx.body.rating, 1, 5, 0);
  if (!rating) throw new UserError('Please choose a rating.');
  const ins = q.run("INSERT OR IGNORE INTO reviews(product_id,user_id,rating,title,body,created_at) VALUES(?,?,?,?,?,?)", p.id, ctx.user.id, rating, String(ctx.body.title || '').slice(0, 80), String(ctx.body.body || '').slice(0, 1000), now());
  ctx.flash(ins.changes ? 'ok' : 'err', ins.changes ? 'Thanks for your review!' : 'You have already reviewed this product.');
  ctx.redirect(`/p/${ctx.params.slug}#reviews`);
});

/* ---------------- cart & wishlist ---------------- */
const safeBack = (b, d = '/cart') => (typeof b === 'string' && b.startsWith('/') && !b.startsWith('//') ? b : d);
post('/cart/add', (ctx) => {
  ctx.ensureGuest();
  try { cartAdd(ctx.ownerKey, clampInt(ctx.body.product_id, 1, 1e9), clampInt(ctx.body.variant_id, 0, 1e9, 0), clampInt(ctx.body.qty, 1, 20, 1)); }
  catch (e) { if (!e.user) throw e; ctx.flash('err', e.message); return ctx.redirect(safeBack(ctx.body.back, '/cart')); }
  if (ctx.body.act === 'buy') return ctx.redirect('/checkout');
  ctx.flash('ok', 'Added to your cart.');
  ctx.redirect(safeBack(ctx.body.back, '/cart'));
});
post('/cart/update', (ctx) => {
  try { cartSet(ctx.ownerKey, clampInt(ctx.body.item_id, 1, 1e12), clampInt(ctx.body.qty, 0, 20, 1)); } catch (e) { if (!e.user) throw e; ctx.flash('err', e.message); }
  ctx.redirect('/cart');
});
post('/cart/remove', (ctx) => { cartRemove(ctx.ownerKey, clampInt(ctx.body.item_id, 1, 1e12)); ctx.redirect('/cart'); });
post('/cart/coupon', (ctx) => {
  const code = String(ctx.body.code || '').trim().slice(0, 40);
  if (ctx.body.remove) ctx.setCookies.push(cookie('cpn', '', { maxAge: 0 }));
  else if (code) {
    const lines = cartLines(ctx.ownerKey); const t = calcTotals(lines, { couponCode: code, user: ctx.user });
    if (t.couponError) ctx.flash('err', t.couponError); else { ctx.setCookies.push(cookie('cpn', code, { maxAge: 86400 })); ctx.flash('ok', 'Coupon applied.'); }
  }
  ctx.redirect(safeBack(ctx.body.back, '/cart'));
});
get('/cart', (ctx) => {
  const lines = cartLines(ctx.ownerKey);
  const t = calcTotals(lines, { couponCode: ctx.cookies.cpn, user: ctx.user });
  const thr = num('free_ship_threshold');
  const body = html`<div class="wrap">${bannerRow('cart')}<h1>Shopping Cart</h1>
  ${!lines.length ? html`<div class="empty card"><h2>Your cart is empty</h2><p>Browse our latest deals and add something you like.</p><a class="btn btn-orange" href="/deals">Shop deals</a></div>` : html`
  <div class="cart-layout"><div class="card">
    ${lines.map((l) => html`<div class="cline">${imgTag(l.image, l.product.name, { w: 96, h: 96 })}<div class="cinfo"><a href="/p/${l.product.slug}"><b>${l.product.name}</b></a>${l.variant ? html`<p class="muted small">Option: ${l.variant.label}</p>` : ''}
      <p>${inr(l.unit)} ${l.unit < l.mrp ? html`<s class="muted small">${inr(l.mrp)}</s>` : ''}</p>${l.problem ? html`<p class="err-t small"><b>${l.problem}</b> &ndash; please update the quantity.</p>` : ''}
      <div class="btnrow"><form method="post" action="/cart/update" class="inl">${csrfField(ctx)}<input type="hidden" name="item_id" value="${l.id}"><label class="sr" for="qty${l.id}">Quantity</label><input id="qty${l.id}" class="qty" type="number" name="qty" value="${l.qty}" min="0" max="20"><button class="btn btn-sm">Update</button></form>
      <form method="post" action="/cart/remove" class="inl">${csrfField(ctx)}<input type="hidden" name="item_id" value="${l.id}"><button class="btn btn-sm btn-ghost">Remove</button></form></div></div><div class="cprice"><b>${inr(l.total)}</b></div></div>`)}</div>
  <aside class="card pad summary"><h2>Order summary</h2>
    <form method="post" action="/cart/coupon" class="coupon">${csrfField(ctx)}<label for="cc">Coupon code</label>${ctx.cookies.cpn && !t.couponError ? html`<p class="ok-t"><b>${t.coupon?.code}</b> applied <button class="linklike" name="remove" value="1">Remove</button></p>` : html`<div class="row2"><input id="cc" name="code" placeholder="Enter code" autocomplete="off"><button class="btn btn-sm">Apply</button></div>`}${t.couponError ? html`<p class="err-t small">${t.couponError}</p>` : ''}</form>
    <dl class="totals"><dt>Subtotal (${t.count} item${t.count > 1 ? 's' : ''})</dt><dd>${inr(t.subtotal)}</dd>${t.discount ? html`<dt>Discount</dt><dd class="ok-t">-${inr(t.discount)}</dd>` : ''}<dt>Shipping</dt><dd>${t.shipping ? inr(t.shipping) : 'FREE'}</dd><dt class="grand">Total</dt><dd class="grand">${inr(t.total)}</dd></dl>
    ${t.tax ? html`<p class="muted small">Includes GST of ${inr(t.tax)}.</p>` : ''}
    ${thr && t.shipping && t.subtotal - t.discount < thr ? html`<p class="small">Add <b>${inr(thr - (t.subtotal - t.discount))}</b> more for free shipping.</p>` : ''}
    ${lines.some((l) => l.problem) ? html`<button class="btn btn-block" disabled>Fix stock issues to continue</button>` : html`<a class="btn btn-orange btn-block" href="/checkout">Proceed to Checkout</a>`}</aside></div>`}</div>`;
  ctx.page(200, { title: 'Shopping Cart', noindex: true, body });
});
post('/wishlist/toggle', (ctx) => {
  if (!ctx.user) { ctx.flash('err', 'Please sign in to use your wishlist.'); return ctx.redirect('/login?next=' + encodeURIComponent(safeBack(ctx.body.back, '/'))); }
  const pid = clampInt(ctx.body.product_id, 1, 1e9);
  if (!q.get('SELECT 1 x FROM products WHERE id=?', pid)) return ctx.redirect(safeBack(ctx.body.back, '/'));
  const del = q.run('DELETE FROM wishlist WHERE user_id=? AND product_id=?', ctx.user.id, pid);
  if (!del.changes) q.run('INSERT INTO wishlist(user_id,product_id,created_at) VALUES(?,?,?)', ctx.user.id, pid, now());
  ctx.flash('ok', del.changes ? 'Removed from wishlist.' : 'Saved to your wishlist.');
  ctx.redirect(safeBack(ctx.body.back, '/'));
});

/* ---------------- content pages, contact, newsletter ---------------- */
get('/page/:slug', (ctx) => {
  const pg = q.get('SELECT * FROM pages WHERE slug=?', ctx.params.slug);
  if (!pg) return ctx.notFound();
  const preview = ctx.query.get('preview') === '1' && ctx.owner; // owner-only draft preview (admin cookie is path-scoped, so we also accept it here)
  const body = html`<div class="wrap narrow"><nav class="crumbs"><ol><li><a href="/">Home</a></li><li>${pg.title}</li></ol></nav><h1>${pg.title}</h1><div class="prose">${raw(sanitizeHtml(pg.body))}</div>
    ${pg.slug === 'contact' ? html`<form method="post" action="/contact" class="card pad stack">${csrfField(ctx)}<h2>Send us a message</h2><label>Name <input name="name" required maxlength="80" value="${ctx.user?.name || ''}"></label><label>Email <input type="email" name="email" required value="${ctx.user?.email || ''}"></label><label>Subject <input name="subject" required maxlength="120"></label><label>Message <textarea name="message" rows="5" required maxlength="2000"></textarea></label><button class="btn btn-orange">Send message</button></form>
    <p>Email: <a href="mailto:${S().contact_email}">${S().contact_email}</a> &middot; Phone: ${S().contact_phone}</p>` : ''}</div>`;
  ctx.page(200, { title: pg.seo_title || pg.title, desc: pg.seo_desc || undefined, canonical: `/page/${pg.slug}`, body });
});
post('/contact', (ctx) => {
  if (!rateLimit('contact:' + ctx.ip, 5, 3600e3)) throw new UserError('Too many messages. Please try again later.', 429);
  const { name, email, subject, message } = ctx.body;
  if (!name || !isEmail(String(email || '')) || !subject || String(message || '').length < 5) throw new UserError('Please fill in all fields with a valid email address.');
  q.run('INSERT INTO support_requests(user_id,name,email,subject,message,created_at) VALUES(?,?,?,?,?,?)', ctx.user?.id ?? null, String(name).slice(0, 80), String(email).slice(0, 200), String(subject).slice(0, 120), String(message).slice(0, 2000), now());
  ctx.flash('ok', 'Thanks! Your message has been received. We will reply by email.');
  ctx.redirect('/page/contact');
});
post('/newsletter', (ctx) => {
  if (!rateLimit('nl:' + ctx.ip, 10, 3600e3)) throw new UserError('Too many attempts. Please try later.', 429);
  const email = String(ctx.body.email || '').trim();
  if (!isEmail(email)) { ctx.flash('err', 'Please enter a valid email address.'); return ctx.redirect('/'); }
  q.run('INSERT OR IGNORE INTO newsletter(email,created_at) VALUES(?,?)', email, now());
  ctx.flash('ok', 'You are subscribed. Thank you!');
  ctx.redirect('/');
});
export { safeBack, wishSet };
