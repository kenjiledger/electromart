import { get, post } from '../router.js';
import { q, now, audit } from '../db.js';
import { html, raw, esc, UserError, toPaise, fromPaise, fromLocalInput, toLocalInput, saveImage, slugify, label } from '../util.js';
import { csrfField, LOGO, ASSET_V } from '../views.js';
import { S } from '../settings.js';

/* Every admin route is wrapped: the owner session is checked on the SERVER for each request. */
function guard(h, { allowForcedChange = false } = {}) {
  return async (ctx) => {
    if (!ctx.owner) { if (ctx.method === 'GET') return ctx.redirect('/admin/login'); return ctx.fail(403, 'Forbidden'); }
    if (ctx.owner.must_change_password && !allowForcedChange) return ctx.redirect('/admin/password');
    ctx.actor = ctx.owner.username;
    return h(ctx);
  };
}
export const aget = (p, h, o) => get(p, guard(h, o));
export const apost = (p, h, o) => post(p, guard(h, o), o);
export const log = (ctx, action, entity, detail) => audit(ctx.owner?.username || 'unknown', action, entity, detail, ctx.ip);

const NAV = [['/admin', 'Dashboard'], ['/admin/orders', 'Orders'], ['/admin/requests', 'Cancel / Return requests'], ['/admin/products', 'Products'], ['/admin/categories', 'Categories'], ['/admin/banners', 'Banners'], ['/admin/sections', 'Homepage sections'], ['/admin/coupons', 'Coupons'], ['/admin/promotions', 'Flash sales'], ['/admin/customers', 'Customers'], ['/admin/support', 'Support inbox'], ['/admin/pages', 'Pages & policies'], ['/admin/settings', 'Store settings'], ['/admin/audit', 'Audit log'], ['/admin/outbox', 'Email outbox']];
export function adminPage(ctx, { title, body, active, status = 200 }) {
  ctx.cartCount = 0;
  const pend = q.get("SELECT (SELECT COUNT(*) FROM order_requests WHERE status='pending') r, (SELECT COUNT(*) FROM orders WHERE payment_status='awaiting_verification') p").r;
  const out = html`<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title} | Admin</title><link rel="icon" href="/img/favicon.svg"><link rel="stylesheet" href="/css/style.css?v=${ASSET_V}"></head>
<body class="admin"><a class="skip" href="#main">Skip to content</a><header class="adm-top"><button class="icon-btn" data-toggle="admnav" aria-label="Menu">&#9776;</button><a href="/admin" class="brand">${LOGO}<span><small>Owner</small><b>Dashboard</b></span></a><span class="grow"></span><a class="btn btn-sm" href="/" target="_blank" rel="noopener">View store</a>
 <form method="post" action="/admin/logout">${csrfField(ctx)}<button class="btn btn-sm">Sign out (${ctx.owner.username})</button></form></header>
<div class="adm-layout"><nav id="admnav" class="adm-nav" aria-label="Admin">${NAV.map(([h, t]) => html`<a href="${h}" class="${active === h ? 'cur' : ''}">${t}${h === '/admin/requests' && pend ? html` <span class="count">${pend}</span>` : ''}</a>`)}</nav>
<main id="main" class="adm-main">${ctx.flashMsg ? html`<p class="flash ${ctx.flashMsg.t}" role="status">${ctx.flashMsg.m}</p>` : ''}<h1>${title}</h1>${body}</main></div><script src="/js/app.js?v=${ASSET_V}" defer></script></body></html>`;
  ctx.html(out, status);
}

export const fld = (f, v) => {
  const id = 'f_' + f.name; const val = v ?? f.default ?? '';
  const help = f.help ? html`<span class="muted small">${f.help}</span>` : '';
  switch (f.type) {
    case 'textarea': return html`<label>${f.label}<textarea name="${f.name}" rows="${f.rows || 3}" ${f.required ? raw('required') : ''}>${val}</textarea>${help}</label>`;
    case 'bool': return html`<label class="chk"><input type="checkbox" name="${f.name}" value="1" ${Number(val) ? raw('checked') : ''}> ${f.label} ${help}</label>`;
    case 'select': return html`<label>${f.label}<select name="${f.name}" ${f.required ? raw('required') : ''}>${(f.options() || []).map(([ov, ol]) => html`<option value="${ov}" ${String(ov) === String(val) ? raw('selected') : ''}>${ol}</option>`)}</select>${help}</label>`;
    case 'image': return html`<label>${f.label}<input type="file" name="${f.name}" accept="image/png,image/jpeg,image/webp,image/gif">${help}</label>${val ? html`<p><img src="${val}" alt="" class="thumb"> <label class="chk"><input type="checkbox" name="remove_${f.name}" value="1"> Remove</label></p>` : ''}`;
    case 'number': return html`<label>${f.label}<input type="number" name="${f.name}" value="${val}" ${f.min != null ? raw(`min="${f.min}"`) : ''} ${f.max != null ? raw(`max="${f.max}"`) : ''} ${f.required ? raw('required') : ''}>${help}</label>`;
    case 'rupees': return html`<label>${f.label} (₹)<input type="number" step="0.01" min="0" name="${f.name}" value="${v == null || v === '' ? '' : fromPaise(v)}" ${f.required ? raw('required') : ''}>${help}</label>`;
    case 'datetime': return html`<label>${f.label} (IST)<input type="datetime-local" name="${f.name}" value="${toLocalInput(v)}">${help}</label>`;
    default: return html`<label>${f.label}<input id="${id}" type="${f.type === 'url' ? 'text' : 'text'}" name="${f.name}" value="${val}" ${f.required ? raw('required') : ''} ${f.maxlength ? raw(`maxlength="${f.maxlength}"`) : ''}>${help}</label>`;
  }
};
export function readFields(ctx, fields, row = {}) {
  const out = {};
  for (const f of fields) {
    const raw0 = ctx.body[f.name]; const s = raw0 == null ? '' : String(raw0).trim();
    if (f.type === 'image') {
      const part = ctx.files.find((p) => p.name === f.name); let v = row[f.name] || '';
      if (ctx.body['remove_' + f.name]) v = '';
      const saved = saveImage(part); if (saved) v = saved;
      out[f.name] = v; continue;
    }
    if (f.type === 'bool') { out[f.name] = raw0 ? 1 : 0; continue; }
    if (f.type === 'number') { if (s === '') { if (f.required) throw new UserError(`${f.label} is required.`); out[f.name] = f.nullable ? null : (f.default ?? 0); } else { const n = parseInt(s, 10); if (!Number.isFinite(n) || (f.min != null && n < f.min) || (f.max != null && n > f.max)) throw new UserError(`${f.label} is not valid.`); out[f.name] = n; } continue; }
    if (f.type === 'rupees') { if (s === '') { if (f.required) throw new UserError(`${f.label} is required.`); out[f.name] = null; } else { const n = toPaise(s); if (!Number.isFinite(n) || n < 0) throw new UserError(`${f.label} is not a valid amount.`); out[f.name] = n; } continue; }
    if (f.type === 'datetime') { out[f.name] = fromLocalInput(s); continue; }
    if (f.type === 'select') { const ok = (f.options() || []).some(([v]) => String(v) === s); if (!ok && (s !== '' || f.required)) throw new UserError(`${f.label} is not valid.`); out[f.name] = s === '' && f.nullable ? null : f.numeric ? Number(s) || null : s; continue; }
    if (f.required && !s) throw new UserError(`${f.label} is required.`);
    if (f.pattern && s && !f.pattern.test(s)) throw new UserError(`${f.label} is not valid.`);
    if (f.type === 'url' && s && !/^(\/(?!\/)|https?:\/\/|#)/.test(s)) throw new UserError(`${f.label} must start with / or https://`);
    out[f.name] = s.slice(0, f.type === 'textarea' ? 20000 : 500);
  }
  return out;
}

/** Generic list/create/edit/delete screens for simple entities. */
export function crud({ base, table, title, singular, fields, cols, orderBy = 'id', before, prep, canDelete = true, intro = '', extraActions }) {
  const find = (id) => q.get(`SELECT * FROM ${table} WHERE id=?`, id);
  aget(base, (ctx) => {
    const rows = q.all(`SELECT * FROM ${table} ORDER BY ${orderBy}`);
    adminPage(ctx, { title, active: base, body: html`${intro ? html`<p class="muted">${intro}</p>` : ''}<p><a class="btn btn-orange" href="${base}/new">+ New ${singular}</a></p>
      <div class="tablewrap"><table class="table"><thead><tr>${cols.map((c) => html`<th>${c.label}</th>`)}<th></th></tr></thead><tbody>${rows.length ? rows.map((r) => html`<tr>${cols.map((c) => html`<td>${c.render ? c.render(r) : r[c.key]}</td>`)}<td class="nowrap"><a class="btn btn-sm" href="${base}/${r.id}">Edit</a> ${canDelete ? html`<form class="inl" method="post" action="${base}/${r.id}/delete" data-confirm="Delete this ${singular}?">${csrfField(ctx)}<button class="btn btn-sm btn-danger">Delete</button></form>` : ''}${extraActions ? extraActions(ctx, r) : ''}</td></tr>`) : html`<tr><td colspan="${cols.length + 1}" class="muted">Nothing here yet.</td></tr>`}</tbody></table></div>` });
  });
  const form = (ctx, row, err) => adminPage(ctx, { status: err ? 400 : 200, title: row?.id ? `Edit ${singular}` : `New ${singular}`, active: base, body: html`${err ? html`<p class="flash err" role="alert">${err}</p>` : ''}<form method="post" action="${base}/save" enctype="multipart/form-data" class="card pad stack formw">${csrfField(ctx)}<input type="hidden" name="id" value="${row?.id || ''}">${fields.map((f) => fld(f, row?.[f.name]))}<div class="btnrow"><button class="btn btn-orange">Save</button><a class="btn" href="${base}">Cancel</a></div></form>` });
  aget(`${base}/new`, (ctx) => form(ctx, null));
  aget(`${base}/:id`, (ctx) => { const r = find(ctx.params.id); if (!r) return ctx.notFound(); form(ctx, prep ? prep(r) : r); });
  apost(`${base}/save`, (ctx) => {
    const row = ctx.body.id ? find(ctx.body.id) : null;
    try {
      const vals = readFields(ctx, fields, row || {});
      if (before) before(vals, row, ctx);
      const keys = Object.keys(vals);
      if (row) q.run(`UPDATE ${table} SET ${keys.map((k) => k + '=?').join(',')} WHERE id=?`, ...keys.map((k) => vals[k]), row.id);
      else q.run(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, ...keys.map((k) => vals[k]));
      log(ctx, row ? `${singular}.update` : `${singular}.create`, table, vals.name || vals.title || vals.code || row?.id);
      ctx.flash('ok', `${singular} saved.`); ctx.redirect(base);
    } catch (e) {
      if (/UNIQUE/.test(e.message)) e = new UserError('That value already exists (it must be unique).');
      if (!e.user) throw e; form(ctx, { ...(row || {}), ...ctx.body, id: row?.id }, e.message);
    }
  });
  apost(`${base}/:id/delete`, (ctx) => { const r = find(ctx.params.id); if (r) { q.run(`DELETE FROM ${table} WHERE id=?`, r.id); log(ctx, `${singular}.delete`, table, r.name || r.title || r.code || r.id); ctx.flash('ok', `${singular} deleted.`); } ctx.redirect(base); });
}
export { label, slugify };
