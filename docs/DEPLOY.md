# Production deployment
1. Server with Node 22.5+, HTTPS reverse proxy (Caddy/nginx) forwarding to port 3000 and setting `X-Forwarded-For`.
2. `.env`: `NODE_ENV=production`, `BASE_URL=https://your-domain`, `SESSION_SECRET` (32+ random chars), `OWNER_INITIAL_PASSWORD` (12+ chars, used once), `SEED_SAMPLE_DATA=false`, persistent `DB_PATH` and `UPLOAD_DIR`.
3. `npm start` under systemd/pm2. Sign in at `/admin/login`, set the permanent password, then Store settings: business details, GSTIN, PIN codes, shipping, payments, **Allow indexing** (off until launch), Maintenance mode off.
4. Serve `/uploads` and `/css`, `/js`, `/img` through a CDN (they are cache-friendly and fingerprinted by `?v=`).
5. Email: notifications are queued in `notifications` (Admin > Email outbox). To deliver, implement `deliver()` in `src/notify.js` with your provider's HTTPS API.
6. Run on one instance (in-memory rate limiter and SQLite). Scaling out needs PostgreSQL and a shared rate-limit store.
## Backup & recovery
- Daily: `npm run backup` (consistent SQLite snapshot + uploads into `data/backups/<time>/`); copy off the server (cron + rclone/S3).
- Restore: stop the app, replace `data/electromart.db` (delete `-wal`/`-shm`) and `uploads/` from a backup, start. Test a restore quarterly.
