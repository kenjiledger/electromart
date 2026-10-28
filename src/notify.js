import { q, now } from './db.js';
import { flag } from './settings.js';
import { config } from './config.js';

/**
 * Notification outbox. Messages are always recorded (visible to the owner in Admin > Outbox).
 * To deliver real email, add an SMTP / transactional-email call in `deliver()` (e.g. via a provider's HTTPS API).
 * Nothing is falsely reported as "sent": status stays 'queued' until a transport marks it.
 */
export function notify({ userId = null, to = '', subject, body, force = false }) {
  if (!force && !flag('email_notifications')) return;
  const r = q.run('INSERT INTO notifications(user_id,to_addr,subject,body,created_at) VALUES(?,?,?,?,?)', userId, to, subject, body, now());
  if (!config.prod) console.log(`[outbox] to=${to} :: ${subject}`);
  deliver(Number(r.lastInsertRowid));
}
// eslint-disable-next-line no-unused-vars
function deliver(id) { /* no transport configured */ }
