/**
 * Products, categories, images (PDF §3 step 4, §12 phase 1) + coupons (phase 5)
 */
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { db } from '../../db/knex';
import { tq, tinsert, safePatch } from '../../db/tenant-scope';
import { currentAuth, currentTenant } from '../../context/request-context';
import { body } from '../../middleware/common';
import { requireModule, requirePermission } from '../../middleware/auth';
import { badRequest, notFound } from '../../lib/http-error';
import { offsetPaginate } from '../../lib/pagination';
import { audit } from '../../lib/audit';
import { uniqueSlug } from '../../lib/util';
import { assertProductLimit, assertStorageLimit } from '../../services/access.service';
import { deleteObject, putObject } from '../../lib/storage';
import { invalidate, keys } from '../../cache/cache';
import { attachImages } from '../public/storefront.routes';
import { crudRouter } from '../crud';

export const catalogRouter = Router();
const sfInvalidate = () => invalidate(keys.storefront(currentTenant().id));

// ------------------------------------------------------------------ products
const productSchema = z.object({
  name: z.string().min(2).max(200),
  slug: z.string().max(220).optional(),
  categoryId: z.number().int().nullable().optional(),
  shortDescription: z.string().max(500).nullable().optional(),
  description: z.string().max(100_000).nullable().optional(),
  sku: z.string().max(64).nullable().optional(),
  price: z.number().nonnegative(),
  compareAtPrice: z.number().nonnegative().nullable().optional(),
  costPrice: z.number().nonnegative().nullable().optional(),
  trackInventory: z.boolean().optional(),
  stockQty: z.number().int().optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
  isFeatured: z.boolean().optional(),
  hsnCode: z.string().max(10).nullable().optional(),
  gstRate: z.number().min(0).max(28).optional(),
  weightGrams: z.number().int().nonnegative().nullable().optional(),
  seoTitle: z.string().max(200).nullable().optional(),
  seoDescription: z.string().max(500).nullable().optional(),
});
const productRow = (b: any) => ({
  name: b.name, category_id: b.categoryId, short_description: b.shortDescription, description: b.description,
  sku: b.sku === '' ? null : b.sku, price: b.price, compare_at_price: b.compareAtPrice, cost_price: b.costPrice,
  track_inventory: b.trackInventory, stock_qty: b.stockQty, status: b.status, is_featured: b.isFeatured,
  hsn_code: b.hsnCode, gst_rate: b.gstRate, weight_grams: b.weightGrams, seo_title: b.seoTitle, seo_description: b.seoDescription,
});
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

async function assertCategory(categoryId: number | null | undefined) {
  if (categoryId == null) return;
  if (!(await tq('categories').where({ id: categoryId }).first('id'))) throw badRequest('Category not found');
}

catalogRouter.get('/products', requirePermission('PRODUCT_VIEW'), async (req, res) => {
  const t = currentTenant();
  const q = tq('products as p')
    .leftJoin('categories as c', function () { this.on('c.id', '=', 'p.category_id').andOn('c.tenant_id', '=', 'p.tenant_id'); })
    .select('p.id', 'p.name', 'p.slug', 'p.sku', 'p.price', 'p.compare_at_price', 'p.stock_qty', 'p.track_inventory',
      'p.status', 'p.is_featured', 'p.created_at', 'c.name as category_name');
  if (req.query.status) q.where('p.status', String(req.query.status));
  if (req.query.categoryId) q.where('p.category_id', Number(req.query.categoryId));
  if (req.query.q) q.where((w) => w.where('p.name', 'like', `%${req.query.q}%`).orWhere('p.sku', 'like', `%${req.query.q}%`));
  if (req.query.lowStock === '1') q.where('p.track_inventory', 1).where('p.stock_qty', '<=', 5);
  const page = await offsetPaginate<any>(q, req, [{ column: 'p.created_at', order: 'desc' }, { column: 'p.id', order: 'desc' }]);
  res.json({ ...page, items: await attachImages(page.items, t.id) });
});

catalogRouter.get('/products/:id', requirePermission('PRODUCT_VIEW'), async (req, res) => {
  const p = await tq('products').where({ id: Number(req.params.id) }).first();
  if (!p) throw notFound('Product');
  const images = await tq('product_images').where({ product_id: p.id }).orderBy('sort_order');
  res.json({ ...p, images });
});

catalogRouter.post('/products', requirePermission('PRODUCT_CREATE'), body(productSchema), async (req, res) => {
  const t = currentTenant();
  await assertProductLimit(t.id);
  await assertCategory(req.body.categoryId);
  const row = clean(productRow(req.body));
  row.slug = await uniqueSlug(db, 'products', t.id, req.body.slug || req.body.name);
  const id = await tinsert('products', row);
  await audit('PRODUCT_CREATE', 'product', id, null, row);
  await sfInvalidate();
  res.status(201).json(await tq('products').where({ id }).first());
});

catalogRouter.put('/products/:id', requirePermission('PRODUCT_EDIT'), body(productSchema.partial()), async (req, res) => {
  const t = currentTenant();
  const id = Number(req.params.id);
  const old = await tq('products').where({ id }).first();
  if (!old) throw notFound('Product');
  if (req.body.status && req.body.status !== 'ARCHIVED' && old.status === 'ARCHIVED') await assertProductLimit(t.id);
  await assertCategory(req.body.categoryId);
  const patch = safePatch(clean(productRow(req.body)));
  if (req.body.slug) patch.slug = await uniqueSlug(db, 'products', t.id, req.body.slug, id);
  await tq('products').where({ id }).update(patch);
  await audit('PRODUCT_UPDATE', 'product', id, old, patch);
  await sfInvalidate();
  res.json(await tq('products').where({ id }).first());
});

/** Products that appear in orders are archived, not deleted (order history keeps working) */
catalogRouter.delete('/products/:id', requirePermission('PRODUCT_DELETE'), async (req, res) => {
  const id = Number(req.params.id);
  const p = await tq('products').where({ id }).first();
  if (!p) throw notFound('Product');
  const used = await tq('order_items').where({ product_id: id }).first('id');
  if (used) {
    await tq('products').where({ id }).update({ status: 'ARCHIVED' });
    await audit('PRODUCT_ARCHIVE', 'product', id);
    await sfInvalidate();
    return res.json({ archived: true });
  }
  const imgs = await tq('product_images').where({ product_id: id }).pluck('storage_key');
  await tq('products').where({ id }).delete();
  await Promise.allSettled(imgs.filter(Boolean).map((k: string) => deleteObject(k)));
  await audit('PRODUCT_DELETE', 'product', id, p);
  await sfInvalidate();
  res.status(204).end();
});

catalogRouter.post('/products/:id/images', requirePermission('PRODUCT_EDIT'), body(z.object({
  url: z.string().max(500), storageKey: z.string().max(300).nullable().optional(), altText: z.string().max(200).nullable().optional(),
})), async (req, res) => {
  const pid = Number(req.params.id);
  if (!(await tq('products').where({ id: pid }).first('id'))) throw notFound('Product');
  const [{ m }] = await tq('product_images').where({ product_id: pid }).max({ m: 'sort_order' });
  const id = await tinsert('product_images', { product_id: pid, url: req.body.url, storage_key: req.body.storageKey ?? null,
    alt_text: req.body.altText ?? null, sort_order: Number(m ?? -1) + 1 });
  res.status(201).json({ id });
});

catalogRouter.put('/products/:id/images/order', requirePermission('PRODUCT_EDIT'), body(z.object({ imageIds: z.array(z.number().int()) })), async (req, res) => {
  const pid = Number(req.params.id);
  await db.transaction(async (trx) => {
    for (const [i, imgId] of req.body.imageIds.entries()) {
      await tq('product_images', trx).where({ id: imgId, product_id: pid }).update({ sort_order: i });
    }
  });
  res.json({ ok: true });
});

catalogRouter.delete('/products/:id/images/:imageId', requirePermission('PRODUCT_EDIT'), async (req, res) => {
  const img = await tq('product_images').where({ id: Number(req.params.imageId), product_id: Number(req.params.id) }).first();
  if (!img) throw notFound('Image');
  await tq('product_images').where({ id: img.id }).delete();
  res.status(204).end();
});

// ------------------------------------------------------------------ categories
const categorySchema = z.object({
  name: z.string().min(1).max(120), slug: z.string().max(140).optional(), parentId: z.number().int().nullable().optional(),
  description: z.string().max(5000).nullable().optional(), imageUrl: z.string().max(500).nullable().optional(),
  sortOrder: z.number().int().optional(), isActive: z.boolean().optional(),
  seoTitle: z.string().max(200).nullable().optional(), seoDescription: z.string().max(500).nullable().optional(),
});
const categoryRow = (b: any) => clean({
  name: b.name, parent_id: b.parentId, description: b.description, image_url: b.imageUrl, sort_order: b.sortOrder,
  is_active: b.isActive, seo_title: b.seoTitle, seo_description: b.seoDescription,
});

catalogRouter.get('/categories', requirePermission('CATEGORY_MANAGE', 'PRODUCT_VIEW'), async (_req, res) => {
  res.json(await tq('categories as c')
    .select('c.*', db.raw('(SELECT COUNT(*) FROM products p WHERE p.tenant_id = c.tenant_id AND p.category_id = c.id) AS product_count'))
    .orderBy(['c.sort_order', 'c.name']));
});
catalogRouter.post('/categories', requirePermission('CATEGORY_MANAGE'), body(categorySchema), async (req, res) => {
  const t = currentTenant();
  if (req.body.parentId) await assertCategory(req.body.parentId);
  const row = categoryRow(req.body);
  row.slug = await uniqueSlug(db, 'categories', t.id, req.body.slug || req.body.name);
  const id = await tinsert('categories', row);
  await audit('CATEGORY_CREATE', 'category', id, null, row);
  await sfInvalidate();
  res.status(201).json(await tq('categories').where({ id }).first());
});
catalogRouter.put('/categories/:id', requirePermission('CATEGORY_MANAGE'), body(categorySchema.partial()), async (req, res) => {
  const t = currentTenant();
  const id = Number(req.params.id);
  if (!(await tq('categories').where({ id }).first('id'))) throw notFound('Category');
  if (req.body.parentId === id) throw badRequest('A category cannot be its own parent');
  if (req.body.parentId) await assertCategory(req.body.parentId);
  const patch = safePatch(categoryRow(req.body));
  if (req.body.slug) patch.slug = await uniqueSlug(db, 'categories', t.id, req.body.slug, id);
  await tq('categories').where({ id }).update(patch);
  await audit('CATEGORY_UPDATE', 'category', id, null, patch);
  await sfInvalidate();
  res.json(await tq('categories').where({ id }).first());
});
catalogRouter.delete('/categories/:id', requirePermission('CATEGORY_MANAGE'), async (req, res) => {
  const id = Number(req.params.id);
  await db.transaction(async (trx) => {
    await tq('products', trx).where({ category_id: id }).update({ category_id: null });
    await tq('categories', trx).where({ parent_id: id }).update({ parent_id: null });
    const n = await tq('categories', trx).where({ id }).delete();
    if (!n) throw notFound('Category');
  });
  await audit('CATEGORY_DELETE', 'category', id);
  await sfInvalidate();
  res.status(204).end();
});

// ------------------------------------------------------------------ media upload (S3 + CDN)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'];

catalogRouter.post('/media', requirePermission('MEDIA_UPLOAD', 'THEME_MANAGE', 'PAGE_MANAGE', 'BLOG_MANAGE'), upload.single('file'), async (req, res) => {
  const t = currentTenant();
  const f = req.file;
  if (!f) throw badRequest('file is required');
  if (!ALLOWED.includes(f.mimetype)) throw badRequest('Only image files are allowed');
  await assertStorageLimit(t.id, f.size);
  const obj = await putObject(t.uuid, f.originalname, f.mimetype, f.buffer);
  const id = await tinsert('media_files', { storage_key: obj.key, url: obj.url, mime_type: f.mimetype, size_bytes: f.size,
    original_name: f.originalname.slice(0, 255), uploaded_by: currentAuth().id });
  res.status(201).json({ id, url: obj.url, storageKey: obj.key });
});

catalogRouter.get('/media', requirePermission('MEDIA_UPLOAD', 'THEME_MANAGE', 'PAGE_MANAGE'), async (req, res) => {
  res.json(await offsetPaginate(tq('media_files').select('id', 'url', 'mime_type', 'size_bytes', 'original_name', 'created_at'), req,
    [{ column: 'id', order: 'desc' }]));
});

// ------------------------------------------------------------------ coupons (module COUPONS)
catalogRouter.use('/coupons', requireModule('COUPONS'), requirePermission('COUPON_MANAGE'), crudRouter({
  table: 'coupons', entity: 'coupon',
  schema: z.object({
    code: z.string().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/), description: z.string().max(255).nullable().optional(),
    discountType: z.enum(['PERCENT', 'FLAT']), discountValue: z.number().positive(),
    maxDiscount: z.number().positive().nullable().optional(), minOrderAmount: z.number().nonnegative().optional(),
    startsAt: z.coerce.date().nullable().optional(), endsAt: z.coerce.date().nullable().optional(),
    usageLimit: z.number().int().positive().nullable().optional(), usagePerCustomer: z.number().int().positive().nullable().optional(),
    isActive: z.boolean().optional(),
  }),
  toRow: (b) => ({
    code: b.code?.toUpperCase(), description: b.description, discount_type: b.discountType, discount_value: b.discountValue,
    max_discount: b.maxDiscount, min_order_amount: b.minOrderAmount, starts_at: b.startsAt, ends_at: b.endsAt,
    usage_limit: b.usageLimit, usage_per_customer: b.usagePerCustomer, is_active: b.isActive,
  }),
  searchColumns: ['code', 'description'],
}));
