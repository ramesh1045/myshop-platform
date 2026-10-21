/**
 * Daily renewal job (Worker — PDF §6 "renewals", §12 phase 4 auto-renewal):
 *   trial ending -> invoice; period ending -> renewal invoice (plan + add-ons + 1% fees);
 *   unpaid after grace -> store suspended (PDF §3 step 9); reminders before expiry.
 */
import { db } from '../db/knex';
import { addDays, addMonths, afterCommit } from '../lib/util';
import { createPlanInvoice, invalidateTenant, platformSettings, InvoiceItemInput } from '../services/billing.service';
import { sendEmail } from '../lib/queue';
import { logger } from '../lib/logger';
import { publicUrl, subdomainHost } from '../config/env';

export async function runRenewals(now = new Date()) {
  const s = await platformSettings();
  const graceDays = Number(s.grace_days || 7);
  const stats = { reminders: 0, invoiced: 0, suspended: 0, cancelled: 0 };

  // 1. reminders 3 days before the period ends
  const soon = await db('subscriptions as s').join('tenants as t', 't.id', 's.tenant_id')
    .where('s.is_current', 1).whereIn('s.status', ['ACTIVE', 'TRIALING'])
    .whereBetween('s.current_period_end', [addDays(now, 2), addDays(now, 3)])
    .select('s.*', 't.owner_email', 't.name', 't.subdomain');
  for (const sub of soon) {
    const already = await db('notifications').where({ tenant_id: sub.tenant_id, template: 'renewal_reminder' })
      .where('created_at', '>', addDays(now, -2)).first('id');
    if (already) continue;
    await sendEmail({ tenantId: sub.tenant_id, to: sub.owner_email, template: 'renewal_reminder',
      subject: `${sub.status === 'TRIALING' ? 'Trial' : 'Subscription'} ends on ${new Date(sub.current_period_end).toDateString()}`,
      payload: { storeName: sub.name, endsAt: sub.current_period_end, billingUrl: publicUrl(subdomainHost(sub.subdomain), '/admin/billing') } });
    stats.reminders++;
  }

  // 2. trials & paid periods that ended -> invoice (or cancel)
  const due = await db('subscriptions').where({ is_current: 1 }).whereIn('status', ['ACTIVE', 'TRIALING'])
    .where('current_period_end', '<=', now);
  for (const sub of due) {
    try {
      await db.transaction(async (trx) => {
        const tenant = await trx('tenants').where({ id: sub.tenant_id }).forUpdate().first();
        if (sub.status === 'ACTIVE' && (sub.cancel_at_period_end || !sub.auto_renew)) {
          await trx('subscriptions').where({ id: sub.id }).update({ status: 'CANCELLED' });
          await trx('tenants').where({ id: sub.tenant_id }).update({ status: 'CANCELLED' });
          stats.cancelled++;
          return;
        }
        const start = sub.status === 'TRIALING' ? now : new Date(sub.current_period_end);
        const end = addMonths(start, sub.billing_cycle === 'YEARLY' ? 12 : 1);
        const exists = await trx('platform_invoices').where({ tenant_id: sub.tenant_id, invoice_type: 'SUBSCRIPTION', status: 'ISSUED' })
          .where('period_start', start).first('id');
        if (!exists) {
          const extras: InvoiceItemInput[] = [];
          const addons = await trx('tenant_modules as tm').join('modules as m', 'm.id', 'tm.module_id')
            .where({ 'tm.tenant_id': sub.tenant_id, 'tm.source': 'ADDON', 'tm.is_enabled': 1 }).where('tm.price_monthly', '>', 0)
            .select('m.id', 'm.name', 'tm.price_monthly');
          const months = sub.billing_cycle === 'YEARLY' ? 12 : 1;
          for (const a of addons) extras.push({ description: `${a.name} add-on – ${months} month(s)`, unitPrice: Number(a.price_monthly), quantity: months, refType: 'MODULE', refId: a.id });
          const fees = await trx('transaction_fees').where({ tenant_id: sub.tenant_id }).whereNull('invoice_id').select('id', 'fee_amount');
          const feeTotal = fees.reduce((a: number, f: any) => a + Number(f.fee_amount), 0);
          if (feeTotal > 0) extras.push({ description: `Transaction fees (${fees.length} orders)`, unitPrice: Math.round(feeTotal * 100) / 100, refType: 'TXN_FEE' });
          const inv = await createPlanInvoice(sub.tenant_id, sub.plan_id, sub.billing_cycle, { start, end }, extras, trx);
          if (fees.length) await trx('transaction_fees').whereIn('id', fees.map((f: any) => f.id)).update({ invoice_id: inv.id });
          if (inv.status !== 'PAID') {
            afterCommit(trx, () => sendEmail({ tenantId: sub.tenant_id, to: tenant.owner_email, template: 'invoice_due', subject: `Invoice ${inv.invoiceNumber} – please pay to keep your store live`,
              payload: { storeName: tenant.name, invoiceNumber: inv.invoiceNumber, total: inv.total, graceDays, billingUrl: publicUrl(subdomainHost(tenant.subdomain), '/admin/billing') } }));
          }
          stats.invoiced++;
          if (inv.status === 'PAID') return; // free plan auto-renewed
        }
        await trx('subscriptions').where({ id: sub.id }).update({ status: 'PAST_DUE', grace_until: addDays(now, graceDays) });
        await trx('tenants').where({ id: sub.tenant_id }).whereNotIn('status', ['SUSPENDED']).update({ status: 'PAST_DUE' });
      });
      await invalidateTenant(sub.tenant_id);
    } catch (e) {
      logger.error({ err: e, tenant: sub.tenant_id }, 'renewal failed');
    }
  }

  // 3. grace period over and still unpaid -> suspend store
  const overdue = await db('subscriptions as s').join('tenants as t', 't.id', 's.tenant_id')
    .where('s.is_current', 1).where('s.status', 'PAST_DUE').where('s.grace_until', '<=', now)
    .whereNot('t.status', 'SUSPENDED').select('s.tenant_id', 't.owner_email', 't.name');
  for (const o of overdue) {
    await db('tenants').where({ id: o.tenant_id }).update({ status: 'SUSPENDED', suspended_at: now, suspended_reason: 'Payment overdue' });
    await invalidateTenant(o.tenant_id);
    await sendEmail({ tenantId: o.tenant_id, to: o.owner_email, template: 'store_suspended', subject: `${o.name} is suspended`,
      payload: { storeName: o.name, reason: 'Payment overdue' } });
    stats.suspended++;
  }
  logger.info(stats, 'renewal run complete');
  return stats;
}
