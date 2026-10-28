# The ElectroMart - Smart Shopping. Better Living.

A working e-commerce application: storefront, customer accounts, cart, checkout (Cash on Delivery, owner-uploaded UPI QR, optional Razorpay), order/return/refund workflows, and a full owner dashboard for **Anup**.

## Why this stack (and what it is not)
Built on **Node 22+ with zero npm dependencies**: built-in `node:sqlite` (SQLite, WAL), `crypto.scrypt` password hashing, server-rendered HTML (good for SEO and speed). It was chosen because the build environment had no internet, so Next.js/Prisma/PostgreSQL could not be installed, run or tested. Everything here was actually executed and tested.
Trade-offs you should know: SQLite suits one server and moderate traffic (a single shop is fine); to grow beyond that, move `src/db.js` + `migrations/` to PostgreSQL. `node:sqlite` is marked experimental by Node. There is no WebP/AVIF conversion (put the site behind a CDN or image optimiser such as Cloudflare Images), and no email/SMS transport is wired (see `docs/DEPLOY.md`).

## Run locally
```bash
cp .env.example .env          # dev defaults; owner = Anup, temporary password from OWNER_INITIAL_PASSWORD
npm start                     # http://localhost:3000   (sample catalog is created on first start)
npm test                      # 46 automated tests
```
Owner login: `http://localhost:3000/admin/login` - username `Anup`. The temporary development password is read **server-side** from `OWNER_INITIAL_PASSWORD` in `.env`; at first sign-in you are forced to set a strong password (12+ chars, letters and numbers). In production the server refuses to start if that variable is `9999` or shorter than 12 characters. Lost password: `npm run owner:reset` (needs server shell access).

## Taking payments without Razorpay (your QR)
Admin > Store settings > Payments: upload your UPI QR image, optionally enter your UPI ID, tick **Enable UPI QR payment**, save. Customers then see your QR at checkout. They pay in their UPI app and submit the transaction (UTR) reference. **The order is not marked paid automatically**: it shows "Payments to verify" on your dashboard, you check your bank/UPI statement, then press "mark as paid". Duplicate references are rejected. See `docs/PAYMENTS.md` for Razorpay later.

## What is implemented
Storefront: dynamic homepage (hero slider, side banners, category rail, dynamic product sections, reviews, newsletter), categories, search with autocomplete, filters, sorting, pagination, product pages with variants and galleries, wishlist, persistent cart, coupons, PIN-code delivery check, recently viewed, related products.
Customers: register by email or mobile, sign in/out, email verification and password reset (via outbox), profile, addresses, change password, orders, tracking, cancel (instant / by request / returns after delivery), reviews (only after delivery), notification preferences, account deletion request.
Owner: dashboard (real figures + SVG sales chart by day/week/month), products (images, alt text, primary image, variants, specs, schedule, flags, CSV import/export, bulk actions), categories, banners (desktop/mobile images, schedule, countdown, preview), homepage sections, coupons, flash-sale tool, orders (filters, status, courier/tracking, COD confirm, payment verify, refunds, invoices, packing slips, CSV), cancel/return requests, customers (suspend/reactivate/erase, CSV), support inbox, pages & policies (draft/preview/publish), store settings, audit log, email outbox.
Security: scrypt hashes, hashed session tokens, HttpOnly/SameSite cookies, separate path-scoped owner session, CSRF on every POST, login lockout + rate limits, CSP and security headers, parameterised SQL, escaped templates, magic-byte image validation (SVG refused), CSV formula-injection guard, DB-enforced single owner, server-side price/stock/coupon/shipping/tax recomputation, transactional stock decrement, idempotent checkout, audit trail.

## Not done / not verified (be aware)
- Razorpay is implemented to its documented REST/signature/webhook contract and unit-tested for signatures, webhooks and idempotency, but **never run against the live Razorpay API** (no network here). Test it in Razorpay test mode before launch.
- No browser was available: **mobile/desktop layouts were not visually verified**; there are no Lighthouse results and no Playwright end-to-end tests. Only static responsive checks run in the suite. Please open the site on your phone and laptop and report anything off.
- Email/SMS are not delivered (outbox only); phone-number OTP verification is not implemented.
- Not built: courier API integration (manual tracking only; the schema allows adding one), return-pickup scheduling, multiple shipping methods, per-variant images, product-review moderation screen, WebP/AVIF generation, Redis-backed rate limiting.
- Product photos are neutral placeholder illustrations labelled "sample"; upload real photos. Policy pages are templates; have them reviewed by a legal professional. GST: prices are treated as GST-inclusive and the tax shown is the portion contained in item value; confirm invoice rules with your accountant.
