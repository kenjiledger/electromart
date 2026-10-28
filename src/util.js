import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/* ---------- safe HTML templating: every interpolation is escaped unless wrapped with raw() ---------- */
export class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Safe(String(s ?? ''));
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const render = (v) => (v instanceof Safe ? v.s : Array.isArray(v) ? v.map(render).join('') : v == null || v === false ? '' : esc(v));
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += render(vals[i]); });
  return new Safe(out);
}

/* ---------- formatting (INR, Indian grouping, IST) ---------- */
export const inr = (paise) => '₹' + (Number(paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 });
export const toPaise = (rupees) => { const n = Number(String(rupees).replace(/,/g, '')); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };
export const fromPaise = (p) => (p == null ? '' : (p / 100).toString());
export const fmtDate = (iso, time = true) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) }) : '');
export const toLocalInput = (iso) => (iso ? new Date(Date.parse(iso) + 19800000).toISOString().slice(0, 16) : '');
export const fromLocalInput = (v) => { if (!v) return null; const t = Date.parse(v + ':00+05:30'); return Number.isNaN(t) ? null : new Date(t).toISOString(); };
export const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 80) || 'item';
export const label = (s) => String(s).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/* ---------- cookies / bodies ---------- */
export function parseCookies(h = '') {
  const o = {};
  for (const p of h.split(';')) { const i = p.indexOf('='); if (i > 0) { try { o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch { /* ignore */ } } }
  return o;
}
export function cookie(name, value, { maxAge, path: p = '/', httpOnly = true } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=${p}; SameSite=Lax`;
  if (httpOnly) c += '; HttpOnly';
  if (config.prod) c += '; Secure';
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  return c;
}
export async function readBody(req, limit) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) { const e = new Error('Payload too large'); e.status = 413; throw e; } chunks.push(c); }
  return Buffer.concat(chunks);
}
export function parseMultipart(buf, boundary) {
  const parts = []; const b = Buffer.from('--' + boundary);
  let pos = buf.indexOf(b);
  while (pos !== -1) {
    const next = buf.indexOf(b, pos + b.length);
    if (next === -1) break;
    const chunk = buf.subarray(pos + b.length + 2, next - 2);
    const he = chunk.indexOf('\r\n\r\n');
    if (he !== -1) {
      const head = chunk.subarray(0, he).toString('utf8');
      parts.push({ name: /name="([^"]*)"/.exec(head)?.[1], filename: /filename="([^"]*)"/.exec(head)?.[1], body: chunk.subarray(he + 4) });
    }
    pos = next;
  }
  return parts;
}
export function formObject(pairs) {
  const o = {};
  for (const [k, v] of pairs) { if (k in o) o[k] = [].concat(o[k], v); else o[k] = v; }
  return o;
}

/* ---------- uploads: only raster images, verified by magic bytes (SVG is refused: script risk) ---------- */
export function sniffImage(b) {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (b.toString('latin1', 0, 3) === 'GIF') return 'gif';
  return null;
}
export const MAX_IMAGE = 3 * 1024 * 1024;
export function saveImage(part) {
  if (!part || !part.filename || !part.body.length) return null;
  if (part.body.length > MAX_IMAGE) throw new UserError('Image is larger than 3 MB.');
  const ext = sniffImage(part.body);
  if (!ext) throw new UserError('Only JPG, PNG, WebP or GIF images are allowed.');
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(config.uploadDir, name), part.body);
  return '/uploads/' + name;
}
export class UserError extends Error { constructor(m, status = 400) { super(m); this.status = status; this.user = true; } }

/* ---------- misc ---------- */
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (n = 32) => crypto.randomBytes(n).toString('base64url');
export const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest('hex');
export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
export const isEmail = (s) => /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 254;
export const normPhone = (s) => { const d = String(s || '').replace(/[^\d+]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''); return /^[6-9]\d{9}$/.test(d) ? d : null; };
export const isPin = (s) => /^[1-9]\d{5}$/.test(String(s));
export function csv(rows) {
  const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; /* spreadsheet formula-injection guard */ return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}
export function parseCsv(text) {
  const rows = []; let row = [], f = '', inq = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inq) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else inq = false; } else f += c; }
    else if (c === '"') inq = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f.replace(/\r$/, '')); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
export function pageParam(v) { const n = parseInt(v, 10); return n > 0 && n < 100000 ? n : 1; }
export function clampInt(v, min, max, d = min) { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; }

/** Owner-authored page HTML: strip scripts, iframes, inline handlers and javascript: URLs (defence in depth; only the owner can edit). */
export function sanitizeHtml(s) {
  return String(s || '')
    .replace(/<\s*(script|style|iframe|object|embed|form|link|meta|base)\b[\s\S]*?(<\/\s*\1\s*>|$)/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|form|link|meta|base)\b[^>]*>/gi, '')
    .replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')?\s*javascript:[^"'>\s]*/gi, '$1=$2#');
}
