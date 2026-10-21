import nodemailer from 'nodemailer';
import { db } from '../db/knex';
import { env } from '../config/env';
import { logger } from '../lib/logger';

const transport = env.SMTP_HOST
  ? nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined })
  : null;

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const money = (v: unknown) => `₹${Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const btn = (href: string, label: string) => `<p><a href="${esc(href)}" style="background:#1f6feb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${esc(label)}</a></p>`;

const templates: Record<string, (p: any) => string> = {
  welcome: (p) => `<h2>Welcome! ${esc(p.storeName)} is live 🎉</h2><p>Your store: <a href="${esc(p.storeUrl)}">${esc(p.storeUrl)}</a></p>${btn(p.adminUrl, 'Open admin panel')}`,
  staff_invite: (p) => `<p>Hi ${esc(p.name)},</p><p>You have been invited to manage <b>${esc(p.storeName)}</b>.</p>${btn(p.link, 'Accept invitation')}<p>The link is valid for 7 days.</p>`,
  password_reset: (p) => `<p>Click below to reset your password (valid for 1 hour).</p>${btn(p.link, 'Reset password')}`,
  order_placed: (p) => `<h3>Thank you for your order!</h3><p>Order <b>${esc(p.orderNumber)}</b> at ${esc(p.storeName)} – total ${money(p.total)}.</p>`,
  new_order_store: (p) => `<h3>New order ${esc(p.orderNumber)}</h3><p>${esc(p.customer)} – ${money(p.total)}</p>`,
  order_status: (p) => `<p>Your order <b>${esc(p.orderNumber)}</b> at ${esc(p.storeName)} is now <b>${esc(p.status)}</b>.</p>${p.trackingNumber ? `<p>Tracking: ${esc(p.trackingNumber)}</p>` : ''}`,
  form_submission: (p) => `<h3>${esc(p.formName)}</h3><table>${Object.entries(p.data || {}).map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`).join('')}</table>`,
  new_booking: (p) => `<h3>New booking</h3><p>${esc(p.name)} (${esc(p.mobile)}) – ${esc(p.date)} ${esc(p.time)}</p>`,
  invoice_due: (p) => `<p>Invoice <b>${esc(p.invoiceNumber)}</b> for ${esc(p.storeName)}: ${money(p.total)}.</p><p>Please pay within ${esc(p.graceDays)} days to keep your store live.</p>${btn(p.billingUrl, 'Pay now')}`,
  invoice_paid: (p) => `<p>We received ${money(p.total)} for invoice <b>${esc(p.invoiceNumber)}</b>. Thank you!</p>`,
  renewal_reminder: (p) => `<p>Your plan for <b>${esc(p.storeName)}</b> ends on ${esc(new Date(p.endsAt).toDateString())}.</p>${btn(p.billingUrl, 'Manage billing')}`,
  store_suspended: (p) => `<p><b>${esc(p.storeName)}</b> has been suspended. Reason: ${esc(p.reason)}.</p><p>Login to your admin panel and pay the pending invoice to reactivate.</p>`,
  domain_verified: (p) => `<p><b>${esc(p.domain)}</b> is now connected to ${esc(p.storeName)}. SSL is issued automatically.</p>`,
};

export async function processEmail(notificationId: number) {
  const n = await db('notifications').where({ id: notificationId }).first();
  if (!n || n.status === 'SENT') return;
  const render = templates[n.template] ?? ((p: any) => `<pre>${esc(JSON.stringify(p, null, 2))}</pre>`);
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">${render(n.payload || {})}</div>`;
  try {
    if (transport) {
      await transport.sendMail({ from: env.MAIL_FROM, to: n.recipient, subject: n.subject || 'Notification', html });
    } else {
      logger.info({ to: n.recipient, subject: n.subject }, '[DEV] email (SMTP not configured)');
    }
    await db('notifications').where({ id: n.id }).update({ status: 'SENT', sent_at: new Date(), attempts: n.attempts + 1 });
  } catch (e: any) {
    await db('notifications').where({ id: n.id }).update({ status: 'FAILED', last_error: String(e.message).slice(0, 500), attempts: n.attempts + 1 });
    throw e; // BullMQ retries with backoff
  }
}
