import { q } from './db.js';

export const DEFAULTS = {
  store_name: 'The ElectroMart', tagline: 'Smart Shopping. Better Living.',
  contact_email: 'support@example.com', contact_phone: '+91 00000 00000', contact_address: 'Add your business address in Admin > Settings',
  announce_1: 'Free Shipping on Orders Above ₹999', announce_2: '100% Secure Payments', announce_3: 'Easy Returns & Cancellation', announce_4: '24/7 Customer Support',
  campaign_label: 'Diwali Special', campaign_url: '/c/diwali-specials',
  trust_lines: 'Cash on Delivery|Pay after you receive\nSecure Online Payment|UPI, cards, net banking\nEasy Returns|Within 7 days\n24/7 Support|We are always here\nTop Brands|Genuine products',
  why_lines: 'Genuine Products|100% original & branded\nBest Price Guarantee|Lowest prices, always\nFast & Reliable Delivery|Across serviceable PIN codes\nEasy Returns & Refunds|Hassle-free process\n24/7 Customer Support|We are always here',
  social_facebook: '', social_instagram: '', social_youtube: '', social_twitter: '', social_whatsapp: '',
  tax_percent: '18', shipping_fee: '9900', free_ship_threshold: '99900', delivery_days: '5', return_window_days: '7',
  cod_enabled: '1', cod_max_order: '5000000', upi_enabled: '0', upi_id: '', upi_payee: '', upi_qr_path: '',
  serviceable_pins: '78*, 11*, 40*, 56*, 70*, 60*', order_prefix: 'EM-', order_seq: '100000',
  email_notifications: '1', invoice_company: 'The ElectroMart', invoice_gstin: '', invoice_address: '', invoice_footer: 'Thank you for shopping with us.',
  maintenance_mode: '0', allow_indexing: '0', seo_default_title: 'The ElectroMart - Smart Shopping. Better Living.',
  seo_default_desc: 'Shop mobiles, electronics, fashion, home & kitchen and more at The ElectroMart.', og_image: '', logo_path: '', favicon_path: '',
  hero_autoplay_secs: '6', low_stock_threshold: '5',
  card_min_width: '190', card_image_ratio: 'square', card_image_fit: 'contain', card_radius: '10', card_shadow: 'soft', card_btn_style: 'filled',
  card_show_brand_line: '1', card_show_rating: '1', card_show_badge: '1', card_show_wishlist: '1', card_cols_mobile: '2',
};
let cache = null;
export function loadSettings() {
  cache = { ...DEFAULTS };
  for (const r of q.all('SELECT key,value FROM settings')) cache[r.key] = r.value;
  return cache;
}
export const S = () => cache || loadSettings();
export function setSetting(key, value) {
  q.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value));
  cache = null;
}
export const flag = (k) => S()[k] === '1';
export const num = (k) => Number(S()[k]) || 0;

/** Serviceable PIN rules: comma list of exact PINs or prefixes ending in * ; "*" alone = everywhere. */
export function pinInfo(pin) {
  const rules = S().serviceable_pins.split(/[,\s]+/).filter(Boolean);
  const ok = rules.some((r) => r === '*' || (r.endsWith('*') ? String(pin).startsWith(r.slice(0, -1)) : r === String(pin)));
  return { ok, days: num('delivery_days') || 5 };
}
