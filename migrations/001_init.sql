CREATE TABLE users(
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN('customer','owner')),
  username TEXT UNIQUE COLLATE NOCASE,
  email TEXT UNIQUE COLLATE NOCASE,
  phone TEXT UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  pass_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','suspended','deletion_requested','deleted')),
  email_verified INTEGER NOT NULL DEFAULT 0,
  notify_email INTEGER NOT NULL DEFAULT 1,
  notify_sms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
-- The database itself guarantees there can only ever be ONE owner account.
CREATE UNIQUE INDEX one_owner ON users(role) WHERE role='owner';

CREATE TABLE sessions(
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN('customer','owner')), ip TEXT,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE TABLE tokens(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, used_at TEXT
);
CREATE TABLE addresses(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, phone TEXT NOT NULL, line1 TEXT NOT NULL, line2 TEXT DEFAULT '',
  city TEXT NOT NULL, state TEXT NOT NULL, pin TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE categories(
  id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT DEFAULT '', image TEXT DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0, published INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE brands(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, slug TEXT NOT NULL UNIQUE);
CREATE TABLE products(
  id INTEGER PRIMARY KEY, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  brand_id INTEGER REFERENCES brands(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  short_desc TEXT DEFAULT '', description TEXT DEFAULT '',
  price INTEGER NOT NULL CHECK(price>=0), sale_price INTEGER CHECK(sale_price IS NULL OR sale_price>=0),
  sale_start TEXT, sale_end TEXT,
  stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','published','archived')),
  publish_at TEXT, featured INTEGER NOT NULL DEFAULT 0, trending INTEGER NOT NULL DEFAULT 0, bestseller INTEGER NOT NULL DEFAULT 0,
  tags TEXT DEFAULT '', specs TEXT DEFAULT '[]', warranty TEXT DEFAULT '', shipping_note TEXT DEFAULT '', weight_g INTEGER DEFAULT 0,
  seo_title TEXT DEFAULT '', seo_desc TEXT DEFAULT '', is_sample INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_products_cat ON products(category_id, status);
CREATE INDEX idx_products_status ON products(status, publish_at);
CREATE INDEX idx_products_brand ON products(brand_id);
CREATE INDEX idx_products_created ON products(created_at);
CREATE TABLE product_images(
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  path TEXT NOT NULL, alt TEXT DEFAULT '', is_primary INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_images_product ON product_images(product_id);
CREATE TABLE variants(
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label TEXT NOT NULL, sku TEXT DEFAULT '', price INTEGER, stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0), position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_variants_product ON variants(product_id);

CREATE TABLE cart_items(
  id INTEGER PRIMARY KEY, owner_key TEXT NOT NULL, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id INTEGER NOT NULL DEFAULT 0, qty INTEGER NOT NULL CHECK(qty>0), updated_at TEXT NOT NULL,
  UNIQUE(owner_key, product_id, variant_id)
);
CREATE TABLE wishlist(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, PRIMARY KEY(user_id, product_id)
);
CREATE TABLE reviews(
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), title TEXT DEFAULT '', body TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'published', created_at TEXT NOT NULL, UNIQUE(product_id, user_id)
);
CREATE TABLE coupons(
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE COLLATE NOCASE, description TEXT DEFAULT '',
  type TEXT NOT NULL CHECK(type IN('percent','fixed')), value INTEGER NOT NULL CHECK(value>0),
  max_discount INTEGER NOT NULL DEFAULT 0, min_order INTEGER NOT NULL DEFAULT 0,
  usage_limit INTEGER NOT NULL DEFAULT 0, per_user_limit INTEGER NOT NULL DEFAULT 0, used_count INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT, ends_at TEXT, active INTEGER NOT NULL DEFAULT 1, first_order_only INTEGER NOT NULL DEFAULT 0,
  free_shipping INTEGER NOT NULL DEFAULT 0,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL, product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  is_sample INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE orders(
  id INTEGER PRIMARY KEY, number TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  email TEXT DEFAULT '', phone TEXT NOT NULL, name TEXT NOT NULL,
  ship_address TEXT NOT NULL, pin TEXT NOT NULL,
  subtotal INTEGER NOT NULL, discount INTEGER NOT NULL DEFAULT 0, shipping INTEGER NOT NULL DEFAULT 0,
  tax INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL, coupon_code TEXT DEFAULT '',
  payment_method TEXT NOT NULL CHECK(payment_method IN('cod','upi_qr','razorpay')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN('pending','awaiting_verification','paid','failed','partially_refunded','refunded')),
  status TEXT NOT NULL DEFAULT 'placed' CHECK(status IN('placed','confirmed','processing','packed','shipped','out_for_delivery','delivered','cancelled','returned')),
  courier TEXT DEFAULT '', tracking_no TEXT DEFAULT '', tracking_url TEXT DEFAULT '', eta_text TEXT DEFAULT '',
  idempotency_key TEXT UNIQUE, restocked INTEGER NOT NULL DEFAULT 0, delivered_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status, payment_status);
CREATE INDEX idx_orders_created ON orders(created_at);
CREATE TABLE order_items(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL, variant_id INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL, variant_label TEXT DEFAULT '', sku TEXT DEFAULT '', unit_price INTEGER NOT NULL, mrp INTEGER NOT NULL,
  qty INTEGER NOT NULL, image TEXT DEFAULT ''
);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);
CREATE TABLE order_events(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, status TEXT DEFAULT '', note TEXT DEFAULT '', actor TEXT DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE payments(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, provider_order_id TEXT, provider_payment_id TEXT UNIQUE, utr TEXT UNIQUE,
  amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'created', failure_reason TEXT DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_payments_order ON payments(order_id);
CREATE TABLE webhook_events(id TEXT PRIMARY KEY, provider TEXT NOT NULL, received_at TEXT NOT NULL);
CREATE TABLE refunds(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payment_id INTEGER REFERENCES payments(id), amount INTEGER NOT NULL CHECK(amount>0),
  status TEXT NOT NULL CHECK(status IN('approved','processing','processed','failed','rejected')),
  provider_refund_id TEXT UNIQUE, reason TEXT DEFAULT '', reference TEXT DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE order_requests(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK(type IN('cancel','return')), reason TEXT NOT NULL, details TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected')),
  admin_note TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE banners(
  id INTEGER PRIMARY KEY, slot TEXT NOT NULL DEFAULT 'hero' CHECK(slot IN('hero','side','promo')),
  title TEXT NOT NULL, eyebrow TEXT DEFAULT '', subtitle TEXT DEFAULT '', btn_text TEXT DEFAULT '', btn_url TEXT DEFAULT '',
  desktop_img TEXT DEFAULT '', mobile_img TEXT DEFAULT '', img_alt TEXT DEFAULT '', theme TEXT DEFAULT 'dark',
  position INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, starts_at TEXT, ends_at TEXT,
  show_countdown INTEGER NOT NULL DEFAULT 0, is_sample INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE home_sections(
  id INTEGER PRIMARY KEY, title TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN('deals','trending','bestsellers','new','recommended','category','featured')),
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL, item_limit INTEGER NOT NULL DEFAULT 6,
  position INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE pages(
  slug TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', draft_body TEXT,
  seo_title TEXT DEFAULT '', seo_desc TEXT DEFAULT '', updated_at TEXT NOT NULL
);
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE notifications(
  id INTEGER PRIMARY KEY, user_id INTEGER, to_addr TEXT, subject TEXT NOT NULL, body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', created_at TEXT NOT NULL
);
CREATE TABLE audit_logs(
  id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, entity TEXT DEFAULT '', detail TEXT DEFAULT '',
  ip TEXT DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE newsletter(email TEXT PRIMARY KEY COLLATE NOCASE, created_at TEXT NOT NULL);
CREATE TABLE support_requests(
  id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT NOT NULL, email TEXT NOT NULL, subject TEXT NOT NULL, message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL
);
CREATE TABLE redirects(from_path TEXT PRIMARY KEY, to_path TEXT NOT NULL);
