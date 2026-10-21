/**
 * Headless API (PDF §9: "client wants a separate website -> headless API (API key)", higher plan).
 * The client's own website calls these with X-API-Key. Cursor pagination (PDF §8 "APIs").
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { tq } from '../../db/tenant-scope';
import { currentTenant } from '../../context/request-context';
import { body, rateLimit } from '../../middleware/common';
import { requireApiKey } from '../../middleware/auth';
import { cursorPaginate } from '../../lib/pagination';
import { forbidden, notFound } from '../../lib/http-error';
import { attachImages } from '../public/storefront.routes';
import { orderDetail, placeOrder } from '../../services/order.service';

export const headlessRouter = Router();
headlessRouter.use(requireApiKey, rateLimit('headless', 1200, 60));

const scope = (s: string) => (req: Request, _res: Response, next: NextFunction) =>
  ((req as any).apiScopes as string[]).includes(s) ? next() : next(forbidden(`API key lacks scope ${s}`));

const COLS = ['p.id', 'p.name', 'p.slug', 'p.short_description', 'p.description', 'p.sku', 'p.price', 'p.compare_at_price',
  'p.stock_qty', 'p.category_id', 'p.gst_rate', 'p.updated_at'];

headlessRouter.get('/v1/store', (_req, res) => {
  const t = currentTenant();
  res.json({ name: t.name, subdomain: t.subdomain, currency: t.currency, primaryDomain: t.primaryDomain });
});
headlessRouter.get('/v1/categories', scope('catalog:read'), async (_req, res) => {
  res.json(await tq('categories').where({ is_active: 1 }).select('id', 'parent_id', 'name', 'slug', 'description', 'image_url'));
});
headlessRouter.get('/v1/products', scope('catalog:read'), async (req, res) => {
  const q = tq('products as p').where('p.status', 'ACTIVE').select(COLS);
  if (req.query.categoryId) q.where('p.category_id', Number(req.query.categoryId));
  const page = await cursorPaginate<any>(q, req, 'p.id', 100);
  res.json({ ...page, items: await attachImages(page.items, currentTenant().id) });
});
headlessRouter.get('/v1/products/:slug', scope('catalog:read'), async (req, res) => {
  const p = await tq('products as p').where({ 'p.slug': req.params.slug, 'p.status': 'ACTIVE' }).first(COLS);
  if (!p) throw notFound('Product');
  res.json((await attachImages([p], currentTenant().id))[0]);
});
headlessRouter.post('/v1/orders', scope('orders:write'), body(z.object({
  items: z.array(z.object({ productId: z.number().int(), quantity: z.number().int().min(1) })).min(1),
  customer: z.object({ name: z.string().min(2), mobile: z.string().min(8), email: z.string().email().optional().nullable() }),
  address: z.object({ line1: z.string(), line2: z.string().optional().nullable(), city: z.string(), state: z.string(), pincode: z.string().regex(/^\d{6}$/) }),
  paymentMethod: z.enum(['COD', 'RAZORPAY']), couponCode: z.string().optional().nullable(), notes: z.string().optional().nullable(),
})), async (req, res) => {
  res.status(201).json(await placeOrder(req.body));
});
headlessRouter.get('/v1/orders/:number', scope('orders:read'), async (req, res) => {
  res.json(await orderDetail({ order_number: req.params.number }));
});
