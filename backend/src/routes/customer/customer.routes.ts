/**
 * Customer accounts — separate per shop (PDF §4: customers buy products and track orders)
 */
import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { tq, tinsert } from '../../db/tenant-scope';
import { currentAuth, currentTenant, ctx } from '../../context/request-context';
import { body, rateLimit } from '../../middleware/common';
import { requireAuth } from '../../middleware/auth';
import { issueRefresh, revokeRefresh, rotateRefresh, signAccess } from '../../lib/jwt';
import { HttpError, conflict, notFound } from '../../lib/http-error';
import { cursorPaginate } from '../../lib/pagination';
import { changeOrderStatus, orderDetail } from '../../services/order.service';

export const customerRouter = Router();

const tokens = async (id: number) => {
  const t = currentTenant();
  return {
    accessToken: signAccess({ sub: String(id), typ: 'CUSTOMER', tid: t.id }),
    refreshToken: await issueRefresh('CUSTOMER', id, t.id, ctx()?.ip),
  };
};

customerRouter.post('/auth/register', rateLimit('cust-reg', 10, 3600), body(z.object({
  name: z.string().min(2).max(120), mobile: z.string().regex(/^[0-9+\- ]{10,20}$/),
  email: z.string().email().optional().nullable(), password: z.string().min(8).max(100),
})), async (req, res) => {
  const b = req.body;
  const existing = await tq('customers').where({ mobile: b.mobile }).first();
  const hash = await bcrypt.hash(b.password, 12);
  let id: number;
  if (existing) {
    if (existing.password_hash) throw conflict('An account with this mobile already exists. Please login.');
    // guest customer from an earlier checkout claims the account
    await tq('customers').where({ id: existing.id }).update({ name: b.name, email: b.email?.toLowerCase() ?? existing.email, password_hash: hash });
    id = Number(existing.id);
  } else {
    id = await tinsert('customers', { name: b.name, mobile: b.mobile, email: b.email?.toLowerCase() ?? null, password_hash: hash });
  }
  res.status(201).json(await tokens(id));
});

customerRouter.post('/auth/login', rateLimit('cust-login', 10, 60), body(z.object({
  login: z.string().min(3), password: z.string().min(1),
})), async (req, res) => {
  const login = req.body.login.trim().toLowerCase();
  const c = await tq('customers').where((w) => w.where('mobile', login).orWhere('email', login)).first();
  if (!c || !c.password_hash || !(await bcrypt.compare(req.body.password, c.password_hash))) {
    throw new HttpError(401, 'BAD_CREDENTIALS', 'Wrong mobile/email or password');
  }
  if (c.status !== 'ACTIVE') throw new HttpError(403, 'BLOCKED', 'Account blocked');
  await tq('customers').where({ id: c.id }).update({ last_login_at: new Date() });
  res.json(await tokens(Number(c.id)));
});

customerRouter.post('/auth/refresh', body(z.object({ refreshToken: z.string() })), async (req, res) => {
  const t = currentTenant();
  const r = await rotateRefresh(req.body.refreshToken, 'CUSTOMER', t.id);
  if (!r) throw new HttpError(401, 'REFRESH_INVALID', 'Please login again');
  res.json({ accessToken: signAccess({ sub: String(r.subjectId), typ: 'CUSTOMER', tid: t.id }), refreshToken: r.newToken });
});

customerRouter.post('/auth/logout', body(z.object({ refreshToken: z.string() })), async (req, res) => {
  await revokeRefresh(req.body.refreshToken);
  res.status(204).end();
});

customerRouter.use(requireAuth('CUSTOMER'));

customerRouter.get('/me', async (_req, res) => {
  const c = await tq('customers').where({ id: currentAuth().id }).first('id', 'name', 'mobile', 'email', 'created_at');
  res.json(c);
});

customerRouter.put('/me', body(z.object({ name: z.string().min(2).max(120), email: z.string().email().nullable().optional() })), async (req, res) => {
  await tq('customers').where({ id: currentAuth().id }).update({ name: req.body.name, email: req.body.email?.toLowerCase() ?? null });
  res.json({ ok: true });
});

customerRouter.get('/orders', async (req, res) => {
  res.json(await cursorPaginate(tq('orders').where({ customer_id: currentAuth().id })
    .select('id', 'order_number', 'status', 'payment_status', 'grand_total', 'placed_at'), req));
});

customerRouter.get('/orders/:number', async (req, res) => {
  const o = await orderDetail({ order_number: req.params.number, customer_id: currentAuth().id });
  res.json(o);
});

customerRouter.post('/orders/:number/cancel', async (req, res) => {
  const o = await tq('orders').where({ order_number: req.params.number, customer_id: currentAuth().id }).first();
  if (!o) throw notFound('Order');
  if (o.status !== 'PENDING') throw new HttpError(400, 'CANNOT_CANCEL', 'Only pending orders can be cancelled');
  res.json(await changeOrderStatus(Number(o.id), 'CANCELLED', 'Cancelled by customer', null));
});

const addressSchema = z.object({
  name: z.string().min(2).max(120), mobile: z.string().min(8).max(20), line1: z.string().min(3).max(200),
  line2: z.string().max(200).nullable().optional(), city: z.string().min(2), state: z.string().min(2),
  pincode: z.string().regex(/^\d{6}$/), isDefault: z.boolean().default(false),
});
customerRouter.get('/addresses', async (_req, res) => {
  res.json(await tq('customer_addresses').where({ customer_id: currentAuth().id }).orderBy('is_default', 'desc'));
});
customerRouter.post('/addresses', body(addressSchema), async (req, res) => {
  const { isDefault, ...a } = req.body;
  if (isDefault) await tq('customer_addresses').where({ customer_id: currentAuth().id }).update({ is_default: 0 });
  const id = await tinsert('customer_addresses', { ...a, customer_id: currentAuth().id, is_default: isDefault ? 1 : 0 });
  res.status(201).json({ id });
});
customerRouter.delete('/addresses/:id', async (req, res) => {
  await tq('customer_addresses').where({ id: Number(req.params.id), customer_id: currentAuth().id }).delete();
  res.status(204).end();
});
