/**
 * Create / reset the Super Admin login (admin.myshop.com).
 *   npm run seed:superadmin -- admin@myshop.com "StrongPassword123" "Owner Name"
 */
import bcrypt from 'bcryptjs';
import { db } from '../db/knex';

async function main() {
  const [email, password, name = 'Super Admin'] = process.argv.slice(2);
  if (!email || !password || password.length < 10) {
    console.error('Usage: npm run seed:superadmin -- <email> <password min 10 chars> [name]');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 12);
  await db.raw(`INSERT INTO platform_users (email, password_hash, name) VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), name = VALUES(name), is_active = 1`, [email.toLowerCase(), hash, name]);
  console.log(`Super admin ready: ${email}`);
  await db.destroy();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
