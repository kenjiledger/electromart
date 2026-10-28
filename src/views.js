import { html, raw, esc, inr, fmtDate, label } from './util.js';
import { S, flag } from './settings.js';
import { categoryTree, discountPct } from './shop.js';
import { config } from './config.js';

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
export const ASSET_V = (() => { try { return Math.floor(Math.max(fs.statSync(path.join(ROOT, 'public/css/style.css')).mtimeMs, fs.statSync(path.join(ROOT, 'public/js/app.js')).mtimeMs)); } catch { return 1; } })();
export const LOGO = raw(`<svg class="logo-mark" viewBox="0 0 40 40" aria-hidden="true"><rect x="5" y="13" width="30" height="22" rx="4" fill="#f58a07"/><path d="M12 13a8 8 0 0 1 16 0" fill="none" stroke="#ffc21a" stroke-width="3"/><path d="M21 17l-5 8h4l-1 6 6-9h-4z" fill="#0b1b33"/></svg>`);
const icon = (n) => raw({
  user: '<svg viewBox="0 0 24 24" class="ic"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
  heart: '<svg viewBox="0 0 24 24" class="ic"><path d="M12 21s-8-5-8-11a5 5 0 0 1 8-3 5 5 0 0 1 8 3c0 6-8 11-8 11z"/></svg>',
  cart: '<svg viewBox="0 0 24 24" class="ic"><path d="M3 4h3l2 12h11l2-8H7"/><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/></svg>',
  search: '<svg viewBox="0 0 24 24" class="ic"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  menu: '<svg viewBox="0 0 24 24" class="ic"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  star: '<svg viewBox="0 0 20 20" class="star"><path d="M10 1.5l2.5 5.4 5.9.7-4.3 4 1.1 5.8L10 14.5l-5.2 2.9 1.1-5.8-4.3-4 5.9-.7z"/></svg>',
}[n]);
export { icon };

export const stars = (r, n) => !n ? '' : html`<span class="stars" role="img" aria-label="${r.toFixed(1)} out of 5 stars"><span class="stars-fill" style="width:${(r / 5) * 100}%">${[1, 2, 3, 4, 5].map(() => icon('star'))}</span><span class="stars-bg">${[1, 2, 3, 4, 5].map(() => icon('star'))}</span></span> <span class="muted small">(${r.toFixed(1)}) ${n} review${n > 1 ? 's' : ''}</span>`;

export function imgTag(src, alt, { w, h, eager = false, cls = '' } = {}) {
  return html`<img src="${src || '/img/sample/placeholder.svg'}" alt="${alt || ''}" ${w ? raw(`width="${w}" height="${h}"`) : ''} ${eager ? raw('fetchpriority="high"') : raw('loading="lazy" decoding="async"')} class="${cls}">`;
}

/** Product-card design chosen by the owner. Every value is whitelisted/clamped, so it is safe to inline. */
export function themeCss() {
  const s = S(); const n = (v, a, b, d) => { const x = parseInt(v, 10); return Number.isFinite(x) ? Math.min(b, Math.max(a, x)) : d; };
  const ratio = { square: '1/1', portrait: '3/4', landscape: '4/3' }[s.card_image_ratio] || '1/1';
  const fit = s.card_image_fit === 'cover' ? 'cover' : 'contain';
  const sh = { none: 'none', soft: '0 1px 3px rgba(11,27,51,.08),0 4px 14px rgba(11,27,51,.05)', strong: '0 6px 22px rgba(11,27,51,.2)' }[s.card_shadow] || 'none';
  return `:root{--card-min:${n(s.card_min_width, 140, 340, 190)}px;--card-radius:${n(s.card_radius, 0, 30, 10)}px;--card-ratio:${ratio};--card-fit:${fit};--card-shadow:${sh};--cols-m:${s.card_cols_mobile === '1' ? 1 : 2}}`;
}
export function productCard(p, ctx) {
  const S_ = S(); const on = (k) => S_[k] !== '0';
  const pct = discountPct(p);
  const wished = ctx.wishIds?.has(p.id);
  const btnCls = S_.card_btn_style === 'outline' ? 'btn-outline-orange' : 'btn-orange';
  return html`<article class="card pcard">
    ${pct && on('card_show_badge') ? html`<span class="badge">-${pct}%</span>` : ''}
    ${on('card_show_wishlist') ? html`<form method="post" action="/wishlist/toggle" class="wish"><input type="hidden" name="_csrf" value="${ctx.csrf}"><input type="hidden" name="product_id" value="${p.id}"><input type="hidden" name="back" value="${ctx.url.pathname + ctx.url.search}">
      <button aria-label="${wished ? 'Remove from wishlist' : 'Add to wishlist'}" class="${wished ? 'on' : ''}">${icon('heart')}</button></form>` : ''}
    <a href="/p/${p.slug}" class="pimg">${imgTag(p.image, p.image_alt || p.name, { w: 260, h: 260 })}</a>
    <div class="pbody">
      <h3 class="ptitle"><a href="/p/${p.slug}">${p.name}</a></h3>
      ${on('card_show_brand_line') ? html`<p class="muted small clamp1">${p.short_desc || [p.brand, p.category_name].filter(Boolean).join(' | ')}</p>` : ''}
      <p class="price"><strong>${inr(p.eff_price)}</strong> ${pct ? html`<s class="muted small">${inr(p.price)}</s>` : ''}</p>
      ${on('card_show_rating') ? html`<div class="rating">${stars(p.rating || 0, p.review_count)}</div>` : ''}
      ${p.stock_total > 0
        ? (p.variants_n || 0) ? html`<a class="btn ${btnCls} btn-block" href="/p/${p.slug}">Choose options</a>`
        : html`<form method="post" action="/cart/add"><input type="hidden" name="_csrf" value="${ctx.csrf}"><input type="hidden" name="product_id" value="${p.id}"><input type="hidden" name="back" value="${ctx.url.pathname + ctx.url.search}"><button class="btn ${btnCls} btn-block">Add to Cart</button></form>`
        : html`<button class="btn btn-block" disabled>Out of stock</button>`}
    </div></article>`;
}

function navCats(ctx) {
  return categoryTree().map((c) => html`<li><a href="/c/${c.slug}">${c.name}</a>${c.children.length ? html`<ul class="sub">${c.children.map((s) => html`<li><a href="/c/${s.slug}">${s.name}</a></li>`)}</ul>` : ''}</li>`);
}

export function layout(ctx, { title, desc, canonical, noindex = false, og = {}, jsonld = [], body, bodyClass = '', main = true }) {
  const s = S();
  const fullTitle = title ? `${title} | ${s.store_name}` : s.seo_default_title;
  const robots = noindex || !flag('allow_indexing') ? 'noindex,nofollow' : 'index,follow';
  const canon = canonical ? config.baseUrl + canonical : '';
  const ogImg = og.image || s.og_image;
  const absImg = ogImg ? (ogImg.startsWith('http') ? ogImg : config.baseUrl + ogImg) : '';
  const announce = [s.announce_1, s.announce_2, s.announce_3, s.announce_4].filter(Boolean);
  const flash = ctx.flashMsg;
  return html`<!doctype html><html lang="en-IN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<meta name="description" content="${desc || s.seo_default_desc}">
<meta name="robots" content="${robots}">
<meta name="theme-color" content="#0b1b33">
${canon ? html`<link rel="canonical" href="${canon}">` : ''}
<link rel="icon" href="${s.favicon_path || '/img/favicon.svg'}">
<meta property="og:site_name" content="${s.store_name}"><meta property="og:type" content="${og.type || 'website'}"><meta property="og:title" content="${fullTitle}"><meta property="og:description" content="${desc || s.seo_default_desc}">
${canon ? html`<meta property="og:url" content="${canon}">` : ''}${absImg ? html`<meta property="og:image" content="${absImg}">` : ''}
<meta name="twitter:card" content="${absImg ? 'summary_large_image' : 'summary'}"><meta name="twitter:title" content="${fullTitle}"><meta name="twitter:description" content="${desc || s.seo_default_desc}">
<link rel="stylesheet" href="/css/style.css?v=${ASSET_V}">
${raw('<style>' + themeCss() + '</style>')}
${jsonld.map((j) => raw(`<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`))}
</head><body class="${bodyClass}">
<a class="skip" href="#main">Skip to content</a>
<div class="topbar"><div class="wrap topbar-in">${announce.map((a) => html`<span>${a}</span>`)}</div></div>
<header class="header"><div class="wrap header-in">
  <button class="icon-btn menu-btn" data-toggle="drawer" aria-label="Open menu" aria-controls="drawer">${icon('menu')}</button>
  <a href="/" class="brand" aria-label="${s.store_name} home">${s.logo_path ? html`<img class="logo-img" src="${s.logo_path}" alt="${s.store_name}">` : html`${LOGO}<span><small>The</small><b>ElectroMart</b></span>`}</a>
  <form class="search" action="/search" role="search" autocomplete="off"><label class="sr" for="q">Search products</label>
    <input id="q" name="q" type="search" placeholder="Search for products, brands and more..." value="${ctx.url.searchParams.get('q') || ''}" data-suggest aria-autocomplete="list" aria-controls="suggest-box">
    <button aria-label="Search">${icon('search')}</button><div id="suggest-box" class="suggest" hidden></div></form>
  <details class="acct"><summary>${icon('user')}<span class="hide-sm"><small>${ctx.user ? 'Hello, ' + (ctx.user.name || 'there').split(' ')[0] : 'Login / Sign Up'}</small><b>My Account</b></span></summary>
    <div class="menu">${ctx.user ? html`<a href="/account">Profile</a><a href="/account/orders">My Orders</a><a href="/account/wishlist">Wishlist</a><a href="/account/addresses">Addresses</a>
      <form method="post" action="/logout"><input type="hidden" name="_csrf" value="${ctx.csrf}"><button class="linklike">Sign out</button></form>`
      : html`<a href="/login">Sign in</a><a href="/register">Create account</a><a href="/track">Track an order</a>`}</div></details>
  <a href="/account/wishlist" class="hbtn" aria-label="Wishlist">${icon('heart')}<span class="hide-sm">Wishlist</span></a>
  <a href="/cart" class="hbtn cartbtn" aria-label="Cart, ${ctx.cartCount} items">${icon('cart')}<span class="count">${ctx.cartCount}</span><span class="hide-sm">Cart</span></a>
</div>
<nav class="mainnav" aria-label="Main"><div class="wrap">
  <a href="/" class="${ctx.url.pathname === '/' ? 'cur' : ''}">Home</a><a href="/deals">Deals</a><a href="/best-sellers">Best Sellers</a><a href="/new-arrivals">New Arrivals</a>
  ${s.campaign_label ? html`<a href="${s.campaign_url}">${s.campaign_label}</a>` : ''}<a href="/#reviews">Customer Reviews</a><a href="/track">Track Order</a></div></nav></header>
<div id="drawer" class="drawer" hidden><div class="drawer-in"><button class="icon-btn" data-toggle="drawer" aria-label="Close menu">&times;</button>
  <h2>Shop by category</h2><ul>${navCats(ctx)}</ul><hr><a href="/track">Track order</a><a href="/page/contact">Contact us</a></div></div>
${flash ? html`<div class="wrap"><p class="flash ${flash.t}" role="status">${flash.m}</p></div>` : ''}
${main ? html`<main id="main" tabindex="-1">${body}</main>` : body}
${footer(ctx)}
<script src="/js/app.js?v=${ASSET_V}" defer></script></body></html>`;
}

function footer(ctx) {
  const s = S();
  const socials = [['facebook', 'Facebook'], ['instagram', 'Instagram'], ['youtube', 'YouTube'], ['twitter', 'X / Twitter'], ['whatsapp', 'WhatsApp']].filter(([k]) => s['social_' + k]);
  return html`<footer class="footer"><div class="wrap fgrid">
  <div><a href="/" class="brand">${s.logo_path ? html`<img class="logo-img" src="${s.logo_path}" alt="${s.store_name}">` : html`${LOGO}<span><small>The</small><b>ElectroMart</b></span>`}</a><p>${s.tagline}</p><p class="small muted">${s.contact_address}</p></div>
  <div><h2>Quick Links</h2><ul><li><a href="/">Home</a></li><li><a href="/page/about">About Us</a></li><li><a href="/page/contact">Contact Us</a></li><li><a href="/track">Track Order</a></li><li><a href="/page/faq">FAQs</a></li></ul></div>
  <div><h2>Customer Service</h2><ul><li><a href="/page/returns">Return &amp; Refund Policy</a></li><li><a href="/page/cancellation">Cancellation Policy</a></li><li><a href="/page/shipping">Shipping Policy</a></li><li><a href="/page/warranty">Warranty</a></li><li><a href="mailto:${s.contact_email}">${s.contact_email}</a></li><li>${s.contact_phone}</li></ul></div>
  <div><h2>Follow Us</h2>${socials.length ? html`<ul class="social">${socials.map(([k, n]) => html`<li><a href="${s['social_' + k]}" rel="noopener nofollow" target="_blank">${n}</a></li>`)}</ul>` : html`<p class="small muted">Social links can be added in Admin &gt; Settings.</p>`}
  <h2>We Accept</h2><p class="pay">${[s.cod_enabled === '1' && 'Cash on Delivery', s.upi_enabled === '1' && 'UPI', ...(ctx.razorpay ? ['Cards', 'Net Banking'] : [])].filter(Boolean).map((x) => html`<span>${x}</span>`)}</p></div></div>
<div class="wrap fbottom"><span>&copy; ${new Date().getFullYear()} ${s.store_name}. All Rights Reserved.</span><span><a href="/page/privacy">Privacy Policy</a> &middot; <a href="/page/terms">Terms &amp; Conditions</a> &middot; <a href="/sitemap.xml">Sitemap</a></span></div></footer>`;
}

export const csrfField = (ctx) => html`<input type="hidden" name="_csrf" value="${ctx.csrf}">`;
export const pager = (ctx, page, total, per) => {
  const pages = Math.ceil(total / per); if (pages <= 1) return '';
  const link = (n) => { const u = new URL(ctx.url); n > 1 ? u.searchParams.set('page', n) : u.searchParams.delete('page'); return u.pathname + u.search; };
  const nums = [...new Set([1, page - 1, page, page + 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  return html`<nav class="pager" aria-label="Pagination">${page > 1 ? html`<a rel="prev" href="${link(page - 1)}">&laquo; Prev</a>` : ''}${nums.map((n) => n === page ? html`<span class="cur" aria-current="page">${n}</span>` : html`<a href="${link(n)}">${n}</a>`)}${page < pages ? html`<a rel="next" href="${link(page + 1)}">Next &raquo;</a>` : ''}</nav>`;
};
export const statusPill = (s) => html`<span class="pill pill-${s}">${label(s)}</span>`;
export { esc, fmtDate };
