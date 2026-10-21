/**
 * Checkout & order lifecycle — PDF §3 step 8 (customers buy; money goes straight to the
 * client's own Razorpay account), §12 phase 1 (COD + Razorpay).
 */
import type { Knex } from 'knex';
import { db } from '../db/knex';
import { tq, tinsert, nextCounter } from '../db/tenant-scope';
import { currentTenant } from '../context/request-context';
import { HttpError, badRequest, notFound } from '../lib/http-error';
import { decrypt } from '../lib/crypto';
import { createRazorpayOrder, verifyCheckoutSignature } from '../lib/razorpay';
import { round2, afterCommit } from '../lib/util';
import { recordTransactionFee } from './billing.service';
import { sendEmail } from '../lib/queue';
import { enabledModules } from './access.service';

export interface CheckoutInput {
  items: { productId: number; quantity: number }[];
  customer: { name: string; mobile: string; email?: string | null };
  address: { line1: string; line2?: string | null; city: string; state: string; pincode: string };
  paymentMethod: 'COD' | 'RAZORPAY';
  couponCode?: string | null;
  notes?: string | null;
}

export const ORDER_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PACKED', 'SHIPPED', 'CANCELLED'],
  PACKED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED', 'RETURNED'],
  DELIVERED: ['RETURNED'],
  CANCELLED: [],
  RETURNED: [],
};

async function tenantRazorpayKeys(tenantId: number, trx?: Knex.Transaction) {
  const s = await (trx ?? db)('tenant_settings').where({ tenant_id: tenantId }).first();
  const secret = decrypt(s?.razorpay_key_secret_enc);
  if (!s?.razorpay_key_id || !secret) return null;
  return { keyId: s.razorpay_key_id as string, keySecret: secret, webhookSecret: decrypt(s.razorpay_webhook_secret_enc) };
}

/** Validate coupon & compute discount (shared by "apply coupon" preview and checkout) */
export async function evaluateCoupon(trx: Knex | Knex.Transaction, tenantId: number, code: string, subtotal: number, mobile?: string) {
  const mods = await enabledModules(tenantId);
  if (!mods.includes('COUPONS')) throw badRequest('Coupons are not available in this store');
  const c = await trx('coupons').where({ tenant_id: tenantId, code: code.toUpperCase().trim(), is_active: 1 }).first();
  if (!c) throw badRequest('Invalid coupon code');
  const now = new Date();
  if (c.starts_at && new Date(c.starts_at) > now) throw badRequest('Coupon not started yet');
  if (c.ends_at && new Date(c.ends_at) < now) throw badRequest('Coupon expired');
  if (c.usage_limit != null && c.used_count >= c.usage_limit) throw badRequest('Coupon usage limit reached');
  if (subtotal < Number(c.min_order_amount)) throw badRequest(`Minimum order ₹${c.min_order_amount} for this coupon`);
  if (mobile && c.usage_per_customer != null) {
    const [{ n }] = await trx('coupon_redemptions').where({ tenant_id: tenantId, coupon_id: c.id, customer_mobile: mobile }).count({ n: '*' });
    if (Number(n) >= c.usage_per_customer) throw badRequest('You have already used this coupon');
  }
  let discount = c.discount_type === 'PERCENT' ? (subtotal * Number(c.discount_value)) / 100 : Number(c.discount_value);
  if (c.max_discount != null) discount = Math.min(discount, Number(c.max_discount));
  discount = round2(Math.min(discount, subtotal));
  return { coupon: c, discount };
}

export async function placeOrder(input: CheckoutInput, customerId?: number) {
  const tenant = currentTenant();
  if (!['ACTIVE', 'TRIAL'].includes(tenant.status)) throw new HttpError(423, 'STORE_SUSPENDED', 'This store is temporarily not accepting orders');
  if (!input.items.length) throw badRequest('Cart is empty');

  return db.transaction(async (trx) => {
    const settings = await trx('tenant_settings').where({ tenant_id: tenant.id }).first();
    let rzpKeys: Awaited<ReturnType<typeof tenantRazorpayKeys>> = null;
    if (input.paymentMethod === 'COD' && !settings.cod_enabled) throw badRequest('Cash on delivery is not available');
    if (input.paymentMethod === 'RAZORPAY') {
      rzpKeys = await tenantRazorpayKeys(tenant.id, trx);
      if (!settings.online_payment_enabled || !rzpKeys) throw badRequest('Online payment is not available');
    }

    // merge duplicate lines, lock product rows (stock)
    const qty = new Map<number, number>();
    for (const i of input.items) qty.set(i.productId, (qty.get(i.productId) ?? 0) + i.quantity);
    const products = await tq('products', trx).whereIn('id', [...qty.keys()]).where('status', 'ACTIVE').forUpdate();
    if (products.length !== qty.size) throw badRequest('Some products are no longer available');

    const lines = products.map((p: any) => {
      const q = qty.get(Number(p.id))!;
      if (p.track_inventory && p.stock_qty < q) throw badRequest(`Only ${p.stock_qty} left for "${p.name}"`);
      const lineTotal = round2(Number(p.price) * q);
      const rate = Number(p.gst_rate);
      const tax = settings.prices_include_tax ? round2((lineTotal * rate) / (100 + rate)) : round2((lineTotal * rate) / 100);
      return { p, q, lineTotal, rate, tax };
    });
    const subtotal = round2(lines.reduce((a, l) => a + l.lineTotal, 0));
    if (subtotal < Number(settings.min_order_amount)) throw badRequest(`Minimum order amount is ₹${settings.min_order_amount}`);

    let discount = 0;
    let coupon: any = null;
    if (input.couponCode) {
      const r = await evaluateCoupon(trx, tenant.id, input.couponCode, subtotal, input.customer.mobile);
      discount = r.discount;
      coupon = r.coupon;
    }
    const afterDiscount = round2(subtotal - discount);
    const shipping = settings.free_shipping_above != null && afterDiscount >= Number(settings.free_shipping_above)
      ? 0 : Number(settings.shipping_flat_fee);
    // discount reduces taxable value proportionally
    const factor = subtotal > 0 ? afterDiscount / subtotal : 1;
    const taxTotal = round2(lines.reduce((a, l) => a + l.tax, 0) * factor);
    const grandTotal = round2(afterDiscount + shipping + (settings.prices_include_tax ? 0 : taxTotal));

    // customer: logged-in, or find/create guest by mobile (customers are per shop — PDF §4)
    let custId = customerId ?? null;
    if (!custId) {
      const existing = await tq('customers', trx).where({ mobile: input.customer.mobile }).first('id');
      custId = existing ? Number(existing.id) : await tinsert('customers', {
        name: input.customer.name, mobile: input.customer.mobile, email: input.customer.email?.toLowerCase() || null,
      }, trx);
    }

    const seq = await nextCounter(trx, 'order', tenant.id);
    const orderNumber = `${tenant.subdomain.replace(/[^a-z0-9]/g, '').slice(0, 3).toUpperCase()}-${String(seq).padStart(6, '0')}`;

    const orderId = await tinsert('orders', {
      order_number: orderNumber, customer_id: custId, status: 'PENDING', payment_method: input.paymentMethod,
      payment_status: 'PENDING', subtotal, discount_total: discount, shipping_fee: shipping, tax_total: taxTotal,
      grand_total: grandTotal, coupon_id: coupon?.id ?? null, coupon_code: coupon?.code ?? null,
      customer_name: input.customer.name, customer_email: input.customer.email?.toLowerCase() || null,
      customer_mobile: input.customer.mobile, ship_line1: input.address.line1, ship_line2: input.address.line2 || null,
      ship_city: input.address.city, ship_state: input.address.state, ship_pincode: input.address.pincode,
      notes: input.notes || null,
    }, trx);

    await tinsert('order_items', lines.map((l) => ({
      order_id: orderId, product_id: l.p.id, product_name: l.p.name, sku: l.p.sku, hsn_code: l.p.hsn_code,
      unit_price: l.p.price, quantity: l.q, gst_rate: l.rate, tax_amount: l.tax, line_total: l.lineTotal,
    })), trx);
    for (const l of lines) {
      if (l.p.track_inventory) await tq('products', trx).where({ id: l.p.id }).decrement('stock_qty', l.q);
    }
    await tinsert('order_status_history', { order_id: orderId, from_status: null, to_status: 'PENDING', note: 'Order placed' }, trx);

    if (coupon) {
      const updated = await tq('coupons', trx).where({ id: coupon.id })
        .where((q) => q.whereNull('usage_limit').orWhere('used_count', '<', db.ref('usage_limit')))
        .increment('used_count', 1);
      if (!updated) throw badRequest('Coupon usage limit reached');
      await tinsert('coupon_redemptions', {
        coupon_id: coupon.id, order_id: orderId, customer_id: custId, customer_mobile: input.customer.mobile, discount,
      }, trx);
    }

    let razorpay: { keyId: string; razorpayOrderId: string; amount: number } | null = null;
    if (input.paymentMethod === 'RAZORPAY' && rzpKeys) {
      const ro = await createRazorpayOrder(rzpKeys, grandTotal, orderNumber, { order_id: String(orderId), tenant: tenant.uuid });
      await tq('orders', trx).where({ id: orderId }).update({ razorpay_order_id: ro.id });
      await tinsert('payments', { order_id: orderId, provider: 'RAZORPAY', provider_order_id: ro.id, amount: grandTotal, status: 'CREATED' }, trx);
      razorpay = { keyId: rzpKeys.keyId, razorpayOrderId: ro.id, amount: grandTotal };
    } else {
      await tinsert('payments', { order_id: orderId, provider: 'COD', amount: grandTotal, status: 'CREATED' }, trx);
    }

    afterCommit(trx, () => notifyOrderPlaced(tenant.id, orderId));
    return { orderId, orderNumber, grandTotal, paymentMethod: input.paymentMethod, razorpay };
  });
}

/** Razorpay checkout callback (signature checked with the CLIENT's secret) */
export async function confirmRazorpayPayment(razorpayOrderId: string, paymentId: string, signature: string) {
  const tenant = currentTenant();
  const keys = await tenantRazorpayKeys(tenant.id);
  if (!keys || !verifyCheckoutSignature(keys.keySecret, razorpayOrderId, paymentId, signature)) {
    throw badRequest('Payment verification failed');
  }
  return markOrderPaid(tenant.id, razorpayOrderId, paymentId, null);
}

export async function markOrderPaid(tenantId: number, razorpayOrderId: string, paymentId: string, raw: unknown) {
  return db.transaction(async (trx) => {
    const order = await tq('orders', trx, tenantId).where({ razorpay_order_id: razorpayOrderId }).forUpdate().first();
    if (!order) throw notFound('Order');
    if (order.payment_status === 'PAID') return { orderNumber: order.order_number, alreadyPaid: true };
    await tq('payments', trx, tenantId).where({ order_id: order.id, provider_order_id: razorpayOrderId })
      .update({ provider_payment_id: paymentId, status: 'CAPTURED', raw_payload: raw ? JSON.stringify(raw) : null });
    await tq('orders', trx, tenantId).where({ id: order.id }).update({ payment_status: 'PAID', status: order.status === 'PENDING' ? 'CONFIRMED' : order.status });
    if (order.status === 'PENDING') {
      await tinsert('order_status_history', { order_id: order.id, from_status: 'PENDING', to_status: 'CONFIRMED', note: 'Online payment received' }, trx, tenantId);
    }
    await recordTransactionFee(tenantId, Number(order.id), Number(order.grand_total), trx);
    return { orderNumber: order.order_number, alreadyPaid: false };
  });
}

/** Staff changes order status (ORDER_UPDATE / ORDER_CANCEL) */
export async function changeOrderStatus(orderId: number, to: string, note: string | null, userId: number | null,
  extra: { trackingNumber?: string | null; courierName?: string | null } = {}) {
  const tenant = currentTenant();
  return db.transaction(async (trx) => {
    const order = await tq('orders', trx).where({ id: orderId }).forUpdate().first();
    if (!order) throw notFound('Order');
    if (!ORDER_TRANSITIONS[order.status]?.includes(to)) throw badRequest(`Cannot change status from ${order.status} to ${to}`);
    const patch: Record<string, unknown> = { status: to };
    if (extra.trackingNumber !== undefined) patch.tracking_number = extra.trackingNumber;
    if (extra.courierName !== undefined) patch.courier_name = extra.courierName;
    if (to === 'DELIVERED' && order.payment_method === 'COD') {
      patch.payment_status = 'PAID';
      await tq('payments', trx).where({ order_id: orderId, provider: 'COD' }).update({ status: 'CAPTURED' });
      await recordTransactionFee(tenant.id, orderId, Number(order.grand_total), trx);
    }
    if (to === 'CANCELLED' || to === 'RETURNED') {
      const items = await tq('order_items', trx).where({ order_id: orderId });
      for (const it of items) {
        if (it.product_id) {
          await tq('products', trx).where({ id: it.product_id, track_inventory: 1 }).increment('stock_qty', it.quantity);
        }
      }
      if (order.payment_status === 'PAID' && to === 'RETURNED') patch.payment_status = 'REFUNDED';
    }
    await tq('orders', trx).where({ id: orderId }).update(patch);
    await tinsert('order_status_history', { order_id: orderId, from_status: order.status, to_status: to, note, changed_by: userId }, trx);
    if (order.customer_email) {
      afterCommit(trx, () => sendEmail({
        tenantId: tenant.id, to: order.customer_email, template: 'order_status', subject: `Order ${order.order_number}: ${to}`,
        payload: { orderNumber: order.order_number, status: to, storeName: tenant.name, trackingNumber: extra.trackingNumber ?? order.tracking_number },
      }));
    }
    return { id: orderId, status: to };
  });
}

async function notifyOrderPlaced(tenantId: number, orderId: number) {
  const order = await db('orders').where({ tenant_id: tenantId, id: orderId }).first();
  const t = await db('tenants as t').join('tenant_settings as s', 's.tenant_id', 't.id').where('t.id', tenantId)
    .first('t.name', 's.store_email');
  if (order?.customer_email) {
    await sendEmail({ tenantId, to: order.customer_email, template: 'order_placed', subject: `Order ${order.order_number} received`,
      payload: { orderNumber: order.order_number, total: order.grand_total, storeName: t.name } });
  }
  if (t?.store_email) {
    await sendEmail({ tenantId, to: t.store_email, template: 'new_order_store', subject: `New order ${order.order_number}`,
      payload: { orderNumber: order.order_number, total: order.grand_total, customer: order.customer_name } });
  }
}

export async function orderDetail(where: Record<string, unknown>, trx?: Knex) {
  const order = await tq('orders', trx).where(where).first();
  if (!order) throw notFound('Order');
  const [items, history, payments] = await Promise.all([
    tq('order_items', trx).where({ order_id: order.id }),
    tq('order_status_history', trx).where({ order_id: order.id }).orderBy('id'),
    tq('payments', trx).where({ order_id: order.id }).select('provider', 'provider_payment_id', 'amount', 'status', 'created_at'),
  ]);
  return { ...order, items, history, payments };
}
