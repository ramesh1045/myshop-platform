/**
 * Store settings (PDF §3 step 4: Razorpay keys, shipping), SEO, custom domain (PDF §2, §3 step 6),
 * headless API keys (PDF §9)
 */
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/knex';
import { tq, tinsert } from '../../db/tenant-scope';
import { currentAuth, currentTenant } from '../../context/request-context';
import { body } from '../../middleware/common';
import { requireModule, requirePermission } from '../../middleware/auth';
import { HttpError, badRequest, conflict, notFound } from '../../lib/http-error';
import { audit } from '../../lib/audit';
import { encrypt, randomToken, sha256 } from '../../lib/crypto';
import { DOMAIN_RE } from '../../lib/util';
import { env } from '../../config/env';
import { invalidate, keys } from '../../cache/cache';
import { enqueueDomainCheck } from '../../lib/queue';
import { invalidateTenant } from '../../services/billing.service';
import { checkDomainNow } from '../../services/domain.service';

export const settingsRouter = Router();
const sfInvalidate = () => invalidate(keys.storefront(currentTenant().id));

// ------------------------------------------------------------------ store & shipping
settingsRouter.get('/settings/store', requirePermission('SETTINGS_MANAGE'), async (_req, res) => {
  const t = currentTenant();
  const [tenant, s] = await Promise.all([
    db('tenants').where({ id: t.id }).first('name', 'legal_name', 'gstin', 'address_line1', 'address_line2', 'city', 'state', 'state_code', 'pincode'),
    tq('tenant_settings').first('store_email', 'store_phone', 'whatsapp_number', 'shipping_flat_fee', 'free_shipping_above',
      'prices_include_tax', 'min_order_amount', 'social_links'),
  ]);
  res.json({ ...tenant, ...s });
});

settingsRouter.put('/settings/store', requirePermission('SETTINGS_MANAGE'), body(z.object({
  name: z.string().min(2).max(150).optional(), legalName: z.string().max(200).nullable().optional(),
  gstin: z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/).nullable().optional().or(z.literal('')),
  addressLine1: z.string().max(200).nullable().optional(), addressLine2: z.string().max(200).nullable().optional(),
  city: z.string().max(100).nullable().optional(), state: z.string().max(100).nullable().optional(),
  stateCode: z.string().regex(/^\d{2}$/).nullable().optional(), pincode: z.string().max(10).nullable().optional(),
  storeEmail: z.string().email().nullable().optional(), storePhone: z.string().max(20).nullable().optional(),
  whatsappNumber: z.string().max(20).nullable().optional(),
  shippingFlatFee: z.number().nonnegative().optional(), freeShippingAbove: z.number().nonnegative().nullable().optional(),
  pricesIncludeTax: z.boolean().optional(), minOrderAmount: z.number().nonnegative().optional(),
  socialLinks: z.record(z.string().url().or(z.literal(''))).optional(),
})), async (req, res) => {
  const t = currentTenant();
  const b = req.body;
  const tPatch = strip({ name: b.name, legal_name: b.legalName, gstin: b.gstin === '' ? null : b.gstin, address_line1: b.addressLine1,
    address_line2: b.addressLine2, city: b.city, state: b.state, state_code: b.stateCode, pincode: b.pincode });
  const sPatch = strip({ store_email: b.storeEmail, store_phone: b.storePhone, whatsapp_number: b.whatsappNumber,
    shipping_flat_fee: b.shippingFlatFee, free_shipping_above: b.freeShippingAbove, prices_include_tax: b.pricesIncludeTax,
    min_order_amount: b.minOrderAmount, social_links: b.socialLinks ? JSON.stringify(b.socialLinks) : undefined });
  if (Object.keys(tPatch).length) await db('tenants').where({ id: t.id }).update(tPatch);
  if (Object.keys(sPatch).length) await tq('tenant_settings').update(sPatch);
  await audit('SETTINGS_UPDATE', 'settings', 'store', null, { ...tPatch, ...sPatch });
  await invalidateTenant(t.id);
  res.json({ ok: true });
});
const strip = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// ------------------------------------------------------------------ payments (client's own Razorpay)
settingsRouter.get('/settings/payments', requirePermission('PAYMENT_SETTINGS_MANAGE'), async (_req, res) => {
  const t = currentTenant();
  const s = await tq('tenant_settings').first('razorpay_key_id', 'razorpay_key_secret_enc', 'razorpay_webhook_secret_enc', 'cod_enabled', 'online_payment_enabled');
  res.json({
    razorpayKeyId: s.razorpay_key_id, hasKeySecret: !!s.razorpay_key_secret_enc, hasWebhookSecret: !!s.razorpay_webhook_secret_enc,
    codEnabled: s.cod_enabled, onlinePaymentEnabled: s.online_payment_enabled,
    webhookUrl: `https://${t.primaryDomain}/api/public/payments/razorpay/webhook`,
  });
});

settingsRouter.put('/settings/payments', requirePermission('PAYMENT_SETTINGS_MANAGE'), body(z.object({
  razorpayKeyId: z.string().regex(/^rzp_(test|live)_[A-Za-z0-9]+$/).nullable().optional(),
  razorpayKeySecret: z.string().min(10).max(100).optional(),     // write-only
  razorpayWebhookSecret: z.string().min(6).max(100).optional(),  // write-only
  codEnabled: z.boolean().optional(), onlinePaymentEnabled: z.boolean().optional(),
})), async (req, res) => {
  const b = req.body;
  const patch = strip({
    razorpay_key_id: b.razorpayKeyId, cod_enabled: b.codEnabled, online_payment_enabled: b.onlinePaymentEnabled,
    razorpay_key_secret_enc: b.razorpayKeySecret ? encrypt(b.razorpayKeySecret) : undefined,
    razorpay_webhook_secret_enc: b.razorpayWebhookSecret ? encrypt(b.razorpayWebhookSecret) : undefined,
  });
  if (b.onlinePaymentEnabled) {
    const cur = await tq('tenant_settings').first('razorpay_key_id', 'razorpay_key_secret_enc');
    if (!(patch.razorpay_key_id ?? cur.razorpay_key_id) || !(patch.razorpay_key_secret_enc ?? cur.razorpay_key_secret_enc)) {
      throw badRequest('Enter Razorpay Key ID and Key Secret before enabling online payment');
    }
  }
  await tq('tenant_settings').update(patch);
  await audit('PAYMENT_SETTINGS_UPDATE', 'settings', 'payments', null, { keyId: b.razorpayKeyId, cod: b.codEnabled, online: b.onlinePaymentEnabled });
  await sfInvalidate();
  res.json({ ok: true });
});

// ------------------------------------------------------------------ SEO
settingsRouter.get('/settings/seo', requireModule('SEO'), requirePermission('SEO_MANAGE'), async (_req, res) => {
  res.json(await tq('tenant_settings').first('seo_title', 'seo_description', 'seo_keywords', 'google_analytics_id'));
});
settingsRouter.put('/settings/seo', requireModule('SEO'), requirePermission('SEO_MANAGE'), body(z.object({
  seoTitle: z.string().max(200).nullable().optional(), seoDescription: z.string().max(500).nullable().optional(),
  seoKeywords: z.string().max(500).nullable().optional(), googleAnalyticsId: z.string().max(40).nullable().optional(),
})), async (req, res) => {
  const b = req.body;
  await tq('tenant_settings').update(strip({ seo_title: b.seoTitle, seo_description: b.seoDescription, seo_keywords: b.seoKeywords, google_analytics_id: b.googleAnalyticsId }));
  await sfInvalidate();
  res.json({ ok: true });
});

// ------------------------------------------------------------------ DOMAINS
settingsRouter.get('/domains', requirePermission('DOMAIN_MANAGE', 'SETTINGS_MANAGE'), async (_req, res) => {
  const t = currentTenant();
  const plan = await db('tenants as t').join('plans as p', 'p.id', 't.plan_id').where('t.id', t.id).first('p.allow_custom_domain');
  res.json({
    domains: await tq('tenant_domains').orderBy([{ column: 'type', order: 'desc' }, { column: 'id', order: 'asc' }]),
    cnameTarget: env.CNAME_TARGET, serverIp: env.SERVER_IP || null, customDomainAllowed: !!plan.allow_custom_domain,
  });
});

/** Add custom domain -> client adds CNAME -> worker verifies -> Caddy issues SSL on demand (PDF §2) */
settingsRouter.post('/domains', requireModule('CUSTOM_DOMAIN'), requirePermission('DOMAIN_MANAGE'), body(z.object({
  domain: z.string().min(4).max(253),
})), async (req, res) => {
  const t = currentTenant();
  const plan = await db('tenants as t').join('plans as p', 'p.id', 't.plan_id').where('t.id', t.id).first('p.allow_custom_domain');
  if (!plan.allow_custom_domain) throw new HttpError(402, 'PLAN_LIMIT_REACHED', 'Custom domain is available on Pro plan and above');
  const domain = req.body.domain.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!DOMAIN_RE.test(domain)) throw badRequest('Enter a valid domain like shop.example.com');
  const root = env.PLATFORM_DOMAIN.toLowerCase();
  if (domain === root || domain.endsWith(`.${root}`)) throw badRequest('Use your own domain, not a platform subdomain');
  if (await db('tenant_domains').comment('global').where({ domain }).first('id')) throw conflict('This domain is already connected to a store');
  const [{ n }] = await tq('tenant_domains').where({ type: 'CUSTOM' }).count({ n: '*' });
  if (Number(n) >= 5) throw badRequest('Maximum 5 custom domains');
  const id = await tinsert('tenant_domains', { domain, type: 'CUSTOM', is_primary: 0, verification_status: 'PENDING', cname_target: env.CNAME_TARGET });
  await enqueueDomainCheck(id).catch(() => undefined);
  await audit('DOMAIN_ADD', 'domain', id, null, { domain });
  res.status(201).json({
    id, domain,
    instructions: {
      type: 'CNAME', host: domain.split('.').length > 2 ? domain.split('.')[0] : '@ (use A record for root domains)',
      value: env.CNAME_TARGET, aRecord: env.SERVER_IP || null,
    },
  });
});

settingsRouter.post('/domains/:id/verify', requirePermission('DOMAIN_MANAGE'), async (req, res) => {
  const d = await tq('tenant_domains').where({ id: Number(req.params.id), type: 'CUSTOM' }).first();
  if (!d) throw notFound('Domain');
  res.json(await checkDomainNow(Number(d.id)));
});

settingsRouter.put('/domains/:id/primary', requirePermission('DOMAIN_MANAGE'), async (req, res) => {
  const t = currentTenant();
  const d = await tq('tenant_domains').where({ id: Number(req.params.id) }).first();
  if (!d) throw notFound('Domain');
  if (d.verification_status !== 'VERIFIED') throw badRequest('Verify the domain first');
  await db.transaction(async (trx) => {
    await tq('tenant_domains', trx).update({ is_primary: 0 });
    await tq('tenant_domains', trx).where({ id: d.id }).update({ is_primary: 1 });
  });
  await invalidateTenant(t.id);
  res.json({ ok: true });
});

settingsRouter.delete('/domains/:id', requirePermission('DOMAIN_MANAGE'), async (req, res) => {
  const t = currentTenant();
  const d = await tq('tenant_domains').where({ id: Number(req.params.id), type: 'CUSTOM' }).first();
  if (!d) throw notFound('Domain');
  await tq('tenant_domains').where({ id: d.id }).delete();
  if (d.is_primary) await tq('tenant_domains').where({ type: 'SUBDOMAIN' }).update({ is_primary: 1 });
  await invalidate(keys.domain(d.domain));
  await invalidateTenant(t.id);
  await audit('DOMAIN_REMOVE', 'domain', d.id, { domain: d.domain });
  res.status(204).end();
});

// ------------------------------------------------------------------ HEADLESS API KEYS
settingsRouter.get('/api-keys', requireModule('HEADLESS_API'), requirePermission('API_KEY_MANAGE'), async (_req, res) => {
  res.json(await tq('api_keys').select('id', 'name', 'key_prefix', 'scopes', 'last_used_at', 'revoked_at', 'created_at').orderBy('id', 'desc'));
});
settingsRouter.post('/api-keys', requireModule('HEADLESS_API'), requirePermission('API_KEY_MANAGE'), body(z.object({
  name: z.string().min(2).max(100), scopes: z.array(z.enum(['catalog:read', 'orders:write', 'orders:read'])).min(1),
})), async (req, res) => {
  const key = `msk_${randomToken(32)}`;
  const id = await tinsert('api_keys', { name: req.body.name, key_prefix: key.slice(0, 12), key_hash: sha256(key),
    scopes: JSON.stringify(req.body.scopes), created_by: currentAuth().id });
  await audit('API_KEY_CREATE', 'api_key', id, null, { name: req.body.name, scopes: req.body.scopes });
  res.status(201).json({ id, key, note: 'Copy this key now. It will not be shown again.' });
});
settingsRouter.delete('/api-keys/:id', requireModule('HEADLESS_API'), requirePermission('API_KEY_MANAGE'), async (req, res) => {
  await tq('api_keys').where({ id: Number(req.params.id) }).update({ revoked_at: new Date() });
  await audit('API_KEY_REVOKE', 'api_key', String(req.params.id));
  res.status(204).end();
});
