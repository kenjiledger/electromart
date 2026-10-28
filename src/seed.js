/* SAMPLE DATA ONLY. Every product/banner/coupon seeded here is flagged is_sample=1 and can be removed in Admin > Settings. */
import { q, now, tx } from './db.js';
import { slugify } from './util.js';
import { setSetting } from './settings.js';

const CATS = [
  ['Mobiles & Tablets', ['Smartphones', 'Tablets']], ['Electronics', []], ['Computers & Laptops', []], ['Audio & Headphones', []],
  ['Fashion', ['Men', 'Women']], ['Home & Kitchen', []], ['Beauty & Personal Care', []], ['Appliances', []], ['Sports & Outdoors', []],
  ['Toys & Games', []], ['Books & Stationery', []], ['Automotive', []], ['Accessories', []], ['More Categories', []], ['Diwali Specials', []],
];
const P = (name, brand, cat, mrp, sale, stock, img, o = {}) => ({ name, brand, cat, mrp, sale, stock, img, ...o });
const PRODUCTS = [
  P('Nova X5 5G Smartphone (128GB)', 'Nova', 'Smartphones', 7999900, 6999900, 25, 'phone', { short: '5G | 6.1" Super Retina Display', f: 'deals', variants: [['128GB', null, 15], ['256GB', 7999900, 10]], specs: [['Display', '6.1 inch OLED'], ['Storage', '128 GB'], ['Network', '5G']], warranty: '1 year manufacturer warranty' }),
  P('Aria Wireless Noise Cancelling Headphones', 'Aria', 'Audio & Headphones', 3499900, 1899900, 40, 'headphones', { short: 'Wireless | Noise Cancelling', f: 'deals,trending', specs: [['Battery', 'Up to 30 hours'], ['Connectivity', 'Bluetooth 5.3']], warranty: '1 year warranty' }),
  P('Zenith Pavilion Laptop 15"', 'Zenith', 'Computers & Laptops', 6899900, 4999900, 12, 'laptop', { short: 'Core i5 | 16GB RAM | 512GB SSD', f: 'deals,featured', specs: [['Processor', 'Intel Core i5'], ['RAM', '16 GB'], ['Storage', '512 GB SSD']], warranty: '1 year onsite warranty' }),
  P("Women's Casual Cotton Dress", 'Lumi', 'Women', 99900, 59900, 80, 'dress', { short: 'Cotton | Regular Fit', f: 'deals,new', variants: [['S', null, 20], ['M', null, 30], ['L', null, 20], ['XL', null, 10]] }),
  P('Crisp 4.1L Air Fryer', 'Crisp', 'Appliances', 1099900, 699900, 30, 'fryer', { short: '4.1L | Rapid Air Technology', f: 'deals,bestseller', specs: [['Capacity', '4.1 L'], ['Power', '1500 W']], warranty: '2 year warranty' }),
  P('Pulse Smart Watch AMOLED', 'Pulse', 'Accessories', 399900, 299900, 60, 'watch', { short: 'Bluetooth Calling | AMOLED', f: 'deals,trending', variants: [['Black', null, 30], ['Blue', null, 30]] }),
  P('Vista 43" 4K Smart TV', 'Vista', 'Electronics', 3299900, 2399900, 9, 'tv', { short: '4K Ultra HD | Smart', f: 'trending,featured', specs: [['Screen', '43 inch'], ['Resolution', '3840 x 2160']], warranty: '1 year + 1 year panel' }),
  P('Beat Mini Bluetooth Speaker', 'Beat', 'Audio & Headphones', 299900, 199900, 100, 'speaker', { short: '12h playtime | Water resistant', f: 'bestseller' }),
  P('Stride Running Shoes', 'Stride', 'Men', 249900, 169900, 45, 'shoe', { short: 'Lightweight mesh', f: 'new,trending', variants: [['UK 7', null, 10], ['UK 8', null, 15], ['UK 9', null, 15], ['UK 10', null, 5]] }),
  P('Nova Tab 10 Tablet (64GB)', 'Nova', 'Tablets', 1899900, 1499900, 18, 'tablet-placeholder', { short: '10.4" display | Wi-Fi', f: 'new' }),
  P('Quartz 3-in-1 Charging Cable', 'Quartz', 'Accessories', 49900, 29900, 300, 'cable', { short: 'USB-C | Lightning | Micro-USB', f: 'bestseller' }),
  P('Spark Mixer Grinder 750W', 'Spark', 'Home & Kitchen', 399900, 279900, 35, 'blender', { short: '3 jars | 750W motor', f: 'bestseller,deals' }),
  P('Glow Steel Water Bottle 1L', 'Glow', 'Home & Kitchen', 79900, 59900, 150, 'bottle', { short: 'Insulated | 24h cold', f: 'new' }),
  P('Match Pro Football (Size 5)', 'Match', 'Sports & Outdoors', 129900, 99900, 70, 'ball', { short: 'Machine stitched', f: 'new' }),
  P('Brick Builder Set (500 pcs)', 'Brick', 'Toys & Games', 199900, 149900, 40, 'toy', { short: 'Ages 6+', f: 'trending' }),
  P('Study Smart Notebook Pack (5)', 'Page', 'Books & Stationery', 39900, 29900, 200, 'book', { short: 'Ruled | 200 pages each', f: 'new' }),
  P('Drive Car Phone Mount', 'Drive', 'Automotive', 59900, 39900, 120, 'car', { short: 'Dashboard & vent clip', f: 'bestseller' }),
  P('Hydra Daily Face Wash 200ml', 'Hydra', 'Beauty & Personal Care', 34900, 24900, 90, 'bottle', { short: 'Gentle daily cleanser', f: 'new' }),
  P('Diwali Gift Hamper - Electronics Combo', 'Nova', 'Diwali Specials', 499900, 349900, 20, 'speaker', { short: 'Speaker + cable + stand', f: 'deals,featured' }),
  P('Festive Kurta Set', 'Lumi', 'Men', 299900, 199900, 50, 'dress', { short: 'Cotton blend | Festive wear', f: 'deals,new', variants: [['M', null, 15], ['L', null, 20], ['XL', null, 15]] }),
  P('Decor LED Festive Lights (10m)', 'Glow', 'Diwali Specials', 59900, 39900, 200, 'cable', { short: 'Warm white | 8 modes', f: 'deals,bestseller' }),
  P('Nova Buds True Wireless Earbuds', 'Nova', 'Audio & Headphones', 299900, 199900, 75, 'headphones', { short: 'ENC | 24h with case', f: 'trending,new' }),
  P('Essentials Backpack 30L', 'Stride', 'Accessories', 149900, 99900, 60, 'book', { short: 'Water resistant | Laptop sleeve', f: 'new' }),
  P('Aero Tower Fan', 'Spark', 'Appliances', 449900, 349900, 14, 'fryer', { short: '3 speeds | Remote', f: 'featured' }),
];

export function seedIfEmpty() {
  if (q.get('SELECT COUNT(*) n FROM categories').n === 0) seedStructure();
  if (q.get('SELECT COUNT(*) n FROM products').n === 0 && (process.env.SEED_SAMPLE_DATA ?? 'true') === 'true' && process.env.NODE_ENV !== 'production') seedSample();
}

function seedStructure() {
  tx(() => {
    CATS.forEach(([n, subs], i) => {
      const id = Number(q.run('INSERT INTO categories(name,slug,position) VALUES(?,?,?)', n, slugify(n), i).lastInsertRowid);
      subs.forEach((s, j) => q.run('INSERT INTO categories(parent_id,name,slug,position) VALUES(?,?,?,?)', id, s, slugify(s), j));
    });
    const sec = [['Best Deals For You', 'deals', 6], ['Trending Products', 'trending', 6], ['Best Sellers', 'bestsellers', 6], ['New Arrivals', 'new', 6], ['Recommended For You', 'recommended', 6]];
    sec.forEach(([t, ty, l], i) => q.run('INSERT INTO home_sections(title,type,item_limit,position) VALUES(?,?,?,?)', t, ty, l, i));
    q.run("INSERT INTO home_sections(title,type,category_id,item_limit,position) VALUES('Home & Kitchen Offers','category',(SELECT id FROM categories WHERE slug='home-kitchen'),6,10)");
    q.run("INSERT INTO home_sections(title,type,category_id,item_limit,position) VALUES('Fashion Picks','category',(SELECT id FROM categories WHERE slug='fashion'),6,11)");
    for (const [slug, title, body] of PAGES) q.run('INSERT INTO pages(slug,title,body,updated_at) VALUES(?,?,?,?)', slug, title, body, now());
    setSetting('seeded_structure', '1');
  });
}

function seedSample() {
  tx(() => {
    for (const p of PRODUCTS) {
      const cat = q.get('SELECT id FROM categories WHERE name=?', p.cat)?.id;
      let b = q.get('SELECT id FROM brands WHERE name=?', p.brand);
      if (!b) b = { id: Number(q.run('INSERT INTO brands(name,slug) VALUES(?,?)', p.brand, slugify(p.brand)).lastInsertRowid) };
      const sku = 'SMP-' + slugify(p.name).toUpperCase().slice(0, 12) + '-' + (q.get('SELECT COUNT(*) n FROM products').n + 1);
      const flags = (p.f || '').split(',');
      const hasV = !!p.variants;
      const id = Number(q.run(`INSERT INTO products(sku,name,slug,brand_id,category_id,short_desc,description,price,sale_price,stock,status,featured,trending,bestseller,tags,specs,warranty,shipping_note,is_sample,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,'published',?,?,?,?,?,?,?,1,?,?)`,
        sku, p.name, slugify(p.name) + '-' + (q.get('SELECT COUNT(*) n FROM products').n + 1), b.id, cat, p.short || '',
        `<p>${p.name}. This is <strong>sample data</strong> for development &ndash; replace with your real product description in Admin &gt; Products.</p>`,
        p.mrp, p.sale, hasV ? 0 : p.stock, flags.includes('featured') ? 1 : 0, flags.includes('trending') ? 1 : 0, flags.includes('bestseller') ? 1 : 0,
        [p.brand, p.cat].join(', ').toLowerCase(), JSON.stringify((p.specs || []).map(([k, v]) => ({ k, v }))), p.warranty || '', 'Ships in 1-2 business days', now(), new Date(Date.now() - Math.random() * 20 * 86400e3).toISOString()).lastInsertRowid);
      const img = p.img === 'tablet-placeholder' ? 'laptop' : p.img;
      q.run('INSERT INTO product_images(product_id,path,alt,is_primary) VALUES(?,?,?,1)', id, `/img/sample/${img}.svg`, `${p.name} (sample illustration)`);
      (p.variants || []).forEach(([label, price, stock], i) => q.run('INSERT INTO variants(product_id,label,sku,price,stock,position) VALUES(?,?,?,?,?,?)', id, label, `${sku}-${i + 1}`, price, stock, i));
    }
    const ends = new Date(Date.now() + 10 * 86400e3).toISOString();
    q.run(`INSERT INTO banners(slot,title,eyebrow,subtitle,btn_text,btn_url,desktop_img,img_alt,position,show_countdown,ends_at,is_sample) VALUES('hero','Big Savings, Bigger Smiles','THIS DIWALI','Top deals on mobiles, electronics, fashion, home & more!','Shop Now','/c/diwali-specials','/img/sample/hero-diwali.svg','Diwali sale banner (sample artwork)',0,1,?,1)`, ends);
    q.run(`INSERT INTO banners(slot,title,eyebrow,subtitle,btn_text,btn_url,desktop_img,img_alt,position,is_sample) VALUES('hero','Electronics Sale','FESTIVE OFFERS','Up to 50% off audio, TVs and accessories','Explore','/c/electronics','/img/sample/hero-diwali.svg','Electronics sale banner (sample artwork)',1,1)`);
    [['Diwali Dhamaka Deals', 'Up to 70% OFF', 'Shop Now', '/deals', 'warm'], ['Exchange Offer', 'Get extra value on old devices', 'Know More', '/page/faq', 'cool'], ['No Cost EMI', 'Ask us about EMI on select cards', 'Check Offers', '/page/faq', 'green']]
      .forEach(([t, s, b, u, th], i) => q.run("INSERT INTO banners(slot,title,subtitle,btn_text,btn_url,theme,position,is_sample) VALUES('side',?,?,?,?,?,?,1)", t, s, b, u, th, i));
    q.run("INSERT INTO coupons(code,description,type,value,min_order,max_discount,usage_limit,active,is_sample) VALUES('DIWALI10','Sample: 10% off (max ₹1,000) on orders above ₹1,999','percent',10,199900,100000,0,1,1)");
    q.run("INSERT INTO coupons(code,description,type,value,min_order,first_order_only,active,is_sample) VALUES('WELCOME100','Sample: ₹100 off your first order above ₹999','fixed',10000,99900,1,1,1)");
    q.run("INSERT INTO coupons(code,description,type,value,min_order,free_shipping,active,is_sample) VALUES('FREESHIP','Sample: free shipping on any order','fixed',100,0,1,1,1)");
  });
}

export function removeSampleData() {
  tx(() => {
    q.run('DELETE FROM products WHERE is_sample=1 AND id NOT IN (SELECT product_id FROM order_items WHERE product_id IS NOT NULL)');
    q.run("UPDATE products SET status='archived' WHERE is_sample=1");
    q.run('DELETE FROM banners WHERE is_sample=1'); q.run('DELETE FROM coupons WHERE is_sample=1');
  });
}

const L = (t) => `<p>${t}</p>`;
const PAGES = [
  ['about', 'About Us', L('The ElectroMart brings you genuine electronics and lifestyle products at fair prices. <em>Edit this page in Admin &gt; Pages.</em>')],
  ['contact', 'Contact Us', L('Reach us using the form below or at the email and phone shown in the footer. We usually reply within one business day.')],
  ['faq', 'Frequently Asked Questions', '<h2>How do I track my order?</h2>' + L('Use <a href="/track">Track Order</a> with your order number and phone number.') + '<h2>Which payment methods do you accept?</h2>' + L('Cash on Delivery and UPI are available when enabled by the store. Available methods are shown at checkout.') + '<h2>Do you deliver to my PIN code?</h2>' + L('Enter your PIN code at checkout; we only accept orders for serviceable areas.')],
  ['privacy', 'Privacy Policy', L('<strong>Template &ndash; replace with your own policy reviewed by a legal professional.</strong> We collect only the information needed to process orders and support you. We never store card or UPI PIN details.')],
  ['terms', 'Terms & Conditions', L('<strong>Template &ndash; replace with your own terms reviewed by a legal professional.</strong>')],
  ['shipping', 'Shipping Policy', L('Shipping charges and free-shipping thresholds are shown at checkout. Delivery estimates depend on your PIN code. <em>Edit in Admin &gt; Pages.</em>')],
  ['cancellation', 'Cancellation Policy', L('Orders can be cancelled online until they are processed. Once packed, submit a cancellation request and we will review it. Shipped orders can be returned after delivery.')],
  ['returns', 'Return & Refund Policy', L('Delivered items can be returned within the return window shown on your order if they are unused and in original packaging. Approved refunds are returned to the original payment method or by bank transfer for Cash on Delivery orders. A refund is complete only when it is marked as sent.')],
  ['warranty', 'Warranty Information', L('Warranty terms are listed on each product page. Keep your invoice for warranty claims.')],
];
