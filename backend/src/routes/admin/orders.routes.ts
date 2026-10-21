/**
 * Orders, customers, dashboard, reports — PDF §3 step 7 (Billing Staff sees Orders only),
 * §8 offset pagination for admin pages, §12 phase 5 reports
 */
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/knex';
import { tq } from '../../db/tenant-scope';
import { currentAuth, currentTenant } from '../../context/request-context';
import { body } from '../../middleware/common';
import { requireModule, requirePermission } from '../../middleware/auth';
import { forbidden, notFound } from '../../lib/http-error';
import { offsetPaginate } from '../../lib/pagination';
import { audit } from '../../lib/audit';
import { changeOrderStatus, orderDetail } from '../../services/order.service';
import { userPermissions } from '../../services/access.service';

export const ordersRouter = Router();

// ------------------------------------------------------------------ orders
ordersRouter.get('/orders', requirePermission('ORDER_VIEW'), async (req, res) => {
  const q = tq('orders').select('id', 'order_number', 'customer_name', 'customer_mobile', 'status', 'payment_method',
    'payment_status', 'grand_total', 'placed_at');
  if (req.query.status) q.where('status', String(req.query.status));
  if (req.query.paymentStatus) q.where('payment_status', String(req.query.paymentStatus));
  if (req.query.from) q.where('created_at', '>=', new Date(String(req.query.from)));
  if (req.query.to) q.where('created_at', '<', new Date(new Date(String(req.query.to)).getTime() + 86400_000));
  if (req.query.q) {
    const s = String(req.query.q);
    q.where((w) => w.where('order_number', 'like', `%${s}%`).orWhere('customer_mobile', 'like', `%${s}%`).orWhere('customer_name', 'like', `%${s}%`));
  }
  // index (tenant_id, status, created_at) serves this (PDF §8)
  res.json(await offsetPaginate(q, req, [{ column: 'created_at', order: 'desc' }, { column: 'id', order: 'desc' }]));
});

ordersRouter.get('/orders/:id', requirePermission('ORDER_VIEW'), async (req, res) => {
  res.json(await orderDetail({ id: Number(req.params.id) }));
});

ordersRouter.put('/orders/:id/status', requirePermission('ORDER_UPDATE', 'ORDER_CANCEL'), body(z.object({
  status: z.enum(['CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED']),
  note: z.string().max(500).nullable().optional(),
  trackingNumber: z.string().max(100).nullable().optional(),
  courierName: z.string().max(100).nullable().optional(),
})), async (req, res) => {
  const a = currentAuth();
  const t = currentTenant();
  const perms = await userPermissions(t.id, a.id, !!a.isOwner);
  const needed = req.body.status === 'CANCELLED' ? 'ORDER_CANCEL' : 'ORDER_UPDATE';
  if (!perms.includes(needed)) throw forbidden(`Missing permission: ${needed}`);
  const r = await changeOrderStatus(Number(req.params.id), req.body.status, req.body.note ?? null, a.id,
    { trackingNumber: req.body.trackingNumber, courierName: req.body.courierName });
  await audit('ORDER_STATUS', 'order', String(req.params.id), null, req.body);
  res.json(r);
});

// ------------------------------------------------------------------ customers
ordersRouter.get('/customers', requirePermission('CUSTOMER_VIEW'), async (req, res) => {
  const q = tq('customers as c').select('c.id', 'c.name', 'c.mobile', 'c.email', 'c.status', 'c.created_at',
    db.raw('(SELECT COUNT(*) FROM orders o WHERE o.tenant_id = c.tenant_id AND o.customer_id = c.id) AS order_count'),
    db.raw(`(SELECT COALESCE(SUM(o.grand_total),0) FROM orders o WHERE o.tenant_id = c.tenant_id AND o.customer_id = c.id AND o.status NOT IN ('CANCELLED','RETURNED')) AS total_spent`));
  if (req.query.q) {
    const s = `%${req.query.q}%`;
    q.where((w) => w.where('c.name', 'like', s).orWhere('c.mobile', 'like', s).orWhere('c.email', 'like', s));
  }
  res.json(await offsetPaginate(q, req, [{ column: 'c.created_at', order: 'desc' }]));
});

ordersRouter.get('/customers/:id', requirePermission('CUSTOMER_VIEW'), async (req, res) => {
  const c = await tq('customers').where({ id: Number(req.params.id) }).first('id', 'name', 'mobile', 'email', 'status', 'created_at', 'last_login_at');
  if (!c) throw notFound('Customer');
  const [orders, addresses] = await Promise.all([
    tq('orders').where({ customer_id: c.id }).orderBy('id', 'desc').limit(50)
      .select('id', 'order_number', 'status', 'payment_status', 'grand_total', 'placed_at'),
    tq('customer_addresses').where({ customer_id: c.id }),
  ]);
  res.json({ ...c, orders, addresses });
});

ordersRouter.put('/customers/:id/status', requirePermission('CUSTOMER_MANAGE'), body(z.object({ status: z.enum(['ACTIVE', 'BLOCKED']) })), async (req, res) => {
  const n = await tq('customers').where({ id: Number(req.params.id) }).update({ status: req.body.status });
  if (!n) throw notFound('Customer');
  await audit('CUSTOMER_STATUS', 'customer', String(req.params.id), null, req.body);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ dashboard
ordersRouter.get('/dashboard', requirePermission('DASHBOARD_VIEW'), async (_req, res) => {
  const t = currentTenant();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const valid = (q: any) => q.whereNotIn('status', ['CANCELLED', 'RETURNED']);
  const [todayStats, monthStats, pending, lowStock, products, customers, recent] = await Promise.all([
    valid(tq('orders').where('created_at', '>=', today)).first(db.raw('COUNT(*) AS orders'), db.raw('COALESCE(SUM(grand_total),0) AS revenue')),
    valid(tq('orders').where('created_at', '>=', monthStart)).first(db.raw('COUNT(*) AS orders'), db.raw('COALESCE(SUM(grand_total),0) AS revenue')),
    tq('orders').where('status', 'PENDING').count({ n: '*' }).first(),
    tq('products').where({ status: 'ACTIVE', track_inventory: 1 }).where('stock_qty', '<=', 5).count({ n: '*' }).first(),
    tq('products').whereNot('status', 'ARCHIVED').count({ n: '*' }).first(),
    tq('customers').count({ n: '*' }).first(),
    tq('orders').orderBy('id', 'desc').limit(8).select('id', 'order_number', 'customer_name', 'status', 'grand_total', 'placed_at'),
  ]);
  res.json({
    today: todayStats, month: monthStats, pendingOrders: Number((pending as any).n), lowStock: Number((lowStock as any).n),
    products: Number((products as any).n), customers: Number((customers as any).n), recentOrders: recent, store: t.name,
  });
});

// ------------------------------------------------------------------ reports (module REPORTS)
ordersRouter.get('/reports/sales', requireModule('REPORTS'), requirePermission('REPORT_VIEW'), async (req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 86400_000);
  const to = req.query.to ? new Date(new Date(String(req.query.to)).getTime() + 86400_000) : new Date(Date.now() + 86400_000);
  const base = () => tq('orders').where('created_at', '>=', from).where('created_at', '<', to);
  const [summary, daily, byStatus, byPayment, topProducts] = await Promise.all([
    base().whereNotIn('status', ['CANCELLED', 'RETURNED']).first(
      db.raw('COUNT(*) AS orders'), db.raw('COALESCE(SUM(grand_total),0) AS revenue'),
      db.raw('COALESCE(AVG(grand_total),0) AS avg_order_value'), db.raw('COALESCE(SUM(discount_total),0) AS discounts'),
      db.raw('COALESCE(SUM(tax_total),0) AS tax')),
    base().whereNotIn('status', ['CANCELLED', 'RETURNED'])
      .select(db.raw('DATE(created_at) AS day'), db.raw('COUNT(*) AS orders'), db.raw('SUM(grand_total) AS revenue'))
      .groupByRaw('DATE(created_at)').orderBy('day'),
    base().select('status').count({ n: '*' }).groupBy('status'),
    base().select('payment_method').count({ n: '*' }).sum({ amount: 'grand_total' }).groupBy('payment_method'),
    tq('order_items as oi').join('orders as o', function () { this.on('o.id', '=', 'oi.order_id').andOn('o.tenant_id', '=', 'oi.tenant_id'); })
      .where('o.created_at', '>=', from).where('o.created_at', '<', to).whereNotIn('o.status', ['CANCELLED', 'RETURNED'])
      .select('oi.product_id', 'oi.product_name').sum({ qty: 'oi.quantity', revenue: 'oi.line_total' })
      .groupBy('oi.product_id', 'oi.product_name').orderBy('revenue', 'desc').limit(10),
  ]);
  res.json({ from, to, summary, daily, byStatus, byPayment, topProducts });
});
