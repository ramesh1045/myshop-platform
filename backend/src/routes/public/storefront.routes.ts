/**
 * Customer-facing storefront API (kavya.myshop.com / kavyatextiles.com) — PDF §4 Customer, §5.4, §8, §9
 */
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/knex';
import { tq, tinsert } from '../../db/tenant-scope';
import { ctx, currentTenant } from '../../context/request-context';
import { storefrontConfig } from '../../services/storefront.service';
import { verifyAccess } from '../../lib/jwt';
import { cursorPaginate } from '../../lib/pagination';
import { HttpError, badRequest, notFound } from '../../lib/http-error';
import { body, rateLimit } from '../../middleware/common';
import { optionalCustomer, requireModule } from '../../middleware/auth';
import { confirmRazorpayPayment, evaluateCoupon, markOrderPaid, orderDetail, placeOrder } from '../../services/order.service';
import { decrypt } from '../../lib/crypto';
import { verifyWebhookSignature } from '../../lib/razorpay';
import { sendEmail } from '../../lib/queue';
import { publicUrl } from '../../config/env';
import { enabledModules } from '../../services/access.service';

export const storefrontRouter = Router();

/** Batch-load images for many products in ONE query (avoids N+1 — PDF §8) */
export async function attachImages<T extends { id: number }>(products: T[], tenantId: number) {
  if (!products.length) return products as (T & { images: any[] })[];
  const imgs = await db('product_images').where('tenant_id', tenantId)
    .whereIn('product_id', products.map((p) => p.id)).orderBy(['product_id', 'sort_order'])
    .select('product_id', 'url', 'alt_text');
  const by = new Map<number, any[]>();
  for (const i of imgs) {
    const l = by.get(Number(i.product_id)) ?? [];
    l.push({ url: i.url, alt: i.alt_text });
    by.set(Number(i.product_id), l);
  }
  return products.map((p) => ({ ...p, images: by.get(Number(p.id)) ?? [] }));
}

const PUBLIC_PRODUCT_COLS = ['p.id', 'p.name', 'p.slug', 'p.short_description', 'p.price', 'p.compare_at_price',
  'p.stock_qty', 'p.track_inventory', 'p.is_featured', 'p.category_id', 'p.gst_rate'];

storefrontRouter.use(rateLimit('public', 600, 60));

// ---------------------------------------------------------------- config
storefrontRouter.get('/storefront-config', async (req, res) => {
  const tenant = currentTenant();
  let stage: 'PUBLISHED' | 'DRAFT' = 'PUBLISHED';
  if (req.query.preview) {
    try {
      const c = verifyAccess(String(req.query.preview));
      if (c.typ === 'PREVIEW' && Number(c.tid) === tenant.id) stage = 'DRAFT';
    } catch { /* invalid preview token -> published */ }
  }
  res.setHeader('Cache-Control', stage === 'DRAFT' ? 'no-store' : 'public, max-age=60');
  res.json(await storefrontConfig(tenant, stage));
});

// ---------------------------------------------------------------- catalogue
storefrontRouter.get('/categories', async (_req, res) => {
  res.json(await tq('categories').where({ is_active: 1 }).orderBy(['sort_order', 'name'])
    .select('id', 'parent_id', 'name', 'slug', 'description', 'image_url'));
});

/** Infinite scroll list -> cursor (keyset) pagination (PDF §8) */
storefrontRouter.get('/products', async (req, res) => {
  const tenant = currentTenant();
  const q = tq('products as p').where('p.status', 'ACTIVE').select(PUBLIC_PRODUCT_COLS);
  if (req.query.category) {
    const cat = await tq('categories').where({ slug: String(req.query.category) }).first('id');
    if (!cat) return res.json({ items: [], nextCursor: null });
    const childIds = await tq('categories').where({ parent_id: cat.id }).pluck('id');
    q.whereIn('p.category_id', [cat.id, ...childIds]);
  }
  if (req.query.q) {
    const term = String(req.query.q).slice(0, 80);
    q.where((w) => w.whereRaw('MATCH(p.name, p.short_description) AGAINST (? IN BOOLEAN MODE)', [`${term}*`])
      .orWhere('p.name', 'like', `%${term}%`));
  }
  if (req.query.featured === '1') q.where('p.is_featured', 1);
  const page = await cursorPaginate<any>(q, req, 'p.id', 48);
  res.json({ ...page, items: await attachImages(page.items, tenant.id) });
});

storefrontRouter.get('/products/:slug', async (req, res) => {
  const tenant = currentTenant();
  const p = await tq('products as p').where({ 'p.slug': req.params.slug, 'p.status': 'ACTIVE' })
    .leftJoin('categories as c', function () {
      this.on('c.id', '=', 'p.category_id').andOn('c.tenant_id', '=', 'p.tenant_id');
    })
    .first([...PUBLIC_PRODUCT_COLS, 'p.description', 'p.sku', 'p.seo_title', 'p.seo_description', 'c.name as category_name', 'c.slug as category_slug']);
  if (!p) throw notFound('Product');
  const [withImages] = await attachImages([p], tenant.id);
  const related = p.category_id
    ? await attachImages(await tq('products as p').where({ 'p.status': 'ACTIVE', 'p.category_id': p.category_id })
      .whereNot('p.id', p.id).limit(4).select(PUBLIC_PRODUCT_COLS), tenant.id)
    : [];
  res.json({ ...withImages, related });
});

// ---------------------------------------------------------------- CMS pages & forms (PDF §9)
storefrontRouter.get('/pages/:slug', async (req, res) => {
  const page = await tq('pages').where({ slug: req.params.slug, status: 'PUBLISHED' })
    .first('id', 'title', 'slug', 'published_sections as sections', 'seo_title', 'seo_description');
  if (!page) throw notFound('Page');
  // embed forms used inside the page
  const formIds = (page.sections as any[]).filter((s) => s.type === 'FORM').map((s) => s.config?.formId).filter(Boolean);
  const forms = formIds.length ? await tq('forms').whereIn('id', formIds).where({ is_active: 1 }).select('id', 'name', 'fields', 'success_message') : [];
  res.json({ ...page, forms });
});

storefrontRouter.get('/forms/:id', async (req, res) => {
  const f = await tq('forms').where({ id: Number(req.params.id), is_active: 1 }).first('id', 'name', 'fields', 'success_message');
  if (!f) throw notFound('Form');
  res.json(f);
});

storefrontRouter.post('/forms/:id/submit', rateLimit('form', 10, 600), async (req, res) => {
  const tenant = currentTenant();
  const form = await tq('forms').where({ id: Number(req.params.id), is_active: 1 }).first();
  if (!form) throw notFound('Form');
  const data: Record<string, string> = {};
  for (const f of form.fields as any[]) {
    const v = String(req.body?.[f.key] ?? '').trim().slice(0, 2000);
    if (f.required && !v) throw badRequest(`${f.label} is required`);
    if (v) data[f.key] = v;
  }
  await tinsert('form_submissions', { form_id: form.id, data: JSON.stringify(data), ip: ctx()?.ip ?? null });
  if (form.notify_email) {
    await sendEmail({ tenantId: tenant.id, to: form.notify_email, template: 'form_submission',
      subject: `New "${form.name}" submission`, payload: { formName: form.name, data } });
  }
  res.status(201).json({ message: form.success_message });
});

// ---------------------------------------------------------------- Blog add-on (PDF §9)
storefrontRouter.get('/blog', requireModule('BLOG'), async (req, res) => {
  res.json(await cursorPaginate(tq('blog_posts').where({ status: 'PUBLISHED' })
    .select('id', 'title', 'slug', 'excerpt', 'cover_image_url', 'published_at'), req));
});
storefrontRouter.get('/blog/:slug', requireModule('BLOG'), async (req, res) => {
  const p = await tq('blog_posts').where({ slug: req.params.slug, status: 'PUBLISHED' }).first();
  if (!p) throw notFound('Post');
  res.json(p);
});

// ---------------------------------------------------------------- Booking add-on (PDF §9)
storefrontRouter.get('/booking/services', requireModule('BOOKING'), async (_req, res) => {
  res.json(await tq('booking_services').where({ is_active: 1 }).select('id', 'name', 'description', 'duration_minutes', 'price'));
});
storefrontRouter.get('/booking/slots', requireModule('BOOKING'), async (req, res) => {
  const svc = await tq('booking_services').where({ id: Number(req.query.serviceId), is_active: 1 }).first();
  if (!svc) throw notFound('Service');
  const date = String(req.query.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('date must be YYYY-MM-DD');
  const taken = await tq('bookings').where({ service_id: svc.id, booking_date: date }).whereNot('status', 'CANCELLED')
    .groupBy('start_time').select('start_time').count({ n: '*' });
  const used = new Map(taken.map((t: any) => [String(t.start_time).slice(0, 5), Number(t.n)]));
  const slots: { time: string; available: boolean }[] = [];
  for (let m = 9 * 60; m + svc.duration_minutes <= 20 * 60; m += svc.duration_minutes) {
    const time = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    slots.push({ time, available: (used.get(time) ?? 0) < svc.slots_per_time });
  }
  res.json(slots);
});
storefrontRouter.post('/booking', requireModule('BOOKING'), rateLimit('booking', 10, 600), body(z.object({
  serviceId: z.number().int(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/),
  name: z.string().min(2).max(120), mobile: z.string().min(8).max(20), email: z.string().email().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
})), async (req, res) => {
  const b = req.body;
  const tenant = currentTenant();
  const id = await db.transaction(async (trx) => {
    const svc = await tq('booking_services', trx).where({ id: b.serviceId, is_active: 1 }).forUpdate().first();
    if (!svc) throw notFound('Service');
    const [{ n }] = await tq('bookings', trx).where({ service_id: svc.id, booking_date: b.date, start_time: b.time })
      .whereNot('status', 'CANCELLED').count({ n: '*' });
    if (Number(n) >= svc.slots_per_time) throw badRequest('This slot is already booked');
    return tinsert('bookings', { service_id: svc.id, customer_name: b.name, customer_mobile: b.mobile,
      customer_email: b.email ?? null, booking_date: b.date, start_time: b.time, notes: b.notes ?? null }, trx);
  });
  const s = await db('tenant_settings').where({ tenant_id: tenant.id }).first('store_email');
  if (s?.store_email) await sendEmail({ tenantId: tenant.id, to: s.store_email, template: 'new_booking', subject: 'New booking', payload: { ...b } });
  res.status(201).json({ id, status: 'PENDING' });
});

// ---------------------------------------------------------------- cart / checkout
storefrontRouter.post('/coupons/apply', rateLimit('coupon', 30, 60), body(z.object({
  code: z.string().min(1).max(40), subtotal: z.number().nonnegative(), mobile: z.string().optional(),
})), async (req, res) => {
  const r = await evaluateCoupon(db, currentTenant().id, req.body.code, req.body.subtotal, req.body.mobile);
  res.json({ code: r.coupon.code, discount: r.discount });
});

/** Re-price a cart from the server (client never decides prices) */
storefrontRouter.post('/cart/price', body(z.object({
  items: z.array(z.object({ productId: z.number().int(), quantity: z.number().int().min(1).max(999) })).max(100),
})), async (req, res) => {
  const tenant = currentTenant();
  const ids = req.body.items.map((i: any) => i.productId);
  const rows = ids.length ? await tq('products as p').whereIn('p.id', ids).where('p.status', 'ACTIVE').select(PUBLIC_PRODUCT_COLS) : [];
  res.json(await attachImages(rows, tenant.id));
});

const checkoutSchema = z.object({
  items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(999) })).min(1).max(100),
  customer: z.object({ name: z.string().min(2).max(120), mobile: z.string().regex(/^[0-9+\- ]{8,20}$/), email: z.string().email().optional().nullable() }),
  address: z.object({ line1: z.string().min(3).max(200), line2: z.string().max(200).optional().nullable(),
    city: z.string().min(2).max(100), state: z.string().min(2).max(100), pincode: z.string().regex(/^\d{6}$/) }),
  paymentMethod: z.enum(['COD', 'RAZORPAY']),
  couponCode: z.string().max(40).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

storefrontRouter.post('/checkout', rateLimit('checkout', 20, 600), optionalCustomer, body(checkoutSchema), async (req, res) => {
  const c = ctx()!;
  const customerId = c.auth?.type === 'CUSTOMER' ? c.auth.id : undefined;
  res.status(201).json(await placeOrder(req.body, customerId));
});

storefrontRouter.post('/payments/razorpay/verify', body(z.object({
  razorpay_order_id: z.string(), razorpay_payment_id: z.string(), razorpay_signature: z.string(),
})), async (req, res) => {
  res.json(await confirmRazorpayPayment(req.body.razorpay_order_id, req.body.razorpay_payment_id, req.body.razorpay_signature));
});

/** Client's Razorpay webhook -> https://<their-store>/api/public/payments/razorpay/webhook */
storefrontRouter.post('/payments/razorpay/webhook', async (req, res) => {
  const tenant = currentTenant();
  const s = await db('tenant_settings').where({ tenant_id: tenant.id }).first('razorpay_webhook_secret_enc');
  const secret = decrypt(s?.razorpay_webhook_secret_enc);
  const sig = String(req.headers['x-razorpay-signature'] || '');
  const rawBody: Buffer | undefined = (req as any).rawBody;
  if (!secret || !rawBody || !verifyWebhookSignature(secret, rawBody, sig)) {
    throw new HttpError(400, 'BAD_SIGNATURE', 'Invalid webhook signature');
  }
  const evt = req.body;
  if (evt.event === 'payment.captured' || evt.event === 'order.paid') {
    const p = evt.payload?.payment?.entity;
    if (p?.order_id) await markOrderPaid(tenant.id, p.order_id, p.id, evt).catch(() => undefined);
  }
  res.json({ ok: true });
});

/** Order tracking without login (order number + mobile) — PDF §4 */
storefrontRouter.post('/orders/track', rateLimit('track', 20, 600), body(z.object({
  orderNumber: z.string().min(3).max(30), mobile: z.string().min(8).max(20),
})), async (req, res) => {
  const o = await orderDetail({ order_number: req.body.orderNumber.trim().toUpperCase(), customer_mobile: req.body.mobile.trim() })
    .catch(() => null);
  if (!o) throw notFound('Order');
  res.json({
    orderNumber: o.order_number, status: o.status, paymentStatus: o.payment_status, grandTotal: o.grand_total,
    placedAt: o.placed_at, trackingNumber: o.tracking_number, courierName: o.courier_name,
    items: o.items.map((i: any) => ({ name: i.product_name, quantity: i.quantity, lineTotal: i.line_total })),
    history: o.history.map((h: any) => ({ status: h.to_status, note: h.note, at: h.created_at })),
  });
});

// ---------------------------------------------------------------- SEO (PDF §12 phase 5)
storefrontRouter.get('/sitemap.xml', async (_req, res) => {
  const tenant = currentTenant();
  const base = publicUrl(tenant.primaryDomain, '').replace(/\/$/, '');
  const [products, categories, pages, mods] = await Promise.all([
    tq('products').where({ status: 'ACTIVE' }).select('slug', 'updated_at').limit(50000),
    tq('categories').where({ is_active: 1 }).select('slug', 'updated_at'),
    tq('pages').where({ status: 'PUBLISHED' }).select('slug', 'updated_at'),
    enabledModules(tenant.id),
  ]);
  const posts = mods.includes('BLOG') ? await tq('blog_posts').where({ status: 'PUBLISHED' }).select('slug', 'updated_at') : [];
  const url = (loc: string, d?: Date) => `<url><loc>${base}${loc}</loc>${d ? `<lastmod>${new Date(d).toISOString().slice(0, 10)}</lastmod>` : ''}</url>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[
    url('/'), url('/products'),
    ...categories.map((c: any) => url(`/category/${c.slug}`, c.updated_at)),
    ...products.map((p: any) => url(`/product/${p.slug}`, p.updated_at)),
    ...pages.map((p: any) => url(`/page/${p.slug}`, p.updated_at)),
    ...posts.map((p: any) => url(`/blog/${p.slug}`, p.updated_at)),
  ].join('')}</urlset>`;
  res.type('application/xml').send(xml);
});

storefrontRouter.get('/robots.txt', (_req, res) => {
  const tenant = currentTenant();
  res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /checkout\nDisallow: /account\nSitemap: ${publicUrl(tenant.primaryDomain, '/sitemap.xml')}\n`);
});
