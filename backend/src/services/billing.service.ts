/**
 * Platform billing — your revenue (PDF §10) & self-service (PDF §12 phase 4):
 * subscriptions, auto-renewal invoices, GST invoices, add-on modules, premium themes,
 * setup/custom-design services, optional 1% transaction fee.
 * Payments go to YOUR Razorpay account (PLATFORM_RAZORPAY_*).
 */
import type { Knex } from 'knex';
import { db } from '../db/knex';
import { env } from '../config/env';
import { HttpError, badRequest, notFound } from '../lib/http-error';
import { createRazorpayOrder, verifyCheckoutSignature } from '../lib/razorpay';
import { addMonths, round2, afterCommit } from '../lib/util';
import { invalidate, keys } from '../cache/cache';
import { audit } from '../lib/audit';
import { sendEmail } from '../lib/queue';

export async function platformSettings(): Promise<Record<string, string>> {
  const rows = await db('platform_settings').select('setting_key', 'setting_value');
  return Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value ?? '']));
}

export function fyLabel(d = new Date()): string {
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1; // Indian FY starts 1 April
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

async function nextInvoiceNumber(trx: Knex.Transaction, prefix: string): Promise<string> {
  const fy = fyLabel();
  await trx.raw('INSERT INTO invoice_sequences (fy_label, value) VALUES (?, 0) ON DUPLICATE KEY UPDATE value = value', [fy]);
  const row = await trx('invoice_sequences').where({ fy_label: fy }).forUpdate().first();
  const n = Number(row.value) + 1;
  await trx('invoice_sequences').where({ fy_label: fy }).update({ value: n });
  return `${prefix}/${fy}/${String(n).padStart(6, '0')}`;
}

export interface InvoiceItemInput {
  description: string; unitPrice: number; quantity?: number; refType?: string; refId?: number;
}

/** Creates a GST invoice: CGST+SGST when client is in your state, otherwise IGST. */
export async function createInvoice(
  tenantId: number,
  type: 'SUBSCRIPTION' | 'ADDON' | 'THEME' | 'SETUP' | 'CUSTOM_DESIGN' | 'TRANSACTION_FEE' | 'OTHER',
  items: InvoiceItemInput[],
  opts: { subscriptionId?: number; periodStart?: Date; periodEnd?: Date; dueDays?: number } = {},
  trxIn?: Knex.Transaction,
) {
  const run = async (trx: Knex.Transaction) => {
    const s = await platformSettings();
    const tenant = await trx('tenants').where({ id: tenantId }).first();
    if (!tenant) throw notFound('Tenant');
    const gstRate = Number(s.gst_rate || 18);
    const lines = items.map((i) => ({ ...i, quantity: i.quantity ?? 1, amount: round2((i.quantity ?? 1) * i.unitPrice) }));
    const subtotal = round2(lines.reduce((a, l) => a + l.amount, 0));
    const pos = tenant.state_code || s.company_state_code || null;
    const intra = !!pos && pos === s.company_state_code;
    const half = round2((subtotal * gstRate) / 200);
    const igst = round2((subtotal * gstRate) / 100);
    const tax = intra ? { cgst_rate: gstRate / 2, cgst_amount: half, sgst_rate: gstRate / 2, sgst_amount: half }
      : { igst_rate: gstRate, igst_amount: igst };
    const total = round2(subtotal + (intra ? half * 2 : igst));

    const number = await nextInvoiceNumber(trx, s.invoice_prefix || 'MS');
    const [id] = await trx('platform_invoices').insert({
      invoice_number: number, tenant_id: tenantId, subscription_id: opts.subscriptionId ?? null, invoice_type: type,
      status: total === 0 ? 'PAID' : 'ISSUED',
      bill_to_name: tenant.legal_name || tenant.name, bill_to_gstin: tenant.gstin,
      bill_to_address: [tenant.address_line1, tenant.address_line2, tenant.city, tenant.state, tenant.pincode].filter(Boolean).join(', ') || null,
      place_of_supply: pos, subtotal, ...tax, total,
      period_start: opts.periodStart ?? null, period_end: opts.periodEnd ?? null,
      due_at: new Date(Date.now() + (opts.dueDays ?? 7) * 86400_000),
      paid_at: total === 0 ? new Date() : null,
    });
    await trx('platform_invoice_items').insert(lines.map((l) => ({
      invoice_id: id, description: l.description, sac_code: s.sac_code || '998314', quantity: l.quantity,
      unit_price: l.unitPrice, amount: l.amount, ref_type: l.refType ?? null, ref_id: l.refId ?? null,
    })));
    if (total === 0) await applyInvoicePaid(Number(id), trx);
    return { id: Number(id), invoiceNumber: number, total, status: total === 0 ? 'PAID' : 'ISSUED' };
  };
  return trxIn ? run(trxIn) : db.transaction(run);
}

/** Creates a Razorpay order on YOUR account for an invoice */
export async function startInvoicePayment(invoiceId: number, tenantId: number) {
  const inv = await db('platform_invoices').where({ id: invoiceId, tenant_id: tenantId }).first();
  if (!inv) throw notFound('Invoice');
  if (inv.status !== 'ISSUED') throw badRequest('Invoice is not payable');
  if (!env.PLATFORM_RAZORPAY_KEY_ID || !env.PLATFORM_RAZORPAY_KEY_SECRET) {
    throw new HttpError(503, 'BILLING_NOT_CONFIGURED', 'Online payment is not configured. Please contact support.');
  }
  const order = await createRazorpayOrder(
    { keyId: env.PLATFORM_RAZORPAY_KEY_ID, keySecret: env.PLATFORM_RAZORPAY_KEY_SECRET },
    Number(inv.total), inv.invoice_number, { invoice_id: String(inv.id), tenant_id: String(tenantId) },
  );
  await db('platform_invoices').where({ id: inv.id }).update({ razorpay_order_id: order.id });
  await db('platform_payments').insert({
    tenant_id: tenantId, invoice_id: inv.id, razorpay_order_id: order.id, amount: inv.total, status: 'CREATED',
  });
  return { keyId: env.PLATFORM_RAZORPAY_KEY_ID, razorpayOrderId: order.id, amount: Number(inv.total), invoiceNumber: inv.invoice_number };
}

export async function verifyInvoicePayment(tenantId: number, razorpayOrderId: string, paymentId: string, signature: string) {
  if (!verifyCheckoutSignature(env.PLATFORM_RAZORPAY_KEY_SECRET, razorpayOrderId, paymentId, signature)) {
    throw badRequest('Payment signature mismatch');
  }
  return markPlatformPaymentCaptured(razorpayOrderId, paymentId, null, tenantId);
}

export async function markPlatformPaymentCaptured(razorpayOrderId: string, paymentId: string, raw: unknown, tenantId?: number) {
  return db.transaction(async (trx) => {
    const inv = await trx('platform_invoices').where({ razorpay_order_id: razorpayOrderId }).forUpdate().first();
    if (!inv || (tenantId && Number(inv.tenant_id) !== tenantId)) throw notFound('Invoice');
    if (inv.status === 'PAID') return { invoiceId: inv.id, alreadyPaid: true };
    await trx('platform_payments').where({ razorpay_order_id: razorpayOrderId })
      .update({ razorpay_payment_id: paymentId, status: 'CAPTURED', raw_payload: raw ? JSON.stringify(raw) : null });
    await applyInvoicePaid(Number(inv.id), trx);
    return { invoiceId: inv.id, alreadyPaid: false };
  });
}

/**
 * Invoice paid -> apply its effects:
 *   PLAN_MONTHLY/PLAN_YEARLY -> plan + new subscription period, store ACTIVE again
 *   MODULE -> add-on module ON; THEME -> premium theme unlocked; SERVICE_REQUEST -> accepted
 */
export async function applyInvoicePaid(invoiceId: number, trx: Knex.Transaction) {
  const inv = await trx('platform_invoices').where({ id: invoiceId }).first();
  const tenantId = Number(inv.tenant_id);
  await trx('platform_invoices').where({ id: invoiceId }).update({ status: 'PAID', paid_at: inv.paid_at ?? new Date() });
  const items = await trx('platform_invoice_items').where({ invoice_id: invoiceId });

  for (const it of items) {
    if (it.ref_type === 'PLAN_MONTHLY' || it.ref_type === 'PLAN_YEARLY') {
      const plan = await trx('plans').where({ id: it.ref_id }).first();
      const cycle = it.ref_type === 'PLAN_YEARLY' ? 'YEARLY' : 'MONTHLY';
      const start = inv.period_start ? new Date(inv.period_start) : new Date();
      const end = inv.period_end ? new Date(inv.period_end) : addMonths(start, cycle === 'YEARLY' ? 12 : 1);
      await trx('subscriptions').where({ tenant_id: tenantId, is_current: 1 }).update({
        plan_id: plan.id, billing_cycle: cycle, status: 'ACTIVE', amount: it.unit_price,
        current_period_start: start, current_period_end: end, grace_until: null,
      });
      const prev = await trx('tenants').where({ id: tenantId }).first('plan_id');
      await trx('tenants').where({ id: tenantId }).update({
        plan_id: plan.id, status: 'ACTIVE', suspended_at: null, suspended_reason: null, trial_ends_at: null,
      });
      if (Number(prev.plan_id) !== Number(plan.id)) await syncPlanModules(tenantId, Number(plan.id), trx);
      // add-ons follow the subscription period
      await trx('tenant_modules').where({ tenant_id: tenantId, source: 'ADDON', is_enabled: 1 }).update({ expires_at: end });
    } else if (it.ref_type === 'MODULE') {
      const sub = await trx('subscriptions').where({ tenant_id: tenantId, is_current: 1 }).first();
      const expires = sub && new Date(sub.current_period_end) > new Date() ? sub.current_period_end : addMonths(new Date(), 1);
      await trx.raw(
        `INSERT INTO tenant_modules (tenant_id, module_id, is_enabled, source, price_monthly, enabled_at, expires_at)
         VALUES (?, ?, 1, 'ADDON', ?, NOW(3), ?)
         ON DUPLICATE KEY UPDATE is_enabled = 1, source = IF(source = 'PLAN', 'PLAN', 'ADDON'),
           price_monthly = VALUES(price_monthly), expires_at = IF(source = 'PLAN', NULL, VALUES(expires_at))`,
        [tenantId, it.ref_id, it.unit_price, expires],
      );
    } else if (it.ref_type === 'THEME') {
      await trx.raw(
        `INSERT INTO tenant_themes (tenant_id, theme_id, amount_paid, invoice_id) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE amount_paid = VALUES(amount_paid), invoice_id = VALUES(invoice_id)`,
        [tenantId, it.ref_id, it.amount, invoiceId],
      );
    } else if (it.ref_type === 'SERVICE_REQUEST') {
      await trx('service_requests').where({ id: it.ref_id, tenant_id: tenantId }).update({ status: 'ACCEPTED' });
    }
  }
  await audit('INVOICE_PAID', 'platform_invoice', invoiceId, null, { number: inv.invoice_number, total: inv.total }, trx, tenantId);
  // drop cached plan/modules/limits + email once the transaction has committed
  const owner = await trx('tenants').where({ id: tenantId }).first('owner_email', 'name');
  afterCommit(trx, () => invalidateTenant(tenantId));
  afterCommit(trx, () => sendEmail({
    tenantId, to: owner.owner_email, template: 'invoice_paid', subject: `Payment received – ${inv.invoice_number}`,
    payload: { invoiceNumber: inv.invoice_number, total: inv.total, storeName: owner.name },
  }));
}

/** Plan modules follow the plan; ADDON and MANUAL modules are untouched. */
export async function syncPlanModules(tenantId: number, planId: number, trx: Knex | Knex.Transaction) {
  const planMods = (await trx('plan_modules').where({ plan_id: planId }).pluck('module_id')).map(Number);
  await trx('tenant_modules').where({ tenant_id: tenantId, source: 'PLAN' })
    .modify((q) => { if (planMods.length) q.whereNotIn('module_id', planMods); }).delete();
  for (const m of planMods) {
    await trx.raw(
      `INSERT INTO tenant_modules (tenant_id, module_id, is_enabled, source) VALUES (?, ?, 1, 'PLAN')
       ON DUPLICATE KEY UPDATE is_enabled = 1, source = 'PLAN', expires_at = NULL`, [tenantId, m],
    );
  }
}

export async function invalidateTenant(tenantId: number) {
  await invalidate(keys.tenant(tenantId));
  const domains = await db('tenant_domains').where({ tenant_id: tenantId }).pluck('domain');
  await Promise.all(domains.map((d: string) => invalidate(keys.domain(d))));
}

/** Plan purchase / upgrade / renewal invoice */
export async function createPlanInvoice(tenantId: number, planId: number, cycle: 'MONTHLY' | 'YEARLY',
  period: { start: Date; end: Date }, extraItems: InvoiceItemInput[] = [], trx?: Knex.Transaction) {
  const plan = await (trx ?? db)('plans').where({ id: planId }).first();
  const sub = await (trx ?? db)('subscriptions').where({ tenant_id: tenantId, is_current: 1 }).first();
  const price = cycle === 'YEARLY' ? Number(plan.price_yearly) : Number(plan.price_monthly);
  return createInvoice(tenantId, 'SUBSCRIPTION', [
    { description: `${plan.name} plan – ${cycle === 'YEARLY' ? '12 months' : '1 month'}`, unitPrice: price,
      refType: cycle === 'YEARLY' ? 'PLAN_YEARLY' : 'PLAN_MONTHLY', refId: plan.id },
    ...extraItems,
  ], { subscriptionId: sub?.id, periodStart: period.start, periodEnd: period.end }, trx);
}

/** PDF §10: Basic plan 1% per order. Recorded once per order, billed on the next renewal. */
export async function recordTransactionFee(tenantId: number, orderId: number, orderAmount: number, trx?: Knex.Transaction) {
  const q = trx ?? db;
  const plan = await q('tenants as t').join('plans as p', 'p.id', 't.plan_id').where('t.id', tenantId).first('p.transaction_fee_percent');
  const pct = Number(plan?.transaction_fee_percent || 0);
  if (pct <= 0) return;
  await q.raw(
    `INSERT IGNORE INTO transaction_fees (tenant_id, order_id, order_amount, fee_percent, fee_amount) VALUES (?, ?, ?, ?, ?)`,
    [tenantId, orderId, orderAmount, pct, round2((orderAmount * pct) / 100)],
  );
}
