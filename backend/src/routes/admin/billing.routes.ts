/**
 * Client self-service billing (PDF §3 step 9, §10, §12 phase 4): current plan, invoices, pay,
 * change plan, buy add-on modules & premium themes, request setup/custom design service.
 */
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/knex';
import { tq, tinsert } from '../../db/tenant-scope';
import { currentAuth, currentTenant } from '../../context/request-context';
import { body } from '../../middleware/common';
import { requirePermission } from '../../middleware/auth';
import { badRequest, notFound } from '../../lib/http-error';
import { offsetPaginate } from '../../lib/pagination';
import { audit } from '../../lib/audit';
import { addMonths } from '../../lib/util';
import { createInvoice, createPlanInvoice, startInvoicePayment, verifyInvoicePayment, platformSettings } from '../../services/billing.service';
import { effectiveLimits, enabledModules } from '../../services/access.service';

export const billingRouter = Router();
billingRouter.use(requirePermission('BILLING_MANAGE'));

billingRouter.get('/', async (_req, res) => {
  const t = currentTenant();
  const [tenant, sub, limits, mods, usage, plans, addons, unbilledFees] = await Promise.all([
    db('tenants as t').join('plans as p', 'p.id', 't.plan_id').where('t.id', t.id)
      .first('t.status', 't.trial_ends_at', 't.suspended_reason', 'p.id as plan_id', 'p.code', 'p.name', 'p.price_monthly', 'p.price_yearly', 'p.transaction_fee_percent'),
    tq('subscriptions').where({ is_current: 1 }).first(),
    effectiveLimits(t.id),
    enabledModules(t.id),
    Promise.all([
      tq('products').whereNot('status', 'ARCHIVED').count({ n: '*' }).first(),
      tq('users').where({ is_owner: 0 }).whereNot('status', 'DISABLED').count({ n: '*' }).first(),
      tq('media_files').sum({ s: 'size_bytes' }).first(),
    ]),
    db('plans').where({ is_active: 1, is_public: 1 }).orderBy('sort_order'),
    db('modules as m').leftJoin('tenant_modules as tm', function () { this.on('tm.module_id', '=', 'm.id').andOn('tm.tenant_id', '=', db.raw('?', [t.id])); })
      .where({ 'm.is_addon': 1, 'm.is_active': 1 })
      .select('m.id', 'm.code', 'm.name', 'm.description', 'm.addon_price_monthly', 'tm.is_enabled', 'tm.source', 'tm.expires_at'),
    tq('transaction_fees').whereNull('invoice_id').sum({ s: 'fee_amount' }).first(),
  ]);
  res.json({
    plan: tenant, subscription: sub, limits, modules: mods,
    usage: { products: Number((usage[0] as any).n), staff: Number((usage[1] as any).n), storageMb: Math.round(Number((usage[2] as any).s || 0) / 1048576) },
    plans, addons, unbilledTransactionFees: Number((unbilledFees as any)?.s || 0),
  });
});

billingRouter.get('/invoices', async (req, res) => {
  res.json(await offsetPaginate(tq('platform_invoices').select('id', 'invoice_number', 'invoice_type', 'status', 'subtotal', 'total', 'issued_at', 'due_at', 'paid_at'),
    req, [{ column: 'id', order: 'desc' }]));
});

/** GST invoice detail (printable on the frontend) */
billingRouter.get('/invoices/:id', async (req, res) => {
  const inv = await tq('platform_invoices').where({ id: Number(req.params.id) }).first();
  if (!inv) throw notFound('Invoice');
  const items = await db('platform_invoice_items').where({ invoice_id: inv.id });
  const s = await platformSettings();
  res.json({ ...inv, items, seller: { name: s.company_name, gstin: s.company_gstin, address: s.company_address, stateCode: s.company_state_code } });
});

billingRouter.post('/invoices/:id/pay', async (req, res) => {
  res.json(await startInvoicePayment(Number(req.params.id), currentTenant().id));
});

billingRouter.post('/verify-payment', body(z.object({
  razorpay_order_id: z.string(), razorpay_payment_id: z.string(), razorpay_signature: z.string(),
})), async (req, res) => {
  res.json(await verifyInvoicePayment(currentTenant().id, req.body.razorpay_order_id, req.body.razorpay_payment_id, req.body.razorpay_signature));
});

/** Upgrade / downgrade / pay to activate. Takes effect when the invoice is paid. */
billingRouter.post('/change-plan', body(z.object({ planCode: z.string(), billingCycle: z.enum(['MONTHLY', 'YEARLY']) })), async (req, res) => {
  const t = currentTenant();
  const plan = await db('plans').where({ code: req.body.planCode, is_active: 1 }).first();
  if (!plan) throw badRequest('Invalid plan');
  const limits = plan.max_products;
  if (limits != null) {
    const [{ n }] = await tq('products').whereNot('status', 'ARCHIVED').count({ n: '*' });
    if (Number(n) > limits) throw badRequest(`You have ${n} products; ${plan.name} allows ${limits}. Archive some first.`);
  }
  const now = new Date();
  const inv = await createPlanInvoice(t.id, plan.id, req.body.billingCycle, { start: now, end: addMonths(now, req.body.billingCycle === 'YEARLY' ? 12 : 1) });
  await audit('PLAN_CHANGE_REQUEST', 'plan', plan.id, null, req.body);
  res.status(201).json(inv);
});

billingRouter.post('/addons/:code', async (req, res) => {
  const t = currentTenant();
  const m = await db('modules').where({ code: req.params.code, is_addon: 1, is_active: 1 }).first();
  if (!m) throw notFound('Add-on');
  const mods = await enabledModules(t.id);
  if (mods.includes(m.code)) throw badRequest('Already enabled');
  const inv = await createInvoice(t.id, 'ADDON', [{ description: `${m.name} add-on – 1 month`, unitPrice: Number(m.addon_price_monthly), refType: 'MODULE', refId: m.id }]);
  res.status(201).json(inv);
});

billingRouter.post('/addons/:code/cancel', async (req, res) => {
  const t = currentTenant();
  const m = await db('modules').where({ code: req.params.code }).first();
  if (!m) throw notFound('Add-on');
  // stays ON until expires_at, but the renewal job only bills source = 'ADDON', so it will not renew
  await tq('tenant_modules').where({ module_id: m.id, source: 'ADDON' }).update({ source: 'MANUAL', price_monthly: 0 });
  await audit('ADDON_CANCEL', 'module', m.id, null, { tenant: t.id });
  res.json({ ok: true });
});

billingRouter.post('/themes/:id/purchase', async (req, res) => {
  const t = currentTenant();
  const th = await db('themes').where({ id: Number(req.params.id), is_premium: 1, is_active: 1 }).whereNull('owner_tenant_id').first();
  if (!th) throw notFound('Premium theme');
  if (await db('tenant_themes').where({ tenant_id: t.id, theme_id: th.id }).first()) throw badRequest('Already purchased');
  res.status(201).json(await createInvoice(t.id, 'THEME', [{ description: `Premium theme: ${th.name}`, unitPrice: Number(th.price), refType: 'THEME', refId: th.id }]));
});

billingRouter.put('/auto-renew', body(z.object({ autoRenew: z.boolean(), cancelAtPeriodEnd: z.boolean().optional() })), async (req, res) => {
  await tq('subscriptions').where({ is_current: 1 }).update({ auto_renew: req.body.autoRenew, cancel_at_period_end: req.body.cancelAtPeriodEnd ?? false });
  await audit('SUBSCRIPTION_UPDATE', 'subscription', null, null, req.body);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ service requests (₹5,000 setup, custom design, custom module)
billingRouter.get('/service-requests', async (req, res) => {
  res.json(await offsetPaginate(tq('service_requests'), req, [{ column: 'id', order: 'desc' }]));
});
billingRouter.post('/service-requests', body(z.object({
  requestType: z.enum(['STORE_SETUP', 'CUSTOM_DESIGN', 'CUSTOM_MODULE', 'EXCLUSIVE_THEME', 'OTHER']),
  title: z.string().min(3).max(200), description: z.string().max(5000).optional(),
})), async (req, res) => {
  const t = currentTenant();
  const s = await platformSettings();
  const quoted = req.body.requestType === 'STORE_SETUP' ? Number(s.setup_service_fee || 5000) : null;
  const id = await tinsert('service_requests', { request_type: req.body.requestType, title: req.body.title,
    description: req.body.description ?? null, quoted_amount: quoted, status: quoted ? 'QUOTED' : 'NEW', created_by: currentAuth().id });
  let invoice = null;
  if (quoted) {
    invoice = await createInvoice(t.id, 'SETUP', [{ description: 'Store setup service', unitPrice: quoted, refType: 'SERVICE_REQUEST', refId: id }]);
    await tq('service_requests').where({ id }).update({ invoice_id: invoice.id });
  }
  res.status(201).json({ id, invoice });
});
