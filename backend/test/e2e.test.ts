/**
 * End-to-end tests against a running API (npm run dev) + MySQL + Redis.
 *   npm test
 * Every PDF section has at least one assertion here.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { db } from '../src/db/knex';
import { runRenewals } from '../src/jobs/renewal.job';
import { closeCache } from '../src/cache/cache';
import { notificationQueue, scheduledQueue } from '../src/lib/queue';

const API = { host: '127.0.0.1', port: Number(process.env.PORT || 3000) };
const ROOT = process.env.PLATFORM_DOMAIN || 'localhost';
const SUB = `t${Date.now().toString(36)}`;
const STORE = `${SUB}.${ROOT}`;
const KAVYA = `kavya.${ROOT}`;
const ADMIN = `admin.${ROOT}`;

function call(host: string, method: string, path: string, body?: unknown, token?: string, extra: Record<string, string> = {}) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request({ ...API, method, path, headers: {
      Host: host, 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra,
    } }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let parsed: any = buf;
        try { parsed = buf ? JSON.parse(buf) : null; } catch { /* text */ }
        resolve({ status: res.statusCode!, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const S: Record<string, any> = {};

before(async () => {
  const h = await call(ROOT, 'GET', '/api/health');
  assert.equal(h.status, 200, 'API must be running');
});
after(async () => {
  await Promise.allSettled([db.destroy(), closeCache(), notificationQueue.close(), scheduledQueue.close()]);
});

// ---------------------------------------------------------------- §2 / §3 signup + domain
test('§3 step 1-3: plans listed and reserved subdomain rejected', async () => {
  const p = await call(ROOT, 'GET', '/api/signup/plans');
  assert.equal(p.status, 200);
  assert.deepEqual(p.body.plans.map((x: any) => Number(x.priceMonthly)), [499, 999, 1999]);
  const r = await call(ROOT, 'GET', '/api/signup/check-subdomain?subdomain=admin');
  assert.equal(r.body.available, false);
});

test('§3 step 2-3: signup creates the whole store automatically, live on subdomain', async () => {
  const r = await call(ROOT, 'POST', '/api/signup', {
    storeName: 'Test Store', ownerName: 'Owner', email: `o@${SUB}.test`, mobile: '9000000001', password: 'Password@123',
    subdomain: SUB, planCode: 'BASIC', billingCycle: 'MONTHLY', startTrial: true,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  S.tenantId = r.body.tenantId;
  const cfg = await call(STORE, 'GET', '/api/public/storefront-config');
  assert.equal(cfg.status, 200);
  assert.equal(cfg.body.store.name, 'Test Store');
  assert.equal(cfg.body.theme.code, 'classic');
  const roles = await db('roles').where({ tenant_id: S.tenantId }).pluck('name');
  assert.deepEqual(roles.sort(), ['Billing Staff', 'Store Manager']);
  const menus = await db('tenant_menus').where({ tenant_id: S.tenantId }).count({ n: '*' }).first();
  assert.ok(Number((menus as any).n) > 10);
});

test('§2: unknown host -> 404, signup endpoint not available on store host', async () => {
  assert.equal((await call(`nope.${ROOT}`, 'GET', '/api/public/storefront-config')).status, 404);
  assert.equal((await call(STORE, 'GET', '/api/signup/plans')).status, 404);
});

// ---------------------------------------------------------------- §4 owner login, §6 tenant isolation
test('§4 owner login at <store>/admin and §5.2 /api/me/menus', async () => {
  const r = await call(STORE, 'POST', '/api/admin/auth/login', { email: `o@${SUB}.test`, password: 'Password@123' });
  assert.equal(r.status, 200);
  S.owner = r.body.accessToken;
  const m = await call(STORE, 'GET', '/api/me/menus', undefined, S.owner);
  assert.equal(m.status, 200);
  const codes = JSON.stringify(m.body);
  assert.ok(codes.includes('"products"') && codes.includes('"orders"') && codes.includes('"roles"'));
  assert.ok(!codes.includes('"blog"'), 'BLOG module is off on BASIC');
});

test('§6 security: token of shop A rejected on shop B (TENANT_MISMATCH)', async () => {
  const r = await call(KAVYA, 'GET', '/api/admin/products', undefined, S.owner);
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'TENANT_MISMATCH');
});

test('§6 DB level: composite FK blocks giving shop A role to shop B user', async () => {
  const kavya = await db('tenants').where({ subdomain: 'kavya' }).first('id');
  const kavyaRole = await db('roles').where({ tenant_id: kavya.id }).first('id');
  const myUser = await db('users').where({ tenant_id: S.tenantId }).first('id');
  await assert.rejects(db('user_roles').insert({ tenant_id: S.tenantId, user_id: myUser.id, role_id: kavyaRole.id }), /foreign key/i);
});

// ---------------------------------------------------------------- catalogue + storefront
test('§3 step 4: owner adds category + product; storefront shows only own products', async () => {
  const c = await call(STORE, 'POST', '/api/admin/categories', { name: 'Soaps' }, S.owner);
  assert.equal(c.status, 201);
  const p = await call(STORE, 'POST', '/api/admin/products', { name: 'Herbal Soap', price: 120, stockQty: 10, status: 'ACTIVE', categoryId: c.body.id, gstRate: 18 }, S.owner);
  assert.equal(p.status, 201, JSON.stringify(p.body));
  S.productId = p.body.id;
  const list = await call(STORE, 'GET', '/api/public/products?size=10');
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].name, 'Herbal Soap');
  const kav = await call(KAVYA, 'GET', '/api/public/products?size=50');
  assert.ok(!kav.body.items.some((x: any) => x.name === 'Herbal Soap'));
});

test('§8 cursor pagination on storefront', async () => {
  const a = await call(KAVYA, 'GET', '/api/public/products?size=2');
  assert.equal(a.body.items.length, 2);
  assert.ok(a.body.nextCursor);
  const b = await call(KAVYA, 'GET', `/api/public/products?size=2&cursor=${a.body.nextCursor}`);
  assert.ok(b.body.items[0].id < a.body.items[1].id);
});

// ---------------------------------------------------------------- §5.1 dynamic roles, §5.3 staff
test('§3 step 5 + §5.1: custom role, invite staff, staff sees only Orders (§3 step 7)', async () => {
  const perms = await call(STORE, 'GET', '/api/admin/permissions', undefined, S.owner);
  assert.equal(perms.status, 200);
  const role = await call(STORE, 'POST', '/api/admin/roles', { name: 'Cashier', permissions: ['ORDER_VIEW', 'ORDER_UPDATE'] }, S.owner);
  assert.equal(role.status, 201);
  const inv = await call(STORE, 'POST', '/api/admin/staff/invite', { email: `s1@${SUB}.test`, name: 'Staff One', roleIds: [role.body.id] }, S.owner);
  assert.equal(inv.status, 201, JSON.stringify(inv.body));
  const token = new URL(inv.body.inviteLink).searchParams.get('token');
  const acc = await call(STORE, 'POST', '/api/admin/auth/accept-invite', { token, password: 'Staff@1234' });
  assert.equal(acc.status, 200);
  S.staff = acc.body.accessToken;
  const m = await call(STORE, 'GET', '/api/me/menus', undefined, S.staff);
  assert.deepEqual(m.body.map((x: any) => x.code), ['orders']);
  assert.equal((await call(STORE, 'GET', '/api/admin/products', undefined, S.staff)).status, 403);
  assert.equal((await call(STORE, 'GET', '/api/admin/orders', undefined, S.staff)).status, 200);
  S.cashierRole = role.body.id;
});

test('§5.1: adding a permission to a role applies immediately (no code change)', async () => {
  await call(STORE, 'PUT', `/api/admin/roles/${S.cashierRole}`, { permissions: ['ORDER_VIEW', 'ORDER_UPDATE', 'PRODUCT_VIEW'] }, S.owner);
  assert.equal((await call(STORE, 'GET', '/api/admin/products', undefined, S.staff)).status, 200);
});

test('§5.3: staff limit from plan (BASIC = 2)', async () => {
  await call(STORE, 'POST', '/api/admin/staff/invite', { email: `s2@${SUB}.test`, name: 'Staff Two', roleIds: [S.cashierRole] }, S.owner);
  const r = await call(STORE, 'POST', '/api/admin/staff/invite', { email: `s3@${SUB}.test`, name: 'Staff Three', roleIds: [S.cashierRole] }, S.owner);
  assert.equal(r.status, 402);
});

test('§5.2: client renames, hides and reorders menus', async () => {
  const items = await call(STORE, 'GET', '/api/admin/menus', undefined, S.owner);
  const orders = items.body.find((i: any) => i.code === 'orders');
  const customers = items.body.find((i: any) => i.code === 'customers');
  const r = await call(STORE, 'PUT', '/api/admin/menus', { items: [
    { id: orders.id, customLabel: 'Sales', sortOrder: 1 }, { id: customers.id, isHidden: true },
  ] }, S.owner);
  assert.equal(r.status, 200);
  const m = await call(STORE, 'GET', '/api/me/menus', undefined, S.owner);
  assert.equal(m.body[0].label, 'Sales');
  assert.ok(!m.body.some((x: any) => x.code === 'customers'));
});

// ---------------------------------------------------------------- §3 step 8 checkout
test('§3 step 8: customer checkout (COD), tracking, status flow, 1% fee on BASIC (§10)', async () => {
  const o = await call(STORE, 'POST', '/api/public/checkout', {
    items: [{ productId: S.productId, quantity: 2 }], paymentMethod: 'COD',
    customer: { name: 'Buyer', mobile: '9111111111', email: 'b@x.test' },
    address: { line1: '1 Main St', city: 'Chennai', state: 'Tamil Nadu', pincode: '600001' },
  });
  assert.equal(o.status, 201, JSON.stringify(o.body));
  assert.equal(o.body.grandTotal, 240);
  S.order = o.body;
  const tr = await call(STORE, 'POST', '/api/public/orders/track', { orderNumber: o.body.orderNumber, mobile: '9111111111' });
  assert.equal(tr.body.status, 'PENDING');
  for (const s of ['CONFIRMED', 'SHIPPED', 'DELIVERED']) {
    const u = await call(STORE, 'PUT', `/api/admin/orders/${o.body.orderId}/status`, { status: s }, S.staff);
    assert.equal(u.status, 200, JSON.stringify(u.body));
  }
  const fee = await db('transaction_fees').where({ tenant_id: S.tenantId }).first();
  assert.equal(Number(fee.fee_amount), 2.4);
  const stock = await db('products').where({ id: S.productId }).first('stock_qty');
  assert.equal(stock.stock_qty, 8);
});

test('§12 phase 2: audit log records actions (cursor paginated)', async () => {
  const a = await call(STORE, 'GET', '/api/admin/audit?size=5', undefined, S.owner);
  assert.equal(a.status, 200);
  assert.ok(a.body.items.length > 0);
});

// ---------------------------------------------------------------- §5.4 theme
test('§5.4: theme draft -> live preview -> publish', async () => {
  const t = await call(STORE, 'GET', '/api/admin/theme', undefined, S.owner);
  const settings = { ...t.body.draft.settings, colors: { ...t.body.draft.settings.colors, primary: '#ff0000' } };
  const sections = [...t.body.draft.sections].reverse();
  assert.equal((await call(STORE, 'PUT', '/api/admin/theme/draft', { settings, sections }, S.owner)).status, 200);
  const pub = await call(STORE, 'GET', '/api/public/storefront-config');
  assert.notEqual(pub.body.theme.settings.colors.primary, '#ff0000', 'published must not change before publish');
  const pt = await call(STORE, 'POST', '/api/admin/theme/preview-token', {}, S.owner);
  const prev = await call(STORE, 'GET', `/api/public/storefront-config?preview=${encodeURIComponent(pt.body.token)}`);
  assert.equal(prev.body.theme.settings.colors.primary, '#ff0000');
  await call(STORE, 'POST', '/api/admin/theme/publish', {}, S.owner);
  const after = await call(STORE, 'GET', '/api/public/storefront-config');
  assert.equal(after.body.theme.settings.colors.primary, '#ff0000');
  assert.equal(after.body.theme.sections[0].id, sections[0].id);
});

test('§10: premium theme cannot be used without purchase', async () => {
  const t = await call(STORE, 'GET', '/api/admin/theme', undefined, S.owner);
  const premium = t.body.themes.find((x: any) => x.isPremium);
  const r = await call(STORE, 'PUT', '/api/admin/theme/draft', { themeId: premium.id }, S.owner);
  assert.equal(r.status, 400);
});

// ---------------------------------------------------------------- §9 page builder
test('§9: About/Contact pages exist; form submission works', async () => {
  const p = await call(STORE, 'GET', '/api/public/pages/contact');
  assert.equal(p.status, 200);
  const form = p.body.forms[0];
  const s = await call(STORE, 'POST', `/api/public/forms/${form.id}/submit`, { name: 'A', mobile: '9', message: 'Hi' });
  assert.equal(s.status, 201);
});

// ---------------------------------------------------------------- §2 custom domain + §10 Pro only
test('§10: custom domain blocked on BASIC; Super Admin upgrades to PRO; domain verify + Caddy ask', async () => {
  const blocked = await call(STORE, 'POST', '/api/admin/domains', { domain: `${SUB}-shop.com` }, S.owner);
  assert.ok([402].includes(blocked.status));

  const login = await call(ADMIN, 'POST', '/api/platform/auth/login', { email: 'admin@myshop.test', password: 'SuperAdmin@123' });
  assert.equal(login.status, 200);
  S.sa = login.body.accessToken;
  assert.equal((await call(STORE, 'GET', '/api/platform/tenants', undefined, S.sa)).status, 404, 'platform API only on admin host');
  const up = await call(ADMIN, 'PUT', `/api/platform/tenants/${S.tenantId}/plan`, { planCode: 'PRO' }, S.sa);
  assert.equal(up.status, 200);

  const d = await call(STORE, 'POST', '/api/admin/domains', { domain: `${SUB}-shop.com` }, S.owner);
  assert.equal(d.status, 201, JSON.stringify(d.body));
  const ask1 = await call(ROOT, 'GET', `/api/internal/domain-check?secret=${process.env.INTERNAL_SECRET || 'change-me-internal'}&domain=${SUB}-shop.com`);
  assert.equal(ask1.status, 404, 'no SSL for unverified domain');
  // simulate DNS verification success
  await db('tenant_domains').where({ id: d.body.id }).update({ verification_status: 'VERIFIED', verified_at: new Date() });
  const ask2 = await call(ROOT, 'GET', `/api/internal/domain-check?secret=${process.env.INTERNAL_SECRET || 'change-me-internal'}&domain=${SUB}-shop.com`);
  assert.equal(ask2.status, 200);
  const viaCustom = await call(`${SUB}-shop.com`, 'GET', '/api/public/storefront-config');
  assert.equal(viaCustom.body.store.name, 'Test Store');
});

// ---------------------------------------------------------------- §3 step 9 super admin controls
test('§3 step 9: module on/off by Super Admin', async () => {
  assert.equal((await call(STORE, 'GET', '/api/public/blog')).status, 402);
  await call(ADMIN, 'PUT', `/api/platform/tenants/${S.tenantId}/modules`, { modules: [{ code: 'BLOG', enabled: true }] }, S.sa);
  assert.equal((await call(STORE, 'GET', '/api/public/blog')).status, 200);
});

test('§3 step 9: suspend store -> storefront shows suspended, checkout & admin writes blocked; resume', async () => {
  await call(ADMIN, 'POST', `/api/platform/tenants/${S.tenantId}/suspend`, { reason: 'Unpaid' }, S.sa);
  const cfg = await call(STORE, 'GET', '/api/public/storefront-config');
  assert.equal(cfg.body.store.suspended, true);
  const co = await call(STORE, 'POST', '/api/public/checkout', { items: [{ productId: S.productId, quantity: 1 }], paymentMethod: 'COD',
    customer: { name: 'Buyer', mobile: '9111111111' }, address: { line1: '1 Main St', city: 'Chennai', state: 'TN', pincode: '600001' } });
  assert.equal(co.status, 423);
  assert.equal((await call(STORE, 'POST', '/api/admin/categories', { name: 'X' }, S.owner)).status, 423);
  await call(ADMIN, 'POST', `/api/platform/tenants/${S.tenantId}/resume`, {}, S.sa);
  assert.equal((await call(STORE, 'GET', '/api/public/storefront-config')).body.store.suspended, false);
});

test('§12 phase 5: impersonation token works on the store and is audited', async () => {
  const r = await call(ADMIN, 'POST', `/api/platform/tenants/${S.tenantId}/impersonate`, { reason: 'Support ticket #1' }, S.sa);
  assert.equal(r.status, 200);
  const token = decodeURIComponent(r.body.url.split('#token=')[1]);
  const me = await call(STORE, 'GET', '/api/me', undefined, token);
  assert.ok(me.body.impersonatedBy);
  await call(STORE, 'POST', '/api/admin/categories', { name: 'Imp Cat' }, token);
  const log = await db('audit_logs').where({ tenant_id: S.tenantId, action: 'CATEGORY_CREATE' }).whereNotNull('impersonator_id').first();
  assert.ok(log);
});

// ---------------------------------------------------------------- §12 phase 4 renewals + GST invoice
test('§12 phase 4: trial end -> GST invoice + PAST_DUE -> grace over -> SUSPENDED -> paid -> ACTIVE', async () => {
  await db('subscriptions').where({ tenant_id: S.tenantId, is_current: 1 }).update({ current_period_end: new Date(Date.now() - 1000) });
  await runRenewals();
  const sub = await db('subscriptions').where({ tenant_id: S.tenantId, is_current: 1 }).first();
  assert.equal(sub.status, 'PAST_DUE');
  const inv = await db('platform_invoices').where({ tenant_id: S.tenantId, invoice_type: 'SUBSCRIPTION', status: 'ISSUED' }).first();
  assert.ok(inv, 'renewal invoice created');
  const items = await db('platform_invoice_items').where({ invoice_id: inv.id });
  assert.ok(items.some((i: any) => i.ref_type === 'TXN_FEE'), '1% fees billed');
  assert.ok(Number(inv.cgst_amount) + Number(inv.sgst_amount) + Number(inv.igst_amount) > 0, 'GST applied');
  await db('subscriptions').where({ id: sub.id }).update({ grace_until: new Date(Date.now() - 1000) });
  await runRenewals();
  assert.equal((await db('tenants').where({ id: S.tenantId }).first('status')).status, 'SUSPENDED');
  const paid = await call(ADMIN, 'POST', `/api/platform/invoices/${inv.id}/mark-paid`, {}, S.sa);
  assert.equal(paid.status, 200);
  assert.equal((await db('tenants').where({ id: S.tenantId }).first('status')).status, 'ACTIVE');
});

// ---------------------------------------------------------------- §9 headless API
test('§9: headless API with API key (Business plan only)', async () => {
  await call(ADMIN, 'PUT', `/api/platform/tenants/${S.tenantId}/plan`, { planCode: 'BUSINESS' }, S.sa);
  await new Promise((r) => setTimeout(r, 400));
  const k = await call(STORE, 'POST', '/api/admin/api-keys', { name: 'Website', scopes: ['catalog:read'] }, S.owner);
  assert.equal(k.status, 201, JSON.stringify(k.body));
  const p = await call('anything.example', 'GET', '/api/headless/v1/products', undefined, undefined, { 'X-API-Key': k.body.key });
  assert.equal(p.status, 200);
  assert.equal(p.body.items[0].name, 'Herbal Soap');
});

test('§12 phase 5: reports, sitemap, robots', async () => {
  const r = await call(STORE, 'GET', '/api/admin/reports/sales', undefined, S.owner);
  assert.equal(r.status, 200);
  assert.ok(Number(r.body.summary.orders) >= 1);
  const sm = await call(STORE, 'GET', '/api/public/sitemap.xml');
  assert.ok(String(sm.body).includes('/product/herbal-soap'));
});

test('§12 phase 5: coupons (PRO store) — percent with cap, min order, usage counted', async () => {
  const bad = await call(KAVYA, 'POST', '/api/public/coupons/apply', { code: 'WELCOME10', subtotal: 100 });
  assert.equal(bad.status, 400, 'min order 500 enforced');
  const ok = await call(KAVYA, 'POST', '/api/public/coupons/apply', { code: 'welcome10', subtotal: 1000 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.discount, 100);
  const prod = (await call(KAVYA, 'GET', '/api/public/products/kanchipuram-silk-saree')).body;
  const o = await call(KAVYA, 'POST', '/api/public/checkout', {
    items: [{ productId: prod.id, quantity: 1 }], paymentMethod: 'COD', couponCode: 'WELCOME10',
    customer: { name: 'Coupon Buyer', mobile: '9222222222' },
    address: { line1: '5 Temple St', city: 'Kanchipuram', state: 'Tamil Nadu', pincode: '631501' },
  });
  assert.equal(o.status, 201, JSON.stringify(o.body));
  assert.equal(o.body.grandTotal, Number(prod.price) - 500, 'discount capped at max ₹500');
});
