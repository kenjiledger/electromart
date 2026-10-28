// Owner password recovery. Requires shell access to the server (the only supported reset path for the single owner).
import readline from 'node:readline/promises';
const { q, now } = await import('../src/db.js');
const { hashPassword, checkPasswordStrength, destroyUserSessions } = await import('../src/auth.js');
const { config } = await import('../src/config.js');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const pw = await rl.question(`New password for owner "${config.ownerUsername}" (min 12 chars, letters+numbers): `);
rl.close();
checkPasswordStrength(pw, { owner: true });
const o = q.get("SELECT id FROM users WHERE role='owner'");
if (o) { q.run('UPDATE users SET pass_hash=?, must_change_password=0, updated_at=? WHERE id=?', hashPassword(pw), now(), o.id); destroyUserSessions(o.id); }
else q.run("INSERT INTO users(role,username,name,pass_hash,email_verified,created_at,updated_at) VALUES('owner',?,?,?,1,?,?)", config.ownerUsername, config.ownerUsername, hashPassword(pw), now(), now());
console.log('Owner password updated; all owner sessions were signed out.');
