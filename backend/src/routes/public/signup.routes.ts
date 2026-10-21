/**
 * myshop.com — your own marketing site: features, plans, self-signup (PDF §2, §3 steps 1–3, §12 phase 4)
 */
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/knex';
import { body, rateLimit } from '../../middleware/common';
import { isSubdomainAvailable, provisionTenant } from '../../services/provisioning.service';
import { createPlanInvoice, markPlatformPaymentCaptured, startInvoicePayment, verifyInvoicePayment } from '../../services/billing.service';
import { publicUrl, subdomainHost, env } from '../../config/env';
import { sendEmail } from '../../lib/queue';
import { addMonths } from '../../lib/util';
import { verifyWebhookSignature } from '../../lib/razorpay';
import { HttpError } from '../../lib/http-error';

export const signupRouter = Router();

signupRouter.get('/plans', async (_req, res) => {
  const plans = await db('plans').where({ is_active: 1, is_public: 1 }).orderBy('sort_order');
  const pm = await db('plan_modules as pm').join('modules as m', 'm.id', 'pm.module_id').select('pm.plan_id', 'm.code', 'm.name');
  const addons = await db('modules').where({ is_addon: 1, is_active: 1 }).select('code', 'name', 'description', 'addon_price_monthly');
  const themes = await db('themes').where({ is_active: 1 }).whereNull('owner_tenant_id').select('code', 'name', 'is_premium', 'price', 'preview_image_url');
  res.json({
    plans: plans.map((p) => ({
      code: p.code, name: p.name, description: p.description, priceMonthly: p.price_monthly, priceYearly: p.price_yearly,
      trialDays: p.trial_days, maxProducts: p.max_products, maxStaff: p.max_staff, maxStorageMb: p.max_storage_mb,
      customDomain: p.allow_custom_domain, headlessApi: p.allow_headless_api, transactionFeePercent: p.transaction_fee_percent,
      modules: pm.filter((m) => m.plan_id === p.id).map((m) => ({ code: m.code, name: m.name })),
    })),
    addons, themes, platformDomain: env.PLATFORM_DOMAIN,
  });
});

signupRouter.get('/check-subdomain', rateLimit('subcheck', 60, 60), async (req, res) => {
  res.json(await isSubdomainAvailable(String(req.query.subdomain || '')));
});

const signupSchema = z.object({
  storeName: z.string().min(2).max(150),
  ownerName: z.string().min(2).max(120),
  email: z.string().email().max(190),
  mobile: z.string().regex(/^[0-9+\- ]{10,20}$/),
  password: z.string().min(8).max(100),
  subdomain: z.string().min(3).max(63),
  planCode: z.string(),
  billingCycle: z.enum(['MONTHLY', 'YEARLY']).default('MONTHLY'),
  startTrial: z.boolean().default(true),
});

/** Signup -> store auto-created; trial = live immediately, paid = live after payment */
signupRouter.post('/', rateLimit('signup', 5, 3600), body(signupSchema), async (req, res) => {
  const r = await provisionTenant(req.body);
  const host = subdomainHost(req.body.subdomain.toLowerCase());
  let payment = null;
  if (!r.trial) {
    const now = new Date();
    const inv = await createPlanInvoice(r.tenantId, Number(r.plan.id), req.body.billingCycle,
      { start: now, end: addMonths(now, req.body.billingCycle === 'YEARLY' ? 12 : 1) });
    payment = inv.status === 'PAID' ? null : await startInvoicePayment(inv.id, r.tenantId).catch((e) => ({ error: e.message, invoiceId: inv.id }));
  }
  await sendEmail({
    tenantId: r.tenantId, to: req.body.email, template: 'welcome', subject: `Your store ${req.body.storeName} is ready`,
    payload: { storeName: req.body.storeName, storeUrl: publicUrl(host), adminUrl: publicUrl(host, '/admin') },
  });
  res.status(201).json({
    tenantId: r.tenantId, trial: r.trial, storeUrl: publicUrl(host), adminUrl: publicUrl(host, '/admin/login'), payment,
  });
});

/** After paying the first invoice on the signup page */
signupRouter.post('/verify-payment', body(z.object({
  tenantId: z.number().int(), razorpay_order_id: z.string(), razorpay_payment_id: z.string(), razorpay_signature: z.string(),
})), async (req, res) => {
  res.json(await verifyInvoicePayment(req.body.tenantId, req.body.razorpay_order_id, req.body.razorpay_payment_id, req.body.razorpay_signature));
});

/** YOUR Razorpay account webhook (platform billing, incl. auto-renew charges) */
export const platformWebhookRouter = Router();
platformWebhookRouter.post('/razorpay', async (req, res) => {
  const rawBody: Buffer | undefined = (req as any).rawBody;
  const sig = String(req.headers['x-razorpay-signature'] || '');
  if (!env.PLATFORM_RAZORPAY_WEBHOOK_SECRET || !rawBody || !verifyWebhookSignature(env.PLATFORM_RAZORPAY_WEBHOOK_SECRET, rawBody, sig)) {
    throw new HttpError(400, 'BAD_SIGNATURE', 'Invalid webhook signature');
  }
  const evt = req.body;
  if (evt.event === 'payment.captured' || evt.event === 'order.paid') {
    const p = evt.payload?.payment?.entity;
    if (p?.order_id) await markPlatformPaymentCaptured(p.order_id, p.id, evt).catch(() => undefined);
  }
  res.json({ ok: true });
});
