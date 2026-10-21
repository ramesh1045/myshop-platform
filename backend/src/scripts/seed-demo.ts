/**
 * Demo data: "Kavya Textiles" (kavya.<PLATFORM_DOMAIN>) on Pro plan with categories & products.
 *   npm run seed:demo
 * Login: owner@kavya.test / Password@123
 */
import { db } from '../db/knex';
import { provisionTenant } from '../services/provisioning.service';
import { closeCache } from '../cache/cache';
import { notificationQueue, scheduledQueue } from '../lib/queue';

async function main() {
  const exists = await db('tenants').where({ subdomain: 'kavya' }).first('id');
  if (exists) { console.log('Demo store already exists'); return finish(); }
  const r = await provisionTenant({
    storeName: 'Kavya Textiles', ownerName: 'Kavya', email: 'owner@kavya.test', mobile: '9876543210',
    password: 'Password@123', subdomain: 'kavya', planCode: 'PRO', billingCycle: 'MONTHLY', startTrial: true,
  });
  const tid = r.tenantId;
  const cats = [['Sarees', 'sarees'], ['Kurtis', 'kurtis'], ['Dhotis', 'dhotis']];
  const catIds: number[] = [];
  for (const [i, [name, slug]] of cats.entries()) {
    const [id] = await db('categories').insert({ tenant_id: tid, name, slug, sort_order: i });
    catIds.push(Number(id));
  }
  const products = [
    ['Kanchipuram Silk Saree', 'kanchipuram-silk-saree', 0, 8999, 10999, 12],
    ['Chettinad Cotton Saree', 'chettinad-cotton-saree', 0, 1899, 2299, 30],
    ['Printed Cotton Kurti', 'printed-cotton-kurti', 1, 699, 899, 50],
    ['Anarkali Kurti', 'anarkali-kurti', 1, 1299, null, 20],
    ['Pure Cotton Dhoti', 'pure-cotton-dhoti', 2, 499, 599, 100],
    ['Silk Border Dhoti', 'silk-border-dhoti', 2, 999, 1199, 3],
  ] as const;
  for (const [name, slug, c, price, mrp, stock] of products) {
    const [pid] = await db('products').insert({ tenant_id: tid, category_id: catIds[c], name, slug, price, compare_at_price: mrp,
      stock_qty: stock, status: 'ACTIVE', is_featured: price > 900 ? 1 : 0, gst_rate: price > 1000 ? 12 : 5, hsn_code: '5007',
      short_description: `${name} – handpicked from Tamil Nadu weavers` });
    await db('product_images').insert({ tenant_id: tid, product_id: pid, url: `https://picsum.photos/seed/${slug}/600/750`, sort_order: 0 });
  }
  await db('coupons').insert({ tenant_id: tid, code: 'WELCOME10', discount_type: 'PERCENT', discount_value: 10, max_discount: 500, min_order_amount: 500 });
  console.log('Demo store "Kavya Textiles" created -> kavya subdomain, owner@kavya.test / Password@123');
  return finish();
}
async function finish() {
  await Promise.allSettled([db.destroy(), closeCache(), notificationQueue.close(), scheduledQueue.close()]);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
