/**
 * GET /api/public/storefront-config (PDF §5.4): the Angular app calls this on start and gets
 * theme code (layer 1, lazy-loaded), customisation JSON (layer 2, applied as CSS variables)
 * and home page sections (layer 3). Cached per tenant; Draft is served only with a preview token.
 */
import { db } from '../db/knex';
import { cached, keys } from '../cache/cache';
import { enabledModules } from './access.service';
import type { TenantInfo } from '../context/request-context';

export async function storefrontConfig(tenant: TenantInfo, stage: 'PUBLISHED' | 'DRAFT' = 'PUBLISHED') {
  const load = async () => {
    const [themeRow, settings, pages, categories, modules, t] = await Promise.all([
      db('tenant_theme_settings as s').join('themes as th', 'th.id', 's.theme_id')
        .where({ 's.tenant_id': tenant.id, 's.stage': stage })
        .first('th.code as themeCode', 'th.id as themeId', 's.settings', 's.sections', 's.version', 's.published_at'),
      db('tenant_settings').where({ tenant_id: tenant.id }).first(),
      db('pages').where({ tenant_id: tenant.id, status: 'PUBLISHED', show_in_nav: 1 }).orderBy('nav_order')
        .select('title', 'slug'),
      db('categories').where({ tenant_id: tenant.id, is_active: 1 }).orderBy(['sort_order', 'name'])
        .select('id', 'parent_id', 'name', 'slug', 'image_url'),
      enabledModules(tenant.id),
      db('tenants').where({ id: tenant.id }).first('name', 'status', 'currency', 'city', 'state', 'gstin'),
    ]);
    return {
      store: {
        name: t.name, subdomain: tenant.subdomain, currency: t.currency, status: t.status,
        primaryDomain: tenant.primaryDomain,
        suspended: ['SUSPENDED', 'CANCELLED', 'PENDING_PAYMENT'].includes(t.status),
        contact: { email: settings?.store_email, phone: settings?.store_phone, whatsapp: settings?.whatsapp_number, city: t.city, state: t.state },
        social: settings?.social_links ?? {},
      },
      theme: {
        code: themeRow.themeCode,
        settings: themeRow.settings,
        sections: themeRow.sections,
        version: themeRow.version,
        stage,
      },
      nav: { pages, categories },
      modules,
      checkout: {
        cod: !!settings?.cod_enabled,
        online: !!settings?.online_payment_enabled && !!settings?.razorpay_key_id,
        razorpayKeyId: settings?.online_payment_enabled ? settings?.razorpay_key_id : null,
        shippingFlatFee: Number(settings?.shipping_flat_fee ?? 0),
        freeShippingAbove: settings?.free_shipping_above != null ? Number(settings.free_shipping_above) : null,
        minOrderAmount: Number(settings?.min_order_amount ?? 0),
        pricesIncludeTax: !!settings?.prices_include_tax,
      },
      seo: {
        title: settings?.seo_title || t.name,
        description: settings?.seo_description || '',
        keywords: settings?.seo_keywords || '',
        googleAnalyticsId: settings?.google_analytics_id || null,
      },
    };
  };
  return stage === 'PUBLISHED' ? cached(keys.storefront(tenant.id), load, { ttlSec: 600 }) : load();
}
