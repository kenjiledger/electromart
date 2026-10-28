import { get } from '../router.js';
import { q, now } from '../db.js';
import { config } from '../config.js';
import { flag } from '../settings.js';
import { esc } from '../util.js';

get('/robots.txt', (ctx) => {
  const lines = flag('allow_indexing')
    ? ['User-agent: *', 'Disallow: /admin', 'Disallow: /account', 'Disallow: /cart', 'Disallow: /checkout', 'Disallow: /pay/', 'Disallow: /order/', 'Disallow: /api/', 'Disallow: /search', 'Disallow: /track', `Sitemap: ${config.baseUrl}/sitemap.xml`]
    : ['User-agent: *', 'Disallow: /'];
  ctx.text(lines.join('\n') + '\n', 'text/plain; charset=utf-8', { 'Cache-Control': 'public, max-age=3600' });
});
get('/sitemap.xml', (ctx) => {
  const u = (loc, lastmod, pri) => `<url><loc>${esc(config.baseUrl + loc)}</loc>${lastmod ? `<lastmod>${lastmod.slice(0, 10)}</lastmod>` : ''}<priority>${pri}</priority></url>`;
  const rows = [u('/', null, '1.0'), u('/deals', null, '0.7'), u('/best-sellers', null, '0.7'), u('/new-arrivals', null, '0.7')];
  for (const c of q.all('SELECT slug FROM categories WHERE published=1')) rows.push(u(`/c/${c.slug}`, null, '0.8'));
  for (const p of q.all("SELECT slug,updated_at FROM products WHERE status='published' AND (publish_at IS NULL OR publish_at<=?)", now())) rows.push(u(`/p/${p.slug}`, p.updated_at, '0.9'));
  for (const p of q.all('SELECT slug,updated_at FROM pages')) rows.push(u(`/page/${p.slug}`, p.updated_at, '0.3'));
  ctx.text(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows.join('')}</urlset>`, 'application/xml; charset=utf-8', { 'Cache-Control': 'public, max-age=3600' });
});
